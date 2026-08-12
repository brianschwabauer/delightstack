// @vitest-environment node
/**
 * `sqlite_store.ts` unit tests (plan §7.1–§7.3), over real SQLite.
 *
 * The central assertion is a **full-table comparison against a from-scratch
 * rebuild**: whatever sequence of creates, updates and deletes a corpus goes
 * through, the postings, `df`, per-document lengths and field statistics must
 * end up byte-identical to indexing the final documents into an empty database.
 * That is the only check that catches a drifting `df` or a leaked field-stat
 * decrement, which are silent corruptions that would only surface later as
 * wrong BM25 scores.
 */

import { describe, expect, it } from 'vitest';
import { DelightError } from '@delightstack/utilities';
import { NodeSqlStorage } from '../__tests__/sqlite_harness';
import {
	defineSearchType,
	MAX_INSERT_ROWS,
	POSTING_COLUMNS,
	prefixUpperBound,
	SqliteSearchStore,
	TOMBSTONE_CAP,
	type SearchTypeConfig,
} from './sqlite_store';

const SCHEMA = {
	id: 'string',
	title: 'string',
	body: 'string',
	tags: 'string[]',
	embedding: 'vector[3]',
} as const;

const CONFIG: SearchTypeConfig = defineSearchType({
	entity_type: 'article',
	schema: { ...SCHEMA },
	primary_key: 'id',
	primary_key_type: 'string',
});

/** A store over a fresh in-memory database. */
function newStore(): { sql: NodeSqlStorage; store: SqliteSearchStore } {
	const sql = new NodeSqlStorage();
	const store = new SqliteSearchStore(sql);
	store.bootstrap();
	return { sql, store };
}

/** Every search row, ordered, as a comparable snapshot. */
function dump(sql: NodeSqlStorage): Record<string, Record<string, unknown>[]> {
	const read = (query: string): Record<string, unknown>[] => sql.exec(query).toArray();
	return {
		postings: read(
			'SELECT * FROM search_postings ORDER BY entity_type, field, token, doc_id;',
		),
		tokens: read('SELECT * FROM search_tokens ORDER BY entity_type, field, token;'),
		docs: read('SELECT * FROM search_docs ORDER BY entity_type, doc_id;'),
		field_stats: read('SELECT * FROM search_field_stats ORDER BY entity_type, field;'),
		vectors: read(
			'SELECT entity_type, field, doc_id FROM search_vectors ORDER BY entity_type, field, doc_id;',
		),
	};
}

/** Index a set of documents into a brand-new database. */
function rebuildFromScratch(documents: Record<string, unknown>[]): NodeSqlStorage {
	const { sql, store } = newStore();
	for (const document of documents) {
		store.indexDocument(CONFIG, String(document.id), document);
	}
	return sql;
}

const DOC_A = {
	id: 'a',
	title: 'data database',
	body: 'alpha alpha beta',
	tags: ['x', 'y'],
};
const DOC_B = { id: 'b', title: 'token tokenizer', body: 'beta gamma', tags: ['y'] };
const DOC_C = { id: 'c', title: 'hello world', body: '', tags: [] };

