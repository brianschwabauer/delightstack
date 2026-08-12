// @vitest-environment node
/**
 * `sql_where.ts` unit tests (plan §7.4, §5.1).
 *
 * Two kinds of assertion live here. The *shape* tests pin the emitted SQL for
 * each compiler rule, because those strings are the contract with SQLite's
 * query planner (an index is only used if the predicate is written the way the
 * planner expects). The *agreement* tests run the compiled SQL against real
 * SQLite and compare it, row for row, with `core/where` over the same
 * documents — that is the property that actually matters: SQL may only be an
 * optimization, never a second opinion.
 */

import { describe, expect, it } from 'vitest';
import { DelightError } from '@delightstack/utilities';
import { evaluateWhere, normalizeWhere, type WhereSchema } from '../core/where';
import { evaluateGeoOperation } from '../core/geo';
import type { GeoPoint } from '../core/types';
import {
	createEntityTable,
	insertEntityRow,
	NodeSqlStorage,
} from '../__tests__/sqlite_harness';
import { rowToDocument, whereContext, type ServerSearchTable } from './engine';
import {
	compileOrder,
	compileWhere,
	generatedColumnStatements,
	geoBoundingBox,
	placeField,
	planGeneratedColumnMigration,
	planGeneratedColumns,
	quoteIdentifier,
	type SqlWhereContext,
} from './sql_where';

const SCHEMA: WhereSchema = {
	id: 'string',
	title: 'string',
	rating: 'number',
	is_published: 'boolean',
	status: 'enum',
	tags: 'string[]',
	label_ids: 'enum[]',
	'address.city': 'string',
	'address.zip': 'string',
	author_name: 'string',
	location: 'geopoint',
	embedding: 'vector[3]',
};

const CTX: SqlWhereContext = {
	table_name: 'articles',
	schema: SCHEMA,
	columns: new Set(['id', 'title', 'rating', 'is_published', 'status']),
	derived_fields: new Set(['author_name']),
	primary_key: 'id',
};

/** Compile a raw `where` object end to end. */
function compile(where: Record<string, unknown>, ctx: SqlWhereContext = CTX) {
	return compileWhere(normalizeWhere(where, ctx.schema), ctx);
}

/* -------------------------------------------------------------------------- */
/* Placement                                                                  */
/* -------------------------------------------------------------------------- */

describe('field placement — the four-way split', () => {
	it('maps a top-level scalar to its real column', () => {
		expect(placeField('title', CTX)).toEqual({ kind: 'column', column: 'title' });
	});

	it('maps an object child path to a generated column', () => {
		expect(placeField('address.city', CTX)).toEqual({
			kind: 'generated',
			column: 'sv$address__city',
			json_path: '$.address.city',
		});
	});

	it('maps an array field to a json_each path', () => {
		expect(placeField('tags', CTX)).toEqual({ kind: 'array', json_path: '$.tags' });
	});

	it('maps an FK-derived field into the $derived sub-object', () => {
		expect(placeField('author_name', CTX)).toEqual({
			kind: 'generated',
			column: 'sv$author_name',
			json_path: '$."$derived".author_name',
		});
	});

	it('maps a geopoint to its lat/lon column pair', () => {
		expect(placeField('location', CTX)).toEqual({
			kind: 'geo',
			lat_column: 'sv$location__lat',
			lon_column: 'sv$location__lon',
			json_path: '$.location',
		});
	});

	it('refuses a path that is not a plain identifier path', () => {
		expect(() =>
			placeField('bad-name', { ...CTX, schema: { 'bad-name': 'string' } }),
		).toThrow(DelightError);
	});
});

/* -------------------------------------------------------------------------- */
/* Compiler rules                                                             */
/* -------------------------------------------------------------------------- */

