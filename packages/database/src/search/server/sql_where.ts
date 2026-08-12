/**
 * The `where`/`order` → SQL compiler (plan §7.4).
 *
 * **What this module is.** An *optimization*. It finds candidate rows and
 * pushes down the predicates SQL can decide exactly; it is never the authority
 * on membership, order or counts — that authority lives in `core/*` and is
 * shared with the client driver (the §3 consistency contract). Every compiled
 * result therefore carries an `exact` flag: when it is `false`, the SQL is a
 * *sound superset* (a prefilter) and the caller must re-decide with
 * `core/where`.
 *
 * **Where values live.** Entity tables store every top-level scalar field as a
 * real column; objects, arrays, vectors and geopoints live in the internal
 * `json` overflow column. That gives a four-way split:
 *
 * 1. top-level scalar → the real column,
 * 2. object child path (`address.city`) → a `sv$address__city` VIRTUAL
 *    generated column over `json_extract(json, '$.address.city')`,
 * 3. array field → `json_each` EXISTS predicates (no generated column in v1),
 * 4. FK-derived field → a generated column over
 *    `json_extract(json, '$."$derived".author_name')`, exactly like (2).
 *
 * **Two hazards this module exists to get right.**
 *
 * - `json_each` exposes a *hidden column named `json`*. An unqualified
 *   `json_extract(json, …)` inside `EXISTS (SELECT 1 FROM json_each(…) …)`
 *   therefore binds to `json_each`'s own column, not the entity table's, and
 *   silently matches nothing. Every reference here is table-qualified.
 * - A generated column declared `TEXT` gets TEXT affinity, which makes
 *   `col = 5` match a stored `'5'` — the opposite of the DSL's strict typed
 *   equality. Generated columns are therefore declared with **no type name**
 *   (BLOB/"any" affinity), so comparisons stay strict by storage class, exactly
 *   like `core/compare`. (The plan's DDL sketch shows `TEXT`; this is a
 *   deliberate correction.)
 *
 * **Null rule.** Every leaf compiles NULL-safe (`IFNULL(…, 0)`), so the whole
 * expression is two-valued and `not` is a plain `NOT (…)` that admits rows
 * missing the field — the same outcome as the plan's
 * `(col IS NULL OR NOT (…))`, generalized to subtrees.
 */

import { DelightError } from '@delightstack/utilities';
import { convertDistanceToMeters, EARTH_RADIUS_METERS } from '../core/geo';
import type { GeoPoint, SearchOrder, SearchableType } from '../core/types';
import { isArrayFieldType, type NormalizedWhere, type WhereSchema } from '../core/where';
import { MAX_SQL_PARAMS } from './sqlite_store';

/* -------------------------------------------------------------------------- */
/* Identifiers                                                                */
/* -------------------------------------------------------------------------- */

/** Prefix for generated columns over JSON paths. */
export const GENERATED_COLUMN_PREFIX = 'sv$';

/** DO SQLite caps tables at 100 columns — real, `json` and generated share it. */
export const MAX_TABLE_COLUMNS = 100;

/** A path segment must be a plain identifier — the schema's paths always are. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Validate every segment of a dot path, so the emitted SQL is injection-free. */
function assertPathIsSafe(path: string): string[] {
	const segments = path.split('.');
	for (const segment of segments) {
		if (!IDENTIFIER.test(segment)) {
			throw DelightError.badRequest(
				`Field path "${path}" is not a valid identifier path.`,
				{ code: 'invalid_filter_field' },
			);
		}
	}
	return segments;
}

/** Double-quote a SQL identifier. */
export function quoteIdentifier(name: string): string {
	return `"${name.replaceAll('"', '""')}"`;
}

/** The generated-column name for a dot path: `address.city` → `sv$address__city`. */
export function generatedColumnName(path: string, suffix?: string): string {
	assertPathIsSafe(path);
	return `${GENERATED_COLUMN_PREFIX}${path.replaceAll('.', '__')}${suffix ? `__${suffix}` : ''}`;
}

