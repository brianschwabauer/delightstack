// @vitest-environment node
/**
 * A write the caller rolls back to a savepoint (a failed row in the
 * raw-write catch-up, a create() whose error an app catches inside batch())
 * must not leave the store's in-memory caches pointing at rows that no longer
 * exist. Found in review: the cached field id outlived its row, and later
 * writes indexed under it, unsearchable for good.
 */

import { describe, expect, it } from 'vitest';
import {
	createEntityTable,
	insertEntityRow,
	NodeSqlStorage,
} from '../__tests__/sqlite_harness.js';
import { pluralVariants } from '../core/expansion.js';
import type { WhereSchema } from '../core/where.js';
import { SqliteSearchEngine } from './engine.js';

const SCHEMA: WhereSchema = { id: 'enum', title: 'string', updated_at: 'number' };

function setup() {
	const sql = new NodeSqlStorage();
	const engine = new SqliteSearchEngine(sql);
	engine.bootstrap();
	const table = createEntityTable(sql, {
		entity_type: 'note',
		table_name: 'notes',
		schema: SCHEMA,
		primary_key: 'id',
		primary_key_type: 'string',
	});
	engine.register(table);
	return { sql, engine, table };
}

describe('a rolled-back first write to a field', () => {
	it('leaves later writes indexed under a live field id', () => {
		const { sql, engine, table } = setup();
		sql.exec('SAVEPOINT row1;');
		engine.indexDocument('note', '1', { id: '1', title: 'hello world', updated_at: 1 });
		sql.exec('ROLLBACK TO row1;');
		sql.exec('RELEASE row1;');

		insertEntityRow(sql, table, { id: '2', title: 'hello again', updated_at: 2 });
		engine.indexDocument('note', '2', { id: '2', title: 'hello again', updated_at: 2 });

		const orphans = sql
			.exec(
				'SELECT COUNT(*) AS n FROM search_entries WHERE fid NOT IN (SELECT fid FROM search_fields);',
			)
			.toArray()[0].n;
		expect(orphans).toBe(0);
		expect(engine.store.getFieldStats('note', 'title')).toEqual({
			doc_count: 1,
			total_len: 2,
		});
		expect(engine.list('note', { term: 'hello' }).hits.map((hit) => hit.id)).toEqual(['2']);
	});
});

describe('plural variants', () => {
	it('derive one singular per word', () => {
		expect(pluralVariants('properties')).toEqual(['property']);
		expect(pluralVariants('boxes')).toEqual(['box']);
		expect(pluralVariants('contracts')).toEqual(['contract']);
	});
});