describe('compiler rules', () => {
	it('binds every value — never interpolates', () => {
		const compiled = compile({ title: "o'brien; DROP TABLE articles;--" });
		expect(compiled.sql).toBe('IFNULL("articles"."title" = ?, 0)');
		expect(compiled.params).toEqual(["o'brien; DROP TABLE articles;--"]);
		expect(compiled.exact).toBe(true);
	});

	it('compares booleans as 0/1', () => {
		expect(compile({ is_published: true })).toEqual({
			sql: 'IFNULL("articles"."is_published" = ?, 0)',
			params: [1],
			exact: true,
		});
		expect(compile({ is_published: false }).params).toEqual([0]);
	});

	it('reads a child path through its generated column', () => {
		expect(compile({ 'address.city': 'Zürich' })).toEqual({
			sql: 'IFNULL("articles"."sv$address__city" = ?, 0)',
			params: ['Zürich'],
			exact: true,
		});
	});

	it('compiles ordering operators and between', () => {
		expect(compile({ rating: { gte: 3 } }).sql).toBe(
			'IFNULL("articles"."rating" >= ?, 0)',
		);
		expect(compile({ rating: { between: [1, 5] } })).toEqual({
			sql: 'IFNULL("articles"."rating" >= ? AND "articles"."rating" <= ?, 0)',
			params: [1, 5],
			exact: true,
		});
	});

	it('AND-composes multiple operators on one field', () => {
		const compiled = compile({ rating: { gt: 1, lt: 9 } });
		expect(compiled.sql).toBe(
			'(IFNULL("articles"."rating" > ?, 0) AND IFNULL("articles"."rating" < ?, 0))',
		);
		expect(compiled.params).toEqual([1, 9]);
	});

	it('compiles in / not_in, with not_in requiring the field to be present', () => {
		expect(compile({ status: { in: ['a', 'b'] } })).toEqual({
			sql: 'IFNULL("articles"."status" IN (?, ?), 0)',
			params: ['a', 'b'],
			exact: true,
		});
		expect(compile({ status: { not_in: ['a'] } }).sql).toBe(
			'("articles"."status" IS NOT NULL AND "articles"."status" NOT IN (?))',
		);
	});

	it('matches nothing for in: [] and everything present for not_in: []', () => {
		expect(compile({ status: { in: [] } }).sql).toBe('0');
		expect(compile({ status: { not_in: [] } }).sql).toBe(
			'"articles"."status" IS NOT NULL',
		);
	});

	it('chunks a long IN list into groups', () => {
		const values = Array.from({ length: 80 }, (_, index) => `v${index}`);
		const compiled = compile({ status: { in: values } });
		expect(compiled.params).toHaveLength(80);
		expect(compiled.sql.split(' OR ')).toHaveLength(2);
		expect(compiled.exact).toBe(true);
	});

	it('degrades to core evaluation rather than blowing the 100-parameter cap', () => {
		const values = Array.from({ length: 400 }, (_, index) => `v${index}`);
		const compiled = compile({ status: { in: values } });
		expect(compiled.sql).toBe('1');
		expect(compiled.params).toEqual([]);
		expect(compiled.exact).toBe(false);
	});

	it('emits `not` so that documents missing the field survive', () => {
		const compiled = compile({ not: { status: 'draft' } });
		expect(compiled.sql).toBe('NOT (IFNULL("articles"."status" = ?, 0))');
		expect(compiled.exact).toBe(true);
	});

	it('turns an approximate predicate into 0 under a `not`', () => {
		const values = Array.from({ length: 400 }, (_, index) => `v${index}`);
		const compiled = compile({ not: { status: { in: values } } });
		expect(compiled.sql).toBe('NOT (0)');
		expect(compiled.exact).toBe(false);
	});

	it('makes and: [] and or: [] the empty set', () => {
		expect(compile({ and: [] }).sql).toBe('0');
		expect(compile({ or: [] }).sql).toBe('0');
	});

	it('composes array predicates through json_each, table-qualified', () => {
		const compiled = compile({ tags: { contains_all: ['x', 'y'] } });
		expect(compiled.sql).toBe(
			'(EXISTS (SELECT 1 FROM json_each(json_extract("articles"."json", \'$.tags\')) WHERE json_each.value = ?)' +
				' AND EXISTS (SELECT 1 FROM json_each(json_extract("articles"."json", \'$.tags\')) WHERE json_each.value = ?))',
		);
		expect(compiled.params).toEqual(['x', 'y']);
	});

	it('makes contains_all: [] a presence check and contains_any: [] empty', () => {
		expect(compile({ tags: { contains_all: [] } }).sql).toBe(
			'(json_extract("articles"."json", \'$.tags\') IS NOT NULL)',
		);
		expect(compile({ tags: { contains_any: [] } }).sql).toBe('0');
	});

	it('treats eq on an array field as containment', () => {
		expect(compile({ tags: { eq: 'x' } }).sql).toContain('json_each.value = ?');
	});

	it('falls back to core when the operand type does not match the field', () => {
		const compiled = compile({ rating: { eq: 'five' } as never });
		expect(compiled.sql).toBe('1');
		expect(compiled.exact).toBe(false);
	});

	it('never decides geo membership — it only emits a bbox prefilter', () => {
		const compiled = compile({
			location: { radius: { coordinates: { lat: 47, lon: 8 }, value: 1000 } },
		});
		expect(compiled.exact).toBe(false);
		expect(compiled.sql).toBe(
			'("articles"."sv$location__lat" >= ? AND "articles"."sv$location__lat" <= ?' +
				' AND "articles"."sv$location__lon" >= ? AND "articles"."sv$location__lon" <= ?)',
		);
		expect(compiled.params).toHaveLength(4);
	});

	it('drops the geo prefilter under a `not` and inside an inside:false query', () => {
		expect(
			compile({
				not: { location: { radius: { coordinates: { lat: 47, lon: 8 }, value: 1000 } } },
			}).sql,
		).toBe('NOT (0)');
		expect(
			compile({
				location: {
					radius: { coordinates: { lat: 47, lon: 8 }, value: 1000, inside: false },
				},
			}).sql,
		).toBe('1');
	});

	it('honours the inexact_fields escape hatch', () => {
		const compiled = compile(
			{ status: 'published' },
			{ ...CTX, inexact_fields: new Set(['status']) },
		);
		expect(compiled.sql).toBe('1');
		expect(compiled.exact).toBe(false);
	});
});

