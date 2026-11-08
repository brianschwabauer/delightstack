// @vitest-environment node
/**
 * The three drivers on what the golden battery doesn't cover: long fields
 * (length rounding past 32 words), the word cap, schema field weights, typo,
 * plural and prefix expansion, proximity re-ranking, highlights, and a term
 * with a filter. Memory is the reference; the server (SQLite) and the client
 * (IndexedDB) must return identical ids, scores, counts and highlights.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IdbSearchEngine } from '../client/engine.js';
import {
	defineClientType,
	IdbSearchStore,
	openSearchDatabase,
} from '../client/idb_store.js';
import type { SearchQuery } from '../core/types.js';
import type { WhereSchema } from '../core/where.js';
import { MemorySearchEngine } from '../memory/engine.js';
import { SqliteSearchEngine } from '../server/engine.js';
import { indexPathsFor } from './idb_harness.js';
import { createEntityTable, insertEntityRow, NodeSqlStorage } from './sqlite_harness.js';

const SCHEMA: WhereSchema = {
	id: 'enum',
	title: 'string',
	body: 'string',
	status: 'enum',
};
const FIELD_OPTIONS = { title: { weight: 2 }, body: { max_tokens: 150 } };

// Deterministic prose: a Zipf-ish vocabulary with real words and a few
// near-misses so plurals, prefixes and typos all have something to find.
const VOCAB = [
	'contract',
	'contracts',
	'contractor',
	'property',
	'properties',
	'closing',
	'buyer',
	'seller',
	'inspection',
	'inspector',
	'deadline',
	'earnest',
	'money',
	'title',
	'escrow',
	'appraisal',
	'lender',
	'mortgage',
	'street',
	'main',
	'avenue',
	'residential',
	'commercial',
	'lease',
	'amendment',
	'addendum',
	'signature',
	'initials',
	'disclosure',
	'offer',
	'counter',
	'kontract',
];
let seed = 11;
const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const word = () => VOCAB[Math.floor(Math.pow(next(), 1.6) * VOCAB.length)];
const prose = (count: number) => Array.from({ length: count }, word).join(' ');

const DOCS = Array.from({ length: 120 }, (_, index) => ({
	id: `d${String(index).padStart(3, '0')}`,
	title: index % 7 === 0 ? 'Main Street contract' : prose(3 + (index % 5)),
	// 40–400 words: well past the 32-word exact-length range, some past the cap
	body: prose(40 + ((index * 37) % 360)),
	status: index % 2 === 0 ? 'open' : 'closed',
}));

const QUERIES: SearchQuery[] = [
	{ term: 'contract', limit: 20 },
	{ term: 'contracts', limit: 20 },
	{ term: 'con', limit: 20 },
	{ term: 'inspectoin', limit: 20 },
	{ term: 'main street', limit: 20, highlight: true },
	{
		term: 'earnest money deadline',
		limit: 30,
		highlight: { fields: ['body'], length: 60 },
	},
	{ term: 'closing', where: { status: 'open' }, limit: 50 },
	{ term: 'property', exact: true, limit: 20 },
	{ term: 'contract', tolerance: 0, limit: 200, offset: 5 },
	{
		term: 'main street',
		order: [{ field: 'id', direction: 'DESC' }],
		limit: 10,
		highlight: true,
	},
];

async function drivers() {
	const memory = new MemorySearchEngine({ schema: SCHEMA, field_options: FIELD_OPTIONS });
	memory.insertMany(DOCS);

	const sql = new NodeSqlStorage();
	const server = new SqliteSearchEngine(sql);
	server.bootstrap();
	const table = {
		...createEntityTable(sql, {
			entity_type: 'doc',
			table_name: 'docs',
			schema: SCHEMA,
			primary_key: 'id',
			primary_key_type: 'string',
		}),
		field_options: FIELD_OPTIONS,
	};
	server.register(table);
	for (const document of DOCS) {
		insertEntityRow(sql, table, document);
		server.indexDocument('doc', document.id, document);
	}

	const index_paths = indexPathsFor(SCHEMA);
	const db = await openSearchDatabase({
		name: `parity-${Math.random()}`,
		version: 1,
		index_paths,
		extra_stores: [{ name: 'sync_meta' }],
	});
	const store = new IdbSearchStore(db, { index_paths });
	store.register(
		defineClientType({
			entity_type: 'doc',
			schema: SCHEMA,
			field_options: FIELD_OPTIONS,
		}),
	);
	await store.applyWrites(
		DOCS.map((document) => ({
			entity_type: 'doc',
			doc_id: document.id,
			sparse_doc: document,
		})),
	);
	const client = new IdbSearchEngine(store);
	return { memory, server, client };
}

const shape = (result: {
	count: number;
	hits: { id: string; score: number; highlights?: unknown }[];
}) => ({
	count: result.count,
	hits: result.hits.map((hit) => [hit.id, hit.score, hit.highlights ?? null]),
});

describe('driver parity on long fields, expansions, proximity and highlights', () => {
	it('returns identical answers from memory, SQLite and IndexedDB', async () => {
		const { memory, server, client } = await drivers();
		for (const query of QUERIES) {
			const expected = shape(memory.search(query));
			expect(expected.hits.length, JSON.stringify(query)).toBeGreaterThan(0);
			expect(shape(server.list('doc', query)), `server ${JSON.stringify(query)}`).toEqual(
				expected,
			);
			expect(
				shape(await client.list('doc', query)),
				`client ${JSON.stringify(query)}`,
			).toEqual(expected);
		}
	});

	it('rejects a malformed highlight option on every driver alike', async () => {
		const { memory, server, client } = await drivers();
		for (const highlight of [
			{ fields: 'title' },
			{ fields: ['nope'] },
			{ length: 'x' },
			5,
		]) {
			const query = { term: 'contract', highlight } as unknown as SearchQuery;
			expect(() => memory.search(query)).toThrow(/highlight/);
			expect(() => server.list('doc', query)).toThrow(/highlight/);
			await expect(client.list('doc', query)).rejects.toThrow(/highlight/);
		}
	});
});
