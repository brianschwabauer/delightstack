/**
 * The `where` DSL: normalization + JS predicate evaluation.
 * See `plans/database/Native Search Engine Plan.md` §5 and
 * `plans/database/orama-verification-report.md` §6, §7 and finding E.
 *
 * Frozen semantics:
 * - **Uniform array behavior.** On `string[]` / `number[]` / `enum[]` /
 *   `boolean[]`, `{eq: v}` and a bare `v` mean "the array contains `v`";
 *   `{in: [...]}` and a bare array mean "contains any"; `contains_all` means
 *   "every listed value present"; `not_in` means "present AND no element in the
 *   list". This deviates deliberately from Orama 3.1.18, where the same intents
 *   variously return a silent empty set, throw, or work depending on the index
 *   type behind the field.
 * - **Null rule.** Every leaf predicate is false when the field is missing or
 *   null — *except* inside `not`, which complements over the corpus, so a
 *   document missing the field passes `not: {...}`. `not_in` is not a `not`: it
 *   requires the field to be present.
 * - **Strict typed equality.** No coercion anywhere: `'5' !== 5`.
 * - `and: []` and `or: []` both evaluate to the empty set.
 * - Multiple operators in one object (`{gt: 1, lt: 9}`) compose as AND. Orama
 *   throws `INVALID_FILTER_OPERATION` here; composing is the deliberate,
 *   strictly more useful reading.
 * - Anything outside the matrix — unknown field, unknown operator, operator not
 *   valid for the field's declared type — throws `DelightError.badRequest`,
 *   never a silent empty result.
 */

import { DelightError } from '@delightstack/utilities';
import { compareValues } from './compare';
import { evaluateGeoOperation } from './geo';
import type { GeoOperation, SearchableType } from './types';

/** A flat map of dot-path → declared field type. The set of legal paths. */
export type WhereSchema = Record<string, SearchableType>;

/** Every operator the DSL understands. */
const KNOWN_OPERATORS = new Set([
	'eq',
	'in',
	'not_in',
	'contains_all',
	'contains_any',
	'gt',
	'gte',
	'lt',
	'lte',
	'between',
	'radius',
	'polygon',
]);

/** Operators whose operand must be an array of values. */
const LIST_OPERATORS = new Set(['in', 'not_in', 'contains_all', 'contains_any']);

/** Operators only valid on array-typed fields. */
const ARRAY_ONLY_OPERATORS = new Set(['contains_all', 'contains_any']);

/** Operators only valid on `geopoint` fields. */
const GEO_OPERATORS = new Set(['radius', 'polygon']);

/** A single normalized field predicate. */
export interface NormalizedLeaf {
	/** The dot path being filtered */
	field: string;
	/** The field's declared type */
	type: SearchableType;
	/** Operator name → operand, in ascending operator order (AND-composed) */
	operators: [string, unknown][];
}

/** A normalized `where` tree: leaves plus optional composites. */
export interface NormalizedWhere {
	/** Field predicates, sorted by field name for deterministic evaluation */
	leaves: NormalizedLeaf[];
	and?: NormalizedWhere[];
	or?: NormalizedWhere[];
	not?: NormalizedWhere;
}

/** Whether a declared type holds a list of values. */
export function isArrayFieldType(type: SearchableType): boolean {
	return (
		type === 'string[]' ||
		type === 'number[]' ||
		type === 'boolean[]' ||
		type === 'enum[]'
	);
}

/** Whether a declared type is a vector (never filterable). */
function isVectorFieldType(type: SearchableType): boolean {
	return typeof type === 'string' && type.startsWith('vector[');
}

/**
 * Read a dot path off a document.
 *
 * An exact key match wins first (flattened/derived rows store dotted keys
 * verbatim); otherwise the path is walked segment by segment. Walking through
 * an array yields `undefined` — child paths into arrays are not supported.
 */