/* -------------------------------------------------------------------------- */
/* Order                                                                      */
/* -------------------------------------------------------------------------- */

describe('order compilation', () => {
	it('sorts nulls last regardless of direction and ends with the PK', () => {
		expect(compileOrder([{ field: 'rating', direction: 'DESC' }], CTX)).toEqual({
			sql: '("articles"."rating" IS NULL), "articles"."rating" DESC, "articles"."id" ASC',
			supported: true,
		});
	});

	it('orders by a child path through its generated column', () => {
		expect(compileOrder([{ field: 'address.city' }], CTX).sql).toContain(
			'"articles"."sv$address__city" ASC',
		);
	});

	it('falls back to a JS sort for array and geopoint fields', () => {
		expect(compileOrder([{ field: 'tags' }], CTX).supported).toBe(false);
		expect(compileOrder([{ field: 'location' }], CTX).supported).toBe(false);
	});

	it('defaults to the primary key alone', () => {
		expect(compileOrder(undefined, CTX)).toEqual({
			sql: '"articles"."id" ASC',
			supported: true,
		});
	});
});

/* -------------------------------------------------------------------------- */
/* Generated columns + migration                                              */
/* -------------------------------------------------------------------------- */

describe('generated columns', () => {
	it('plans one column per child path and two per geopoint', () => {
		expect(planGeneratedColumns(CTX).map((spec) => spec.column)).toEqual([
			'sv$address__city',
			'sv$address__zip',
			'sv$author_name',
			'sv$location__lat',
			'sv$location__lon',
		]);
	});

	it('declares generated columns with no type, so comparisons stay strict', () => {
		const [statement] = generatedColumnStatements(
			'articles',
			planGeneratedColumns(CTX)[0],
		);
		expect(statement).toBe(
			'ALTER TABLE "articles" ADD COLUMN "sv$address__city"' +
				' GENERATED ALWAYS AS (json_extract("json", \'$.address.city\')) VIRTUAL;',
		);
	});

	it('adds new columns and drops the index before the column on removal', () => {
		const migration = planGeneratedColumnMigration({
			table_name: 'articles',
			desired: planGeneratedColumns(CTX),
			existing_columns: ['id', 'title', 'json', 'sv$address__city', 'sv$gone'],
		});
		expect(migration.added.map((spec) => spec.column)).toEqual([
			'sv$address__zip',
			'sv$author_name',
			'sv$location__lat',
			'sv$location__lon',
		]);
		expect(migration.removed).toEqual(['sv$gone']);
		const drop_index = migration.statements.findIndex((s) => s.startsWith('DROP INDEX'));
		const drop_column = migration.statements.findIndex((s) => s.includes('DROP COLUMN'));
		expect(drop_index).toBeGreaterThan(-1);
		expect(drop_index).toBeLessThan(drop_column);
	});

	it('is a no-op when the table already matches', () => {
		const desired = planGeneratedColumns(CTX);
		const migration = planGeneratedColumnMigration({
			table_name: 'articles',
			desired,
			existing_columns: ['id', 'json', ...desired.map((spec) => spec.column)],
		});
		expect(migration.statements).toEqual([]);
	});

	it('throws a descriptive DelightError before emitting any DDL when over budget', () => {
		const existing = Array.from({ length: 96 }, (_, index) => `c${index}`);
		try {
			planGeneratedColumnMigration({
				table_name: 'articles',
				desired: planGeneratedColumns(CTX),
				existing_columns: existing,
			});
			expect.unreachable('the budget check must throw');
		} catch (error) {
			expect(DelightError.is(error)).toBe(true);
			expect((error as DelightError).message).toContain('caps a table at 100');
			expect((error as DelightError).message).toContain('101 columns');
		}
	});

	it('reads back generated columns only through PRAGMA table_xinfo', () => {
		// `PRAGMA table_info` hides VIRTUAL generated columns entirely — diffing
		// against it would re-ADD COLUMN on every boot and fail.
		const sql = new NodeSqlStorage();
		createEntityTable(sql, {
			entity_type: 'article',
			table_name: 'articles',
			schema: SCHEMA,
			primary_key: 'id',
			primary_key_type: 'string',
			derived_fields: ['author_name'],
		});
		const info = sql
			.exec('PRAGMA table_info(articles);')
			.toArray()
			.map((row) => String(row.name));
		const xinfo = sql
			.exec('PRAGMA table_xinfo(articles);')
			.toArray()
			.map((row) => String(row.name));
		expect(info).not.toContain('sv$address__city');
		expect(xinfo).toContain('sv$address__city');
		expect(
			planGeneratedColumnMigration({
				table_name: 'articles',
				desired: planGeneratedColumns(CTX),
				existing_columns: xinfo,
			}).statements,
		).toEqual([]);
	});
});

