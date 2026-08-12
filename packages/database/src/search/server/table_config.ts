/**
 * The bridge from a `Database.table()` config to a {@link ServerSearchTable}.
 *
 * `schema.ts` describes a table twice: a *nested* search schema (objects keep
 * their shape) and a flat list of dot-path `searchable_fields`. The driver
 * wants one flat `path → type` map plus the SQL placement facts
 * (`sql_where.ts`'s four-way split), so this module derives both from the table
 * config — nothing here is stored, it is recomputed on every Durable Object
 * wake and is a pure function of the schema.
 *
 * **Enum affinity (stage-2 finding).** `schema.enum()` is built on
 * `z.enum(values)`, so every declared option is a *string* and a real enum
 * column can only ever hold TEXT — read-back therefore restores the declared
 * type with no coercion. The lossy direction is the *operand*: an enum column
 * is declared `TEXT`, and SQLite applies the column's TEXT affinity to a bound
 * operand, so `status = 5` would match a stored `'5'` even though the frozen
 * DSL (and `core/where`) compare by storage class and say it does not. Enum
 * fields backed by a real column are therefore reported as
 * `text_affinity_fields`; the compiler degrades **only the predicates carrying
 * a non-string operand** on them to a polarity-correct literal and lets
 * `core/where` decide. String operands — the overwhelmingly common case, e.g.
 * `where: { status: 'active' }` — stay fully pushed down and indexed.
 */

import type { SearchableType } from '../core/types';
import type { WhereSchema } from '../core/where';
import { defineServerTable, type ServerSearchTable } from './engine';

/** The structural subset of a `Database.table()` result this module reads. */
export interface SearchTableSource {
	name: string;
	/** The field shape — read only to find `derived()` fields. */
	readonly _?: Record<string, { readonly _?: { derived?: boolean } }>;
	config: {
		primary_key: string;
		primary_key_type?: 'string' | 'number';
		table_definition?: Record<string, unknown>;
		derived_fields?: Record<string, { foreign_keys?: string[] }>;
		index_schema: unknown;
	};
}

/** Every declared type the flattener recognizes as a leaf. */
function isSearchableType(value: unknown): value is SearchableType {
	if (typeof value !== 'string') return false;
	return (
		value === 'string' ||
		value === 'number' ||
		value === 'boolean' ||
		value === 'enum' ||
		value === 'geopoint' ||
		value === 'string[]' ||
		value === 'number[]' ||
		value === 'boolean[]' ||
		value === 'enum[]' ||
		value.startsWith('vector[')
	);
}

/**
 * Flatten the nested search schema into the driver's `dot.path → type` map.
 *
 * Object fields contribute only their leaves — `{ address: { city: 'string' } }`
 * becomes `{ 'address.city': 'string' }` — which is exactly the closed path set
 * `searchable_fields` lists and `sql_where.ts` compiles against.
 */
export function flattenSearchSchema(schema: unknown, prefix = ''): WhereSchema {
	const flat: WhereSchema = {};
	if (!schema || typeof schema !== 'object') return flat;
	for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (isSearchableType(value)) {
			flat[path] = value;
			continue;
		}
		Object.assign(flat, flattenSearchSchema(value, path));
	}
	return flat;
}

/**
 * Build the native driver's view of one entity table.
 *
 * `columns` is the real SQLite column set (`table_definition` keys, which
 * already include the auto-managed `created_at`/`updated_at`), so
 * `sql_where.placeField` can tell a top-level scalar column apart from a child
 * path that needs a generated column.
 */
export function buildServerSearchTable(
	entity_type: string,
	table: SearchTableSource,
): ServerSearchTable {
	const schema = flattenSearchSchema(table.config.index_schema);
	const table_definition = table.config.table_definition ?? {};
	const columns = new Set(Object.keys(table_definition));
	// EVERY `derived()` field, not just the FK-dependent ones `config.derived_fields`
	// lists: same-table derived values are computed by `toSparse` and have no
	// column either, so both kinds live in the row's `$derived` sub-object and
	// both compile to a generated column over it (§7.0).
	const derived_fields = new Set(Object.keys(table.config.derived_fields ?? {}));
	for (const [field_name, field] of Object.entries(table._ ?? {})) {
		if (field?._?.derived) derived_fields.add(field_name);
	}
	const text_affinity_fields = new Set<string>();
	for (const [column, definition] of Object.entries(table_definition)) {
		if (typeof definition !== 'string') continue;
		// Only a *declared* TEXT affinity coerces a bound operand. Generated
		// columns are declared with no type name on purpose (see `sql_where.ts`),
		// so they never appear here.
		if (!/^TEXT\b/i.test(definition)) continue;
		if (schema[column] === 'enum') text_affinity_fields.add(column);
	}
	return defineServerTable({
		entity_type,
		table_name: table.name.toLowerCase(),
		schema,
		primary_key: table.config.primary_key || 'id',
		primary_key_type: table.config.primary_key_type ?? 'string',
		columns,
		derived_fields: derived_fields.size > 0 ? derived_fields : undefined,
		text_affinity_fields:
			text_affinity_fields.size > 0 ? text_affinity_fields : undefined,
	});
}