describe('write path — diffing', () => {
	it('matches a from-scratch rebuild after an update with the previous document', () => {
		const { sql, store } = newStore();
		store.indexDocument(CONFIG, 'a', DOC_A);
		store.indexDocument(CONFIG, 'b', DOC_B);
		store.indexDocument(CONFIG, 'c', DOC_C);
		const updated = { ...DOC_A, title: 'dataset datum', body: 'alpha' };
		store.indexDocument(CONFIG, 'a', updated, DOC_A);
		expect(dump(sql)).toEqual(dump(rebuildFromScratch([updated, DOC_B, DOC_C])));
	});

	it('matches a from-scratch rebuild via the DELETE ... RETURNING fallback', () => {
		const { sql, store } = newStore();
		store.indexDocument(CONFIG, 'a', DOC_A);
		store.indexDocument(CONFIG, 'b', DOC_B);
		const updated = { ...DOC_A, title: 'dataset datum', body: 'alpha' };
		// No previous document in hand — the repair path.
		store.indexDocument(CONFIG, 'a', updated);
		expect(dump(sql)).toEqual(dump(rebuildFromScratch([updated, DOC_B])));
	});

	it('falls back rather than trusting a stale previous document', () => {
		const { sql, store } = newStore();
		store.indexDocument(CONFIG, 'a', DOC_A);
		store.indexDocument(CONFIG, 'b', DOC_B);
		const updated = { ...DOC_A, title: 'dataset' };
		// A lie: `previous` claims a different field length than what is indexed.
		store.indexDocument(CONFIG, 'a', updated, {
			...DOC_A,
			title: 'completely different token set entirely',
		});
		expect(dump(sql)).toEqual(dump(rebuildFromScratch([updated, DOC_B])));
	});

	it('matches a from-scratch rebuild after deletes', () => {
		const { sql, store } = newStore();
		store.indexDocument(CONFIG, 'a', DOC_A);
		store.indexDocument(CONFIG, 'b', DOC_B);
		store.indexDocument(CONFIG, 'c', DOC_C);
		expect(store.removeDocument(CONFIG, 'b', 10)).toBe(true);
		expect(store.removeDocument(CONFIG, 'missing', 11)).toBe(false);
		const expected = dump(rebuildFromScratch([DOC_A, DOC_C]));
		const actual = dump(sql);
		expect(actual).toEqual(expected);
	});

	it('survives a long deterministic create/update/delete sequence', () => {
		const { sql, store } = newStore();
		const live = new Map<string, Record<string, unknown>>();
		const words = ['data', 'database', 'dataset', 'token', 'alpha', 'beta', 'gamma'];
		for (let step = 0; step < 120; step++) {
			const id = `d${step % 17}`;
			if (step % 7 === 3 && live.has(id)) {
				store.removeDocument(CONFIG, id, step);
				live.delete(id);
				continue;
			}
			const document = {
				id,
				title: words[step % words.length],
				body: `${words[(step * 3) % words.length]} ${words[(step * 5) % words.length]}`,
				tags: [words[(step * 2) % words.length]],
			};
			const previous = live.get(id);
			// Alternate between the diff path and the RETURNING fallback.
			store.indexDocument(CONFIG, id, document, step % 2 === 0 ? previous : undefined);
			live.set(id, document);
		}
		expect(dump(sql)).toEqual(dump(rebuildFromScratch([...live.values()])));
	});

	it('drops field stats when the last document carrying a field goes away', () => {
		const { sql, store } = newStore();
		store.indexDocument(CONFIG, 'a', { id: 'a', title: 'only' });
		store.removeDocument(CONFIG, 'a', 1);
		expect(sql.exec('SELECT * FROM search_field_stats;').toArray()).toEqual([]);
		expect(sql.exec('SELECT * FROM search_tokens;').toArray()).toEqual([]);
		expect(sql.exec('SELECT * FROM search_postings;').toArray()).toEqual([]);
	});

	it('exposes per-document lengths both whole and per field', () => {
		const { store } = newStore();
		store.indexDocument(CONFIG, 'a', DOC_A);
		store.indexDocument(CONFIG, 'b', DOC_B);
		expect(store.getDocLengths('article', ['a', 'b']).get('a')?.get('body')).toBe(3);
		// The field-scoped read extracts in SQL — presence means the doc is indexed.
		const lengths = store.getFieldLengths('article', 'body');
		expect([...lengths.entries()].sort()).toEqual([
			['a', 3],
			['b', 2],
		]);
		expect(store.getFieldLengths('article', 'body', ['a'])).toEqual(new Map([['a', 3]]));
		// A document with no content for the field is still present, at zero.
		store.indexDocument(CONFIG, 'z', { id: 'z', title: 'only a title' });
		expect(store.getFieldLengths('article', 'body').get('z')).toBe(0);
	});

	it('counts a present-but-empty field as a zero-length document', () => {
		const { store } = newStore();
		store.indexDocument(CONFIG, 'c', DOC_C);
		expect(store.getFieldStats('article', 'body')).toEqual({
			doc_count: 1,
			total_len: 0,
		});
	});
});