/* -------------------------------------------------------------------------- */
/* SQL vs core agreement over real data                                       */
/* -------------------------------------------------------------------------- */

const DOCUMENTS: Record<string, unknown>[] = [
	{
		id: 'a',
		title: 'alpha',
		rating: 3,
		is_published: true,
		status: 'published',
		tags: ['x', 'y'],
		label_ids: ['l_red'],
		address: { city: 'Zürich', zip: '8001' },
		location: { lat: 47.3769, lon: 8.5417 },
	},
	{
		id: 'b',
		title: 'beta',
		rating: 9,
		is_published: false,
		status: 'draft',
		tags: ['y'],
		label_ids: [],
		address: { city: '東京', zip: '100' },
		location: { lat: 35.6762, lon: 139.6503 },
	},
	{ id: 'c', title: '', rating: 0, is_published: true, status: 'published', tags: [] },
	{ id: 'd', title: 'delta', address: { city: 'Zürich' } },
	{
		id: 'e',
		title: 'epsilon',
		rating: 5,
		status: 'archived',
		tags: ['z'],
		location: { lat: 47.3769, lon: 8.5417 },
	},
];

/** A database holding {@link DOCUMENTS}. */
function loadDocuments(): { sql: NodeSqlStorage; table: ServerSearchTable } {
	const sql = new NodeSqlStorage();
	const table = createEntityTable(sql, {
		entity_type: 'article',
		table_name: 'articles',
		schema: SCHEMA,
		primary_key: 'id',
		primary_key_type: 'string',
	});
	for (const document of DOCUMENTS) insertEntityRow(sql, table, document);
	return { sql, table };
}

/** Ids the compiled SQL selects. */
function sqlIds(
	sql: NodeSqlStorage,
	table: ServerSearchTable,
	where: Record<string, unknown>,
): string[] {
	const compiled = compileWhere(normalizeWhere(where, table.schema), whereContext(table));
	return sql
		.exec(
			`SELECT * FROM ${quoteIdentifier(table.table_name)} WHERE ${compiled.sql};`,
			...compiled.params,
		)
		.toArray()
		.map((row) => String(rowToDocument(table, row).id))
		.sort();
}

/** Ids `core/where` selects over the same rows. */
function coreIds(
	sql: NodeSqlStorage,
	table: ServerSearchTable,
	where: Record<string, unknown>,
): string[] {
	const node = normalizeWhere(where, table.schema);
	return sql
		.exec(`SELECT * FROM ${quoteIdentifier(table.table_name)};`)
		.toArray()
		.map((row) => rowToDocument(table, row))
		.filter((document) => evaluateWhere(document, node))
		.map((document) => String(document.id))
		.sort();
}