/** The `json_extract` path for a dot path: `address.city` → `$.address.city`. */
export function jsonPath(path: string, derived = false): string {
	const segments = assertPathIsSafe(path);
	const prefix = derived ? `$."$derived"` : '$';
	return `${prefix}${segments.map((segment) => `.${segment}`).join('')}`;
}

/* -------------------------------------------------------------------------- */
/* Field placement (the four-way split)                                       */
/* -------------------------------------------------------------------------- */

/** How one declared path is reachable from SQL. */
export type FieldPlacement =
	| { kind: 'column'; column: string }
	| { kind: 'generated'; column: string; json_path: string }
	| { kind: 'array'; json_path: string }
	| { kind: 'geo'; lat_column: string; lon_column: string; json_path: string }
	| { kind: 'unsupported' };

/** Everything the compiler needs to know about the entity table. */
export interface SqlWhereContext {
	/** The entity table's name — also the alias every reference is qualified by. */
	table_name: string;
	/** Flat map of dot-path → declared type. */
	schema: WhereSchema;
	/** Real column names on the table (top-level scalars + reserved columns). */
	columns: ReadonlySet<string>;
	/** FK-derived paths, persisted under the `$derived` sub-object. */
	derived_fields?: ReadonlySet<string>;
	/** The overflow column holding non-scalars @default 'json' */
	json_column?: string;
	/** The primary-key column. */
	primary_key: string;
	/**
	 * Paths whose SQL representation is known to be lossy (e.g. a numeric `enum`
	 * in a `TEXT`-affinity column). Predicates on them compile to a
	 * polarity-correct literal and `core/where` decides instead.
	 */
	inexact_fields?: ReadonlySet<string>;
	/**
	 * Real columns declared with a `TEXT` type name, and therefore TEXT affinity.
	 *
	 * SQLite applies a column's TEXT affinity to the *other* operand of a
	 * comparison, so `enum_col = 5` converts `5` to `'5'` and matches a stored
	 * `'5'` — the opposite of the frozen DSL, which compares by storage class.
	 * Only predicates whose operand is not a string are affected, so those
	 * degrade to a polarity-correct literal (and `core/where` decides) while
	 * string operands stay fully pushed down and indexed.
	 */
	text_affinity_fields?: ReadonlySet<string>;
}

/** Resolve where a declared path lives. */
export function placeField(path: string, ctx: SqlWhereContext): FieldPlacement {
	const type = ctx.schema[path];
	if (type === undefined) return { kind: 'unsupported' };
	if (typeof type === 'string' && type.startsWith('vector['))
		return { kind: 'unsupported' };
	const derived = ctx.derived_fields?.has(path) === true;
	if (type === 'geopoint') {
		return {
			kind: 'geo',
			lat_column: generatedColumnName(path, 'lat'),
			lon_column: generatedColumnName(path, 'lon'),
			json_path: jsonPath(path, derived),
		};
	}
	if (isArrayFieldType(type))
		return { kind: 'array', json_path: jsonPath(path, derived) };
	if (!derived && !path.includes('.') && ctx.columns.has(path)) {
		return { kind: 'column', column: path };
	}
	return {
		kind: 'generated',
		column: generatedColumnName(path),
		json_path: jsonPath(path, derived),
	};
}

/* -------------------------------------------------------------------------- */
/* Generated-column DDL + migration diffing                                   */
/* -------------------------------------------------------------------------- */

/** One generated column the schema requires. */
export interface GeneratedColumnSpec {
	/** Column name, e.g. `sv$address__city` */
	column: string;
	/** The `json_extract` path it computes */
	json_path: string;
	/** The index created over it */
	index_name: string;
	/** The declared path it serves */
	field: string;
}

/** The index name for a generated column on a table. */
function indexNameFor(table_name: string, column: string): string {
	return `idx_${table_name}_${column.slice(GENERATED_COLUMN_PREFIX.length)}`;
}

/**
 * Every generated column a table's declared schema needs.
 *
 * One per object child path and per persisted FK-derived path, **two** per
 * geopoint field (the lat/lon pair the bbox prefilter needs — §5.1). Array
 * fields get none in v1: they are queried through `json_each`.
 */