export function getFieldValue(doc: Record<string, unknown>, path: string): unknown {
	if (!doc) return undefined;
	if (Object.hasOwn(doc, path)) return doc[path];
	if (!path.includes('.')) return undefined;
	let current: unknown = doc;
	for (const segment of path.split('.')) {
		if (current === null || typeof current !== 'object' || Array.isArray(current)) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

/** Whether an operand is a bare scalar (not an operator object). */
function isScalarOperand(operand: unknown): boolean {
	const type = typeof operand;
	return type === 'string' || type === 'number' || type === 'boolean';
}

/**
 * Normalize a raw `where` object into the evaluated tree, validating every
 * field and operator against the schema.
 *
 * Bare scalars become `{eq}` and bare arrays become `{in}` for every field type
 * (the old `normalizeWhere` only did this for `enum`/`number`, because that was
 * all Orama's grammar required). Only the canonical operator spellings are
 * understood — the pre-rename `containsAll`/`containsAny`/`nin` are unknown
 * operators and throw (decided 2026-08-12: no legacy read aliases).
 *
 * @throws DelightError 400 on an unknown field, unknown operator, or an
 *   operator that is invalid for the field's declared type.
 */
export function normalizeWhere(
	where: Record<string, unknown> | undefined | null,
	schema: WhereSchema,
): NormalizedWhere | undefined {
	if (!where || typeof where !== 'object') return undefined;
	const node: NormalizedWhere = { leaves: [] };

	for (const key of Object.keys(where).sort()) {
		const value = where[key];
		if (key === 'and' || key === 'or') {
			if (!Array.isArray(value)) {
				throw DelightError.badRequest(
					`The \`${key}\` filter must be an array of conditions.`,
					{
						code: 'invalid_filter_operation',
					},
				);
			}
			const branches = value.map(
				(branch) =>
					normalizeWhere(branch as Record<string, unknown>, schema) ?? { leaves: [] },
			);
			if (key === 'and') node.and = branches;
			else node.or = branches;
			continue;
		}
		if (key === 'not') {
			node.not = normalizeWhere(value as Record<string, unknown>, schema) ?? {
				leaves: [],
			};
			continue;
		}

		const type = schema[key];
		if (type === undefined) {
			throw DelightError.badRequest(`Unknown filter field "${key}".`, {
				code: 'unknown_filter_field',
			});
		}
		if (isVectorFieldType(type)) {
			throw DelightError.badRequest(`Vector field "${key}" cannot be filtered.`, {
				code: 'invalid_filter_operation',
			});
		}
		node.leaves.push({ field: key, type, operators: normalizeOperand(key, type, value) });
	}

	node.leaves.sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0));
	return node;
}

/** Normalize + validate one field's operand into an ordered operator list. */
function normalizeOperand(
	field: string,
	type: SearchableType,
	operand: unknown,
): [string, unknown][] {
	if (isScalarOperand(operand)) return validateOperators(field, type, { eq: operand });
	if (Array.isArray(operand)) return validateOperators(field, type, { in: operand });
	if (operand === null || operand === undefined) {
		return validateOperators(field, type, { eq: null });
	}
	if (typeof operand !== 'object') {
		throw DelightError.badRequest(`Invalid filter operand for field "${field}".`, {
			code: 'invalid_filter_operation',
		});
	}
	return validateOperators(field, type, operand as Record<string, unknown>);
}

/** Validate every operator against the field's declared type. */
function validateOperators(
	field: string,
	type: SearchableType,
	operators: Record<string, unknown>,
): [string, unknown][] {
	const keys = Object.keys(operators).sort();
	if (keys.length === 0) {
		throw DelightError.badRequest(`Filter for field "${field}" has no operators.`, {
			code: 'invalid_filter_operation',
		});
	}
	const is_geo = type === 'geopoint';
	const is_array = isArrayFieldType(type);
	for (const key of keys) {
		if (!KNOWN_OPERATORS.has(key)) {
			throw DelightError.badRequest(
				`Unknown filter operator "${key}" on field "${field}".`,
				{
					code: 'invalid_filter_operation',
				},
			);
		}
		if (is_geo !== GEO_OPERATORS.has(key)) {
			throw DelightError.badRequest(
				is_geo
					? `Field "${field}" is a geopoint — only \`radius\` and \`polygon\` filters apply.`
					: `The \`${key}\` filter only applies to geopoint fields, not "${field}".`,
				{ code: 'invalid_filter_operation' },
			);
		}
		if (ARRAY_ONLY_OPERATORS.has(key) && !is_array) {
			throw DelightError.badRequest(
				`The \`${key}\` filter only applies to array fields, not "${field}".`,
				{ code: 'invalid_filter_operation' },
			);
		}
		if (LIST_OPERATORS.has(key) && !Array.isArray(operators[key])) {
			throw DelightError.badRequest(
				`The \`${key}\` filter on "${field}" needs an array of values.`,
				{ code: 'invalid_filter_operation' },
			);
		}
		if (key === 'between') {
			const range = operators[key];
			if (!Array.isArray(range) || range.length !== 2) {
				throw DelightError.badRequest(
					`The \`between\` filter on "${field}" needs a [min, max] pair.`,
					{ code: 'invalid_filter_operation' },
				);
			}
		}
	}
	return keys.map((key) => [key, operators[key]] as [string, unknown]);
}