const EXACT_CASES: Record<string, unknown>[] = [
	{ status: 'published' },
	{ status: { not_in: ['published'] } },
	{ not: { status: 'published' } },
	{ is_published: true },
	{ is_published: false },
	{ not: { is_published: true } },
	{ rating: { gte: 3 } },
	{ rating: { between: [1, 5] } },
	{ title: '' },
	{ 'address.city': 'Zürich' },
	{ 'address.city': { gt: 'Z' } },
	{ not: { 'address.city': 'Zürich' } },
	{ tags: { contains_all: ['x', 'y'] } },
	{ tags: { contains_any: ['x', 'z'] } },
	{ tags: { eq: 'y' } },
	{ tags: { contains_all: [] } },
	{ tags: { not_in: ['x'] } },
	{ label_ids: { contains_all: [] } },
	{ and: [{ status: 'published' }, { rating: { gt: 1 } }] },
	{ or: [{ status: 'draft' }, { rating: { gte: 5 } }] },
	{ and: [] },
	{ or: [] },
	{ not: { and: [{ status: 'published' }, { is_published: true }] } },
];

describe('SQL and core/where agree', () => {
	const { sql, table } = loadDocuments();

	it.each(EXACT_CASES.map((where) => [JSON.stringify(where), where] as const))(
		'%s',
		(_label, where) => {
			const compiled = compileWhere(
				normalizeWhere(where as Record<string, unknown>, table.schema),
				whereContext(table),
			);
			expect(compiled.exact, 'this case is meant to be exactly pushed down').toBe(true);
			expect(sqlIds(sql, table, where as Record<string, unknown>)).toEqual(
				coreIds(sql, table, where as Record<string, unknown>),
			);
		},
	);
});

/* -------------------------------------------------------------------------- */
/* Geo bbox                                                                   */
/* -------------------------------------------------------------------------- */

describe('geo bounding box', () => {
	it('has no box for a complement or a degenerate ring', () => {
		expect(
			geoBoundingBox('radius', {
				coordinates: { lat: 47, lon: 8 },
				value: 1,
				inside: false,
			}),
		).toBeUndefined();
		expect(
			geoBoundingBox('polygon', { coordinates: [{ lat: 0, lon: 0 }] }),
		).toBeUndefined();
	});

	it('widens to the full longitude range near a pole', () => {
		const box = geoBoundingBox('radius', {
			coordinates: { lat: 89.9, lon: 0 },
			value: 100,
			unit: 'km',
		});
		expect(box?.min_lon).toBeLessThanOrEqual(-180);
		expect(box?.max_lon).toBeGreaterThanOrEqual(180);
	});

	it('takes the vertex min/max for a polygon', () => {
		const box = geoBoundingBox('polygon', {
			coordinates: [
				{ lat: 47, lon: 8 },
				{ lat: 47, lon: 9 },
				{ lat: 48, lon: 9 },
			],
		});
		expect(box?.min_lat).toBeLessThanOrEqual(47);
		expect(box?.max_lat).toBeGreaterThanOrEqual(48);
	});

	it('never excludes a point the exact check would include', () => {
		// A deterministic grid around a centre, including the exact boundary.
		const centre: GeoPoint = { lat: 47.3769, lon: 8.5417 };
		const points: GeoPoint[] = [];
		for (let lat_step = -20; lat_step <= 20; lat_step++) {
			for (let lon_step = -20; lon_step <= 20; lon_step++) {
				points.push({
					lat: centre.lat + lat_step * 0.002,
					lon: centre.lon + lon_step * 0.002,
				});
			}
		}
		for (const radius of [50, 250, 1000, 5000]) {
			const operand = { coordinates: centre, value: radius };
			const box = geoBoundingBox('radius', operand);
			expect(box).toBeDefined();
			for (const point of points) {
				if (!evaluateGeoOperation(point, { radius: operand })) continue;
				expect(
					point.lat >= (box as { min_lat: number }).min_lat &&
						point.lat <= (box as { max_lat: number }).max_lat &&
						point.lon >= (box as { min_lon: number }).min_lon &&
						point.lon <= (box as { max_lon: number }).max_lon,
					`radius ${radius} lost ${JSON.stringify(point)}`,
				).toBe(true);
			}
		}
	});
});