export function planGeneratedColumns(ctx: SqlWhereContext): GeneratedColumnSpec[] {
	const specs: GeneratedColumnSpec[] = [];
	for (const path of Object.keys(ctx.schema).sort()) {
		const placement = placeField(path, ctx);
		if (placement.kind === 'generated') {
			specs.push({
				column: placement.column,
				json_path: placement.json_path,
				index_name: indexNameFor(ctx.table_name, placement.column),
				field: path,
			});
		} else if (placement.kind === 'geo') {
			specs.push(
				{
					column: placement.lat_column,
					json_path: `${placement.json_path}.lat`,
					index_name: indexNameFor(ctx.table_name, placement.lat_column),
					field: path,
				},
				{
					column: placement.lon_column,
					json_path: `${placement.json_path}.lon`,
					index_name: indexNameFor(ctx.table_name, placement.lon_column),
					field: path,
				},
			);
		}
	}
	return specs;
}

/** The DDL that adds one generated column plus its index. */
export function generatedColumnStatements(
	table_name: string,
	spec: GeneratedColumnSpec,
	json_column = 'json',
): string[] {
	// No type name on purpose: a declared TEXT affinity would coerce numeric
	// comparisons and break the DSL's strict typed equality (see the docblock).
	return [
		`ALTER TABLE ${quoteIdentifier(table_name)} ADD COLUMN ${quoteIdentifier(spec.column)} GENERATED ALWAYS AS (json_extract(${quoteIdentifier(json_column)}, '${spec.json_path}')) VIRTUAL;`,
		`CREATE INDEX IF NOT EXISTS ${quoteIdentifier(spec.index_name)} ON ${quoteIdentifier(table_name)} (${quoteIdentifier(spec.column)});`,
	];
}

/** The result of diffing the declared generated columns against the table. */
export interface GeneratedColumnMigration {
	/** DDL to run, in order. */
	statements: string[];
	/** Columns that will be added. */
	added: GeneratedColumnSpec[];
	/** Generated columns that will be dropped. */
	removed: string[];
	/** Columns the table will have once the migration runs. */
	projected_column_count: number;
}

/**
 * Diff the declared generated columns against the live table.
 *
 * `existing_columns` must come from **`PRAGMA table_xinfo`**, not
 * `PRAGMA table_info`: VIRTUAL generated columns are hidden and `table_info`
 * omits them entirely, so diffing against it would re-`ADD COLUMN` on every
 * boot and fail. (The plan says `table_info`; this is a verified correction.)
 *
 * Removals emit `DROP INDEX` **before** `DROP COLUMN` — an indexed column
 * cannot be dropped. The 100-column budget is checked *before* any DDL is
 * emitted, so an over-budget schema fails loudly at migration time rather than
 * with an opaque SQLite error halfway through.
 */
export function planGeneratedColumnMigration(options: {
	table_name: string;
	desired: readonly GeneratedColumnSpec[];
	existing_columns: readonly string[];
	json_column?: string;
	column_budget?: number;
}): GeneratedColumnMigration {
	const { table_name, desired } = options;
	const budget = options.column_budget ?? MAX_TABLE_COLUMNS;
	const existing = new Set(options.existing_columns);
	const desired_names = new Set(desired.map((spec) => spec.column));
	const base_columns = options.existing_columns.filter(
		(column) => !column.startsWith(GENERATED_COLUMN_PREFIX),
	);
	const projected_column_count = base_columns.length + desired.length;
	if (projected_column_count > budget) {
		throw new DelightError({
			message:
				`Table "${table_name}" would need ${projected_column_count} columns ` +
				`(${base_columns.length} declared + ${desired.length} generated search columns) ` +
				`but SQLite in Durable Objects caps a table at ${budget}. Reduce the number of ` +
				`searchable/sortable child paths, geopoint fields (2 columns each) or FK-derived fields.`,
			status: 500,
			code: 'search_column_budget_exceeded',
		});
	}
	const added = desired.filter((spec) => !existing.has(spec.column));
	const removed = options.existing_columns.filter(
		(column) => column.startsWith(GENERATED_COLUMN_PREFIX) && !desired_names.has(column),
	);
	const statements: string[] = [];
	for (const spec of added) {
		statements.push(...generatedColumnStatements(table_name, spec, options.json_column));
	}
	for (const column of removed) {
		statements.push(
			`DROP INDEX IF EXISTS ${quoteIdentifier(indexNameFor(table_name, column))};`,
			`ALTER TABLE ${quoteIdentifier(table_name)} DROP COLUMN ${quoteIdentifier(column)};`,
		);
	}
	return { statements, added, removed, projected_column_count };
}