/** Whether any of `values` strictly equals `target`. */
function containsValue(values: readonly unknown[], target: unknown): boolean {
	for (const value of values) if (value === target) return true;
	return false;
}

/** Whether any of `values` appears in `list`. */
function containsAnyValue(values: readonly unknown[], list: readonly unknown[]): boolean {
	for (const value of values) if (containsValue(list, value)) return true;
	return false;
}

/** Apply an ordering comparison, using contains-semantics on array fields. */
function compareMatches(
	value: unknown,
	operand: unknown,
	predicate: (comparison: number) => boolean,
): boolean {
	if (Array.isArray(value)) {
		for (const element of value)
			if (predicate(compareValues(element, operand))) return true;
		return false;
	}
	return predicate(compareValues(value, operand));
}

/** Evaluate one operator against a present (non-null) field value. */
function evaluateOperator(value: unknown, operator: string, operand: unknown): boolean {
	const is_array = Array.isArray(value);
	switch (operator) {
		case 'eq':
			return is_array ? containsValue(value as unknown[], operand) : value === operand;
		case 'in':
		case 'contains_any':
			return is_array
				? containsAnyValue(value as unknown[], operand as unknown[])
				: containsValue(operand as unknown[], value);
		case 'not_in':
			return is_array
				? !containsAnyValue(value as unknown[], operand as unknown[])
				: !containsValue(operand as unknown[], value);
		case 'contains_all': {
			const values = value as unknown[];
			for (const wanted of operand as unknown[]) {
				if (!containsValue(values, wanted)) return false;
			}
			return true;
		}
		case 'gt':
			return compareMatches(value, operand, (comparison) => comparison > 0);
		case 'gte':
			return compareMatches(value, operand, (comparison) => comparison >= 0);
		case 'lt':
			return compareMatches(value, operand, (comparison) => comparison < 0);
		case 'lte':
			return compareMatches(value, operand, (comparison) => comparison <= 0);
		case 'between': {
			const [min, max] = operand as [unknown, unknown];
			if (Array.isArray(value)) {
				for (const element of value) {
					if (compareValues(element, min) >= 0 && compareValues(element, max) <= 0)
						return true;
				}
				return false;
			}
			return compareValues(value, min) >= 0 && compareValues(value, max) <= 0;
		}
		case 'radius':
			return evaluateGeoOperation(value, { radius: operand } as GeoOperation);
		case 'polygon':
			return evaluateGeoOperation(value, { polygon: operand } as GeoOperation);
		default:
			return false;
	}
}

/** Evaluate a single normalized leaf against a document. */
function evaluateLeaf(doc: Record<string, unknown>, leaf: NormalizedLeaf): boolean {
	const value = getFieldValue(doc, leaf.field);
	// The frozen null rule: every leaf is false on a missing or null field.
	if (value === null || value === undefined) return false;
	for (const [operator, operand] of leaf.operators) {
		if (!evaluateOperator(value, operator, operand)) return false;
	}
	return true;
}

/**
 * Evaluate a normalized `where` tree against a document.
 *
 * An absent tree (no filter) matches everything; `and: []` and `or: []` match
 * nothing.
 */
export function evaluateWhere(
	doc: Record<string, unknown>,
	where: NormalizedWhere | undefined,
): boolean {
	if (!where) return true;
	for (const leaf of where.leaves) {
		if (!evaluateLeaf(doc, leaf)) return false;
	}
	if (where.and) {
		if (where.and.length === 0) return false;
		for (const branch of where.and) if (!evaluateWhere(doc, branch)) return false;
	}
	if (where.or) {
		if (where.or.length === 0) return false;
		let matched = false;
		for (const branch of where.or) {
			if (evaluateWhere(doc, branch)) {
				matched = true;
				break;
			}
		}
		if (!matched) return false;
	}
	// `not` complements over the corpus, so documents missing the field pass.
	if (where.not && evaluateWhere(doc, where.not)) return false;
	return true;
}

/** Normalize and evaluate in one step (convenience for callers holding raw JSON). */
export function matchesWhere(
	doc: Record<string, unknown>,
	where: Record<string, unknown> | undefined,
	schema: WhereSchema,
): boolean {
	return evaluateWhere(doc, normalizeWhere(where, schema));
}