describe('write path — vectors', () => {
	it('stores unit-normalized vectors and replaces them on re-index', () => {
		const { store } = newStore();
		store.indexDocument(CONFIG, 'a', { id: 'a', embedding: [3, 4, 0] });
		const [[doc_id, vector]] = store.getVectors('article', 'embedding');
		expect(doc_id).toBe('a');
		expect(vector[0]).toBeCloseTo(0.6, 6);
		expect(vector[1]).toBeCloseTo(0.8, 6);
		store.indexDocument(CONFIG, 'a', { id: 'a', embedding: [0, 0, 5] }, { id: 'a' });
		expect([...store.getVectors('article', 'embedding')[0][1]]).toEqual([0, 0, 1]);
	});

	it('rejects a zero vector with a 400', () => {
		const { store } = newStore();
		try {
			store.indexDocument(CONFIG, 'a', { id: 'a', embedding: [0, 0, 0] });
			expect.unreachable('a zero vector must be rejected');
		} catch (error) {
			expect(DelightError.is(error)).toBe(true);
			expect((error as DelightError).status).toBe(400);
		}
	});

	it('removes vectors when the document is deleted', () => {
		const { store } = newStore();
		store.indexDocument(CONFIG, 'a', { id: 'a', embedding: [1, 0, 0] });
		store.removeDocument(CONFIG, 'a', 5);
		expect(store.getVectors('article', 'embedding')).toEqual([]);
	});
});

describe('batching under the DO SQLite caps', () => {
	it('never binds more than 100 parameters, batching postings at the row cap', () => {
		const { sql, store } = newStore();
		const distinct = Array.from({ length: 137 }, (_, index) => `word${index}`);
		sql.log.length = 0;
		store.indexDocument(CONFIG, 'wide', { id: 'wide', body: distinct.join(' ') });
		expect(sql.log.length).toBeGreaterThan(1);
		for (const entry of sql.log) {
			expect(entry.params.length, entry.sql.slice(0, 60)).toBeLessThanOrEqual(100);
		}
		const posting_inserts = sql.log.filter(
			(entry) =>
				entry.sql.startsWith('INSERT INTO search_postings') && entry.params[1] === 'body',
		);
		expect(posting_inserts.length).toBe(Math.ceil(137 / MAX_INSERT_ROWS));
		for (const entry of posting_inserts) {
			expect(entry.params.length % POSTING_COLUMNS).toBe(0);
			expect(entry.params.length / POSTING_COLUMNS).toBeLessThanOrEqual(MAX_INSERT_ROWS);
		}
		// And the write is still exact.
		expect(dump(sql)).toEqual(
			dump(rebuildFromScratch([{ id: 'wide', body: distinct.join(' ') }])),
		);
	});

	it('chunks the delete diff and the df decrements', () => {
		const { sql, store } = newStore();
		const before = Array.from({ length: 200 }, (_, index) => `word${index}`).join(' ');
		const document = { id: 'wide', body: before };
		store.indexDocument(CONFIG, 'wide', document);
		sql.log.length = 0;
		store.indexDocument(CONFIG, 'wide', { id: 'wide', body: 'tiny' }, document);
		for (const entry of sql.log) {
			expect(entry.params.length, entry.sql.slice(0, 60)).toBeLessThanOrEqual(100);
		}
		expect(dump(sql)).toEqual(dump(rebuildFromScratch([{ id: 'wide', body: 'tiny' }])));
	});
});