/* -------------------------------------------------------------------------- */
/* Compilation                                                                */
/* -------------------------------------------------------------------------- */

/** A compiled SQL fragment. */
export interface CompiledSql {
	sql: string;
	params: unknown[];
	/**
	 * Whether the SQL decides membership exactly.
	 *
	 * `false` means the fragment is a *sound superset* — the caller must fetch
	 * the candidates and re-decide with `core/where`.
	 */
	exact: boolean;
}

/** Mutable state threaded through one compilation. */
interface CompileState {
	ctx: SqlWhereContext;
	params: unknown[];
	exact: boolean;
	/** Bound-parameter ceiling for the whole statement. */
	budget: number;
}

/** The truthy/falsy literal an unknown predicate becomes at this polarity. */
function unknownAt(negated: boolean): string {
	// Under an odd number of `not`s the safe answer is `0`, because `NOT(0)`
	// keeps every row; `1` there would silently *narrow* the candidate set.
	return negated ? '0' : '1';
}

/** Qualified reference to a real or generated column. */
function columnRef(state: CompileState, column: string): string {
	return `${quoteIdentifier(state.ctx.table_name)}.${quoteIdentifier(column)}`;
}

/** Qualified reference to the JSON overflow column. */
function jsonRef(state: CompileState): string {
	return `${quoteIdentifier(state.ctx.table_name)}.${quoteIdentifier(state.ctx.json_column ?? 'json')}`;
}

/** `json_extract(<table>."json", '<path>')` — always table-qualified. */
function jsonExtract(state: CompileState, path: string): string {
	return `json_extract(${jsonRef(state)}, '${path}')`;
}

/** Whether a JS operand's type matches the field's declared type. */
function operandMatchesType(type: SearchableType, value: unknown): boolean {
	switch (type) {
		case 'string':
		case 'string[]':
			return typeof value === 'string';
		case 'number':
		case 'number[]':
			return typeof value === 'number' && Number.isFinite(value);
		case 'boolean':
		case 'boolean[]':
			return typeof value === 'boolean';
		case 'enum':
		case 'enum[]':
			return (
				typeof value === 'string' ||
				(typeof value === 'number' && Number.isFinite(value)) ||
				typeof value === 'boolean'
			);
		default:
			return false;
	}
}

/**
 * Encode an operand as a bound parameter.
 *
 * Booleans become `0`/`1`: that is what `json_extract` yields for JSON
 * booleans, and what entity tables store in a boolean column.
 */
function encodeOperand(value: unknown): unknown {
	if (typeof value === 'boolean') return value ? 1 : 0;
	return value;
}

/** Add bindings if the budget allows. Returns false when it does not. */
function spend(state: CompileState, count: number): boolean {
	return state.params.length + count <= state.budget;
}

/** An approximate fragment: marks the compilation inexact and yields a literal. */
function approximate(state: CompileState, negated: boolean, sql?: string): string {
	state.exact = false;
	return sql ?? unknownAt(negated);
}

/* --- scalar operators ----------------------------------------------------- */

const ORDERING_OPERATORS: Record<string, string> = {
	gt: '>',
	gte: '>=',
	lt: '<',
	lte: '<=',
};

/** Compile one operator against a scalar column. */
function compileScalarOperator(
	state: CompileState,
	negated: boolean,
	reference: string,
	type: SearchableType,
	operator: string,
	operand: unknown,
): string {
	if (operator === 'eq') {
		if (!operandMatchesType(type, operand)) return approximate(state, negated);
		if (!spend(state, 1)) return approximate(state, negated);
		state.params.push(encodeOperand(operand));
		return `IFNULL(${reference} = ?, 0)`;
	}
	if (operator in ORDERING_OPERATORS) {
		if (!operandMatchesType(type, operand)) return approximate(state, negated);
		if (!spend(state, 1)) return approximate(state, negated);
		state.params.push(encodeOperand(operand));
		return `IFNULL(${reference} ${ORDERING_OPERATORS[operator]} ?, 0)`;
	}
	if (operator === 'between') {
		const [min, max] = operand as [unknown, unknown];
		if (!operandMatchesType(type, min) || !operandMatchesType(type, max)) {
			return approximate(state, negated);
		}
		if (!spend(state, 2)) return approximate(state, negated);
		state.params.push(encodeOperand(min), encodeOperand(max));
		return `IFNULL(${reference} >= ? AND ${reference} <= ?, 0)`;
	}
	if (operator === 'in' || operator === 'not_in') {
		const values = operand as unknown[];
		if (values.some((value) => !operandMatchesType(type, value))) {
			return approximate(state, negated);
		}
		if (operator === 'in' && values.length === 0) return '0';
		if (operator === 'not_in' && values.length === 0) return `${reference} IS NOT NULL`;
		if (!spend(state, values.length)) return approximate(state, negated);
		const groups: string[] = [];
		for (let index = 0; index < values.length; index += MAX_IN_CHUNK) {
			const batch = values.slice(index, index + MAX_IN_CHUNK);
			for (const value of batch) state.params.push(encodeOperand(value));
			groups.push(
				`${reference} ${operator === 'in' ? 'IN' : 'NOT IN'} (${Array.from({ length: batch.length }, () => '?').join(', ')})`,
			);
		}
		const joined = groups.join(operator === 'in' ? ' OR ' : ' AND ');
		return operator === 'in'
			? `IFNULL(${joined}, 0)`
			: `(${reference} IS NOT NULL AND ${joined})`;
	}
	// `contains_all`/`contains_any` on a scalar are rejected by `normalizeWhere`.
	return approximate(state, negated);
}

/** Values per `IN (...)` group. Kept well under the statement cap. */
const MAX_IN_CHUNK = 50;

/* --- array operators ------------------------------------------------------ */

/** `EXISTS (SELECT 1 FROM json_each(<array>) WHERE value = ?)` for one element. */
function existsElement(array_expression: string): string {
	return `EXISTS (SELECT 1 FROM json_each(${array_expression}) WHERE json_each.value = ?)`;
}

/** Compile one operator against an array field via `json_each`. */
function compileArrayOperator(
	state: CompileState,
	negated: boolean,
	array_expression: string,
	type: SearchableType,
	operator: string,
	operand: unknown,
): string {
	const present = `${array_expression} IS NOT NULL`;
	if (operator === 'eq') {
		if (!operandMatchesType(type, operand)) return approximate(state, negated);
		if (!spend(state, 1)) return approximate(state, negated);
		state.params.push(encodeOperand(operand));
		return existsElement(array_expression);
	}
	if (operator === 'in' || operator === 'contains_any' || operator === 'contains_all') {
		const values = operand as unknown[];
		if (values.some((value) => !operandMatchesType(type, value))) {
			return approximate(state, negated);
		}
		if (values.length === 0) {
			// `contains_all: []` is vacuously true for a present array; `in: []` and
			// `contains_any: []` match nothing (§5, frozen 2026-08-12).
			return operator === 'contains_all' ? `(${present})` : '0';
		}
		if (!spend(state, values.length)) return approximate(state, negated);
		const parts = values.map((value) => {
			state.params.push(encodeOperand(value));
			return existsElement(array_expression);
		});
		return `(${parts.join(operator === 'contains_all' ? ' AND ' : ' OR ')})`;
	}
	if (operator === 'not_in') {
		const values = operand as unknown[];
		if (values.some((value) => !operandMatchesType(type, value))) {
			return approximate(state, negated);
		}
		if (values.length === 0) return `(${present})`;
		if (!spend(state, values.length)) return approximate(state, negated);
		const parts = values.map((value) => {
			state.params.push(encodeOperand(value));
			return existsElement(array_expression);
		});
		return `(${present} AND NOT (${parts.join(' OR ')}))`;
	}
	if (operator in ORDERING_OPERATORS) {
		if (!operandMatchesType(type, operand)) return approximate(state, negated);
		if (!spend(state, 1)) return approximate(state, negated);
		state.params.push(encodeOperand(operand));
		return `EXISTS (SELECT 1 FROM json_each(${array_expression}) WHERE json_each.value ${ORDERING_OPERATORS[operator]} ?)`;
	}
	if (operator === 'between') {
		const [min, max] = operand as [unknown, unknown];
		if (!operandMatchesType(type, min) || !operandMatchesType(type, max)) {
			return approximate(state, negated);
		}
		if (!spend(state, 2)) return approximate(state, negated);
		state.params.push(encodeOperand(min), encodeOperand(max));
		return `EXISTS (SELECT 1 FROM json_each(${array_expression}) WHERE json_each.value >= ? AND json_each.value <= ?)`;
	}
	return approximate(state, negated);
}