describe('term dictionary', () => {
	it('loads lazily and is maintained incrementally on write', () => {
		const { store } = newStore();
		store.indexDocument(CONFIG, 'a', { id: 'a', body: 'data database' });
		expect(store.getDictionary('article', 'body')).toEqual(['data', 'database']);
		store.indexDocument(CONFIG, 'b', { id: 'b', body: 'dataset datum' });
		// Maintained in place — no reload happened.
		expect(store.getDictionary('article', 'body')).toEqual([
			'data',
			'database',
			'dataset',
			'datum',
		]);
		store.removeDocument(CONFIG, 'b', 1);
		expect(store.getDictionary('article', 'body')).toEqual(['data', 'database']);
		// A token shared by two documents survives the removal of one.
		store.indexDocument(CONFIG, 'c', { id: 'c', body: 'data' });
		store.removeDocument(CONFIG, 'a', 2);
		expect(store.getDictionary('article', 'body')).toEqual(['data']);
	});

	it('agrees with a freshly loaded dictionary after many writes', () => {
		const { store } = newStore();
		for (let index = 0; index < 40; index++) {
			store.indexDocument(CONFIG, `d${index}`, {
				id: `d${index}`,
				body: `word${index % 13} shared word${(index * 7) % 29}`,
			});
		}
		const incremental = [...(store.getDictionary('article', 'body') as string[])];
		store.clearDictionaryCache();
		expect(store.getDictionary('article', 'body')).toEqual(incremental);
	});

	it('expands prefixes by range walk and tolerance by scan', () => {
		const { store } = newStore();
		store.indexDocument(CONFIG, 'a', {
			id: 'a',
			body: 'data database dataset datum hello hallo',
		});
		expect(store.expandToken('article', 'body', 'dat', false, 0)).toEqual([
			'data',
			'database',
			'dataset',
			'datum',
		]);
		expect(store.expandToken('article', 'body', 'data', true, 0)).toEqual(['data']);
		expect(store.expandToken('article', 'body', 'missing', true, 0)).toEqual([]);
		expect(store.expandToken('article', 'body', 'hello', false, 1)).toEqual([
			'hallo',
			'hello',
		]);
	});

	it('gives the same expansion through the >200k-token SQL fallback', () => {
		const { store } = newStore();
		store.indexDocument(CONFIG, 'a', {
			id: 'a',
			body: 'data database dataset datum hello hallo',
		});
		const cached = {
			prefix: store.expandToken('article', 'body', 'dat', false, 0),
			exact: store.expandToken('article', 'body', 'data', true, 0),
			fuzzy: store.expandToken('article', 'body', 'hello', false, 1),
		};
		// Force the fallback branch: an oversized dictionary reports `null` and the
		// expansion has to come from SQL range queries instead.
		const patched = store as unknown as { getDictionary: () => string[] | null };
		const original = patched.getDictionary;
		patched.getDictionary = () => null;
		try {
			expect(store.expandToken('article', 'body', 'dat', false, 0)).toEqual(
				cached.prefix,
			);
			expect(store.expandToken('article', 'body', 'data', true, 0)).toEqual(cached.exact);
			expect(store.expandToken('article', 'body', 'hello', false, 1)).toEqual(
				cached.fuzzy,
			);
		} finally {
			patched.getDictionary = original;
		}
	});
});