/* --- geo ------------------------------------------------------------------ */

/** A latitude/longitude bounding box. */
export interface GeoBoundingBox {
	min_lat: number;
	max_lat: number;
	min_lon: number;
	max_lon: number;
}

/** Padding applied to every bbox so float noise can never lose a boundary doc. */
const GEO_BBOX_PADDING_DEGREES = 1e-6;

/**
 * The bounding box that *contains* a geo predicate's matches, or `undefined`
 * when no useful box exists.
 *
 * `inside: false` (the complement) has no bounding box — the matches are
 * everything outside the shape. Radius boxes widen to the full longitude range
 * near the poles, where `Δlon = Δlat / cos(lat)` blows up. The box is a
 * **prefilter only**: membership is always decided by `core/geo`.
 */
export function geoBoundingBox(
	operator: 'radius' | 'polygon',
	operand: unknown,
): GeoBoundingBox | undefined {
	if (!operand || typeof operand !== 'object') return undefined;
	const options = operand as Record<string, unknown>;
	if (options.inside === false) return undefined;
	if (operator === 'polygon') {
		const coordinates = options.coordinates;
		if (!Array.isArray(coordinates) || coordinates.length < 3) return undefined;
		let min_lat = Infinity;
		let max_lat = -Infinity;
		let min_lon = Infinity;
		let max_lon = -Infinity;
		for (const vertex of coordinates as GeoPoint[]) {
			if (
				!vertex ||
				typeof vertex.lat !== 'number' ||
				typeof vertex.lon !== 'number' ||
				!Number.isFinite(vertex.lat) ||
				!Number.isFinite(vertex.lon)
			) {
				return undefined;
			}
			min_lat = Math.min(min_lat, vertex.lat);
			max_lat = Math.max(max_lat, vertex.lat);
			min_lon = Math.min(min_lon, vertex.lon);
			max_lon = Math.max(max_lon, vertex.lon);
		}
		return padBox({ min_lat, max_lat, min_lon, max_lon });
	}
	const center = options.coordinates as GeoPoint | undefined;
	const value = options.value;
	if (
		!center ||
		typeof center.lat !== 'number' ||
		typeof center.lon !== 'number' ||
		typeof value !== 'number' ||
		!Number.isFinite(value)
	) {
		return undefined;
	}
	let meters: number;
	try {
		meters = convertDistanceToMeters(value, options.unit as string | undefined);
	} catch {
		// An invalid unit is a 400 from `core/geo`; let that path throw, not this one.
		return undefined;
	}
	const delta_lat = (meters / EARTH_RADIUS_METERS) * (180 / Math.PI);
	if (delta_lat >= 90) return undefined;
	const min_lat = center.lat - delta_lat;
	const max_lat = center.lat + delta_lat;
	const widest = Math.max(Math.abs(min_lat), Math.abs(max_lat));
	const cosine = Math.cos((widest * Math.PI) / 180);
	if (widest >= 90 || cosine <= 0) {
		// The circle reaches over a pole: every longitude is in range, but the
		// latitude band still prefilters usefully.
		return padBox({ min_lat, max_lat, min_lon: -180, max_lon: 180 });
	}
	const delta_lon = delta_lat / cosine;
	if (delta_lon >= 180) {
		return padBox({ min_lat, max_lat, min_lon: -180, max_lon: 180 });
	}
	const min_lon = center.lon - delta_lon;
	const max_lon = center.lon + delta_lon;
	// A box that wraps the antimeridian is not expressible as a single range.
	if (min_lon < -180 || max_lon > 180) {
		return padBox({ min_lat, max_lat, min_lon: -180, max_lon: 180 });
	}
	return padBox({ min_lat, max_lat, min_lon, max_lon });
}

/** Widen a box slightly — a prefilter may over-select but must never under-select. */
function padBox(box: GeoBoundingBox): GeoBoundingBox {
	const latitude_pad =
		GEO_BBOX_PADDING_DEGREES + Math.abs(box.max_lat - box.min_lat) * 1e-6;
	const longitude_pad =
		GEO_BBOX_PADDING_DEGREES + Math.abs(box.max_lon - box.min_lon) * 1e-6;
	return {
		min_lat: box.min_lat - latitude_pad,
		max_lat: box.max_lat + latitude_pad,
		min_lon: box.min_lon - longitude_pad,
		max_lon: box.max_lon + longitude_pad,
	};
}

/** Compile a geo predicate to a bbox prefilter — never to a membership decision. */
function compileGeoOperator(
	state: CompileState,
	negated: boolean,
	lat_column: string,
	lon_column: string,
	operator: string,
	operand: unknown,
): string {
	state.exact = false;
	// Under a `not`, a narrowing prefilter would drop rows that must survive.
	if (negated) return '0';
	const box = geoBoundingBox(operator as 'radius' | 'polygon', operand);
	if (!box || !spend(state, 4)) return '1';
	const latitude = columnRef(state, lat_column);
	const longitude = columnRef(state, lon_column);
	state.params.push(box.min_lat, box.max_lat, box.min_lon, box.max_lon);
	return `(${latitude} >= ? AND ${latitude} <= ? AND ${longitude} >= ? AND ${longitude} <= ?)`;
}

/* --- tree ----------------------------------------------------------------- */

/** Whether every value in an operand is a string (arrays are checked per item). */
function operandIsAllStrings(operand: unknown): boolean {
	if (Array.isArray(operand)) return operand.every((item) => typeof item === 'string');
	return typeof operand === 'string';
}

/** Compile one normalized leaf (all its operators AND-composed). */
function compileLeaf(
	state: CompileState,
	negated: boolean,
	leaf: NormalizedWhere['leaves'][number],
): string {
	const placement = placeField(leaf.field, state.ctx);
	if (state.ctx.inexact_fields?.has(leaf.field)) return approximate(state, negated);
	if (
		placement.kind === 'column' &&
		state.ctx.text_affinity_fields?.has(leaf.field) === true &&
		leaf.operators.some(([, operand]) => !operandIsAllStrings(operand))
	) {
		// A TEXT-affinity column would coerce the operand (`col = 5` matching a
		// stored `'5'`); `core/where` decides this leaf instead.
		return approximate(state, negated);
	}
	const parts: string[] = [];
	for (const [operator, operand] of leaf.operators) {
		if (placement.kind === 'column' || placement.kind === 'generated') {
			parts.push(
				compileScalarOperator(
					state,
					negated,
					columnRef(state, placement.column),
					leaf.type,
					operator,
					operand,
				),
			);
		} else if (placement.kind === 'array') {
			parts.push(
				compileArrayOperator(
					state,
					negated,
					jsonExtract(state, placement.json_path),
					leaf.type,
					operator,
					operand,
				),
			);
		} else if (placement.kind === 'geo') {
			parts.push(
				compileGeoOperator(
					state,
					negated,
					placement.lat_column,
					placement.lon_column,
					operator,
					operand,
				),
			);
		} else {
			parts.push(approximate(state, negated));
		}
	}
	if (parts.length === 0) return unknownAt(negated);
	return parts.length === 1 ? parts[0] : `(${parts.join(' AND ')})`;
}