describe('prefixUpperBound', () => {
	/** U+D7FF — the last Hangul letter before the surrogate block. */
	const BEFORE_SURROGATES = '\uD7FF';
	/** U+E000 — the first private-use character after it. */
	const AFTER_SURROGATES = '\uE000';

	it('increments the last code point', () => {
		expect(prefixUpperBound('dat')).toBe('dau');
		expect(prefixUpperBound('a')).toBe('b');
	});

	it('skips the surrogate block: U+D7FF increments to U+E000', () => {
		expect(prefixUpperBound(BEFORE_SURROGATES)).toBe(AFTER_SURROGATES);
		expect(prefixUpperBound(`x${BEFORE_SURROGATES}`)).toBe(`x${AFTER_SURROGATES}`);
	});

	it('handles astral code points as single units', () => {
		expect(prefixUpperBound('\u{1f600}')).toBe('\u{1f601}');
	});

	it('drops an unincrementable trailing code point', () => {
		expect(prefixUpperBound('a\u{10ffff}')).toBe('b');
		expect(prefixUpperBound('\u{10ffff}')).toBeUndefined();
		expect(prefixUpperBound('')).toBeUndefined();
	});

	it('produces a range that actually bounds the prefix in SQLite', () => {
		const { sql } = newStore();
		// Written straight into the dictionary: U+D7FF is unassigned, so the
		// tokenizer would drop it — the point here is the SQL range, not tokenizing.
		const tokens = [
			`a${BEFORE_SURROGATES}`,
			BEFORE_SURROGATES,
			`${BEFORE_SURROGATES}z`,
			AFTER_SURROGATES,
		];
		for (const token of tokens) {
			sql.exec(
				'INSERT INTO search_tokens (entity_type, field, token, df) VALUES (?, ?, ?, 1);',
				'article',
				'body',
				token,
			);
		}
		const upper = prefixUpperBound(BEFORE_SURROGATES) as string;
		const rows = sql
			.exec(
				'SELECT token FROM search_tokens WHERE entity_type = ? AND field = ? AND token >= ? AND token < ? ORDER BY token;',
				'article',
				'body',
				BEFORE_SURROGATES,
				upper,
			)
			.toArray()
			.map((row) => String(row.token));
		expect(rows).toEqual([BEFORE_SURROGATES, `${BEFORE_SURROGATES}z`]);
	});
});

describe('state and tombstones', () => {
	it('allocates strictly increasing timestamps', () => {
		const { store } = newStore();
		expect(store.allocateTimestamp('article', 1000)).toBe(1000);
		expect(store.allocateTimestamp('article', 1000)).toBe(1001);
		expect(store.allocateTimestamp('article', 1000)).toBe(1002);
		expect(store.allocateTimestamp('article', 5000)).toBe(5000);
		expect(store.getState('article')).toEqual({
			config_version: 1,
			first_updated_at: 1000,
			last_updated_at: 5000,
		});
	});

	it('writes a tombstone on delete and clears it on re-index', () => {
		const { store } = newStore();
		store.indexDocument(CONFIG, 'a', DOC_A);
		store.removeDocument(CONFIG, 'a', 42);
		expect(store.countTombstones('article')).toBe(1);
		store.indexDocument(CONFIG, 'a', DOC_A);
		expect(store.countTombstones('article')).toBe(0);
	});

	it('prunes the oldest half past the cap and bumps config_version', () => {
		const { store } = newStore();
		const before = store.bumpConfigVersion('article');
		expect(store.pruneTombstones('article')).toBe(false);
		for (let index = 0; index <= TOMBSTONE_CAP; index++) {
			store.writeTombstone('article', `d${index}`, index);
		}
		expect(store.countTombstones('article')).toBe(TOMBSTONE_CAP + 1);
		expect(store.pruneTombstones('article')).toBe(true);
		const remaining = store.countTombstones('article');
		expect(remaining).toBe(TOMBSTONE_CAP + 1 - Math.floor((TOMBSTONE_CAP + 1) / 2));
		expect(store.getState('article')?.config_version).toBe(before + 1);
		// The survivors are the newest ones.
		expect(store.countTombstones('article')).toBe(remaining);
		expect(store.pruneTombstones('article')).toBe(false);
	});

	it('keeps state per entity type', () => {
		const { store } = newStore();
		store.allocateTimestamp('article', 10);
		store.allocateTimestamp('event', 99);
		expect(store.getState('article')?.last_updated_at).toBe(10);
		expect(store.getState('event')?.last_updated_at).toBe(99);
	});
});

describe('clearEntityType', () => {
	it('wipes one type and leaves the others alone', () => {
		const { sql, store } = newStore();
		const other = defineSearchType({
			entity_type: 'event',
			schema: { ...SCHEMA },
			primary_key: 'id',
		});
		store.indexDocument(CONFIG, 'a', DOC_A);
		store.indexDocument(other, 'a', DOC_A);
		store.clearEntityType('article');
		expect(
			sql.exec('SELECT DISTINCT entity_type FROM search_postings;').toArray(),
		).toEqual([{ entity_type: 'event' }]);
	});
});