/** Compile a normalized `where` node. */
function compileNode(
	state: CompileState,
	negated: boolean,
	node: NormalizedWhere,
): string {
	const parts: string[] = [];
	for (const leaf of node.leaves) parts.push(compileLeaf(state, negated, leaf));
	if (node.and) {
		if (node.and.length === 0) parts.push('0');
		else {
			parts.push(
				`(${node.and.map((branch) => compileNode(state, negated, branch)).join(' AND ')})`,
			);
		}
	}
	if (node.or) {
		if (node.or.length === 0) parts.push('0');
		else {
			parts.push(
				`(${node.or.map((branch) => compileNode(state, negated, branch)).join(' OR ')})`,
			);
		}
	}
	if (node.not) {
		// Leaves are NULL-safe, so the tree is two-valued and a plain `NOT` is the
		// frozen `(col IS NULL OR NOT (...))` rule generalized to subtrees.
		parts.push(`NOT (${compileNode(state, !negated, node.not)})`);
	}
	if (parts.length === 0) return '1';
	return parts.length === 1 ? parts[0] : `(${parts.join(' AND ')})`;
}

/**
 * Compile a normalized `where` tree into a parameterized SQL predicate.
 *
 * Values are **always** bound parameters, never interpolated. When the whole
 * statement's parameter budget would be exceeded, the offending predicate
 * degrades to a polarity-correct literal and `exact` goes false — the caller
 * then re-decides with `core/where` instead of the query failing.
 */
export function compileWhere(
	where: NormalizedWhere | undefined,
	ctx: SqlWhereContext,
	budget: number = MAX_SQL_PARAMS,
): CompiledSql {
	if (!where) return { sql: '1', params: [], exact: true };
	const state: CompileState = { ctx, params: [], exact: true, budget };
	const sql = compileNode(state, false, where);
	return { sql, params: state.params, exact: state.exact };
}

/* -------------------------------------------------------------------------- */
/* Order compilation                                                          */
/* -------------------------------------------------------------------------- */

/** A compiled ORDER BY clause. */
export interface CompiledOrder {
	/** The clause body, without the `ORDER BY` keyword. */
	sql: string;
	/** False when some ordering field cannot be expressed in SQL exactly. */
	supported: boolean;
}

/** Ordering is only exact over scalar columns. */
function isOrderableType(type: SearchableType | undefined): boolean {
	return type === 'string' || type === 'number' || type === 'boolean' || type === 'enum';
}

/**
 * Compile `order[]` into `(col IS NULL), col ASC|DESC, …, pk ASC`.
 *
 * Nulls sort **last** regardless of direction (SQLite would put them first on
 * ASC), and every ordering ends with the primary-key ascending tie-break.
 * String columns keep the default BINARY collation, which over UTF-8 *is*
 * code-point order — the same order `core/compare` defines. No collation is
 * ever set.
 */
export function compileOrder(
	order: readonly SearchOrder[] | undefined,
	ctx: SqlWhereContext,
): CompiledOrder {
	const parts: string[] = [];
	let supported = true;
	for (const instruction of order ?? []) {
		const field = instruction.field;
		if (field === ctx.primary_key) {
			parts.push(
				`${quoteIdentifier(ctx.table_name)}.${quoteIdentifier(ctx.primary_key)} ${instruction.direction === 'DESC' ? 'DESC' : 'ASC'}`,
			);
			continue;
		}
		const placement = placeField(field, ctx);
		if (
			(placement.kind !== 'column' && placement.kind !== 'generated') ||
			!isOrderableType(ctx.schema[field])
		) {
			supported = false;
			break;
		}
		const reference = `${quoteIdentifier(ctx.table_name)}.${quoteIdentifier(placement.column)}`;
		parts.push(
			`(${reference} IS NULL)`,
			`${reference} ${instruction.direction === 'DESC' ? 'DESC' : 'ASC'}`,
		);
	}
	parts.push(
		`${quoteIdentifier(ctx.table_name)}.${quoteIdentifier(ctx.primary_key)} ASC`,
	);
	return { sql: parts.join(', '), supported };
}
