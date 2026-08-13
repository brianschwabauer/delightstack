// @vitest-environment node
/**
 * Unit tests for the client IDB store (plan §7.6).
 *
 * The load-bearing property is the same one `server/sqlite_store.test.ts`
 * pins: **incremental writes and a from-scratch rebuild must produce byte-
 * identical `df`, lengths and field statistics**. Everything else here is one
 * of the IDB-specific hazards the plan's checklist calls out — transaction
 * atomicity across stores, interleaved writers, the dictionary cache, key
 * ranges over astral tokens, and the rule that an index may only ever *narrow*
 * candidates for a positive string/number predicate.
 */

import { describe, expect, it, vi } from 'vitest';
import { DelightError } from '@delightstack/utilities';
import {
	codeUnitUpperBound,
	collectProbes,
	defineClientType,
	docIndexName,
	DOCS_STORE,
	FIELD_STATS_STORE,
	IdbSearchStore,
	openSearchDatabase,
	POSTINGS_STORE,
	request,
	tokenPrefixRange,
	TOKENS_STORE,
	transactionDone,
	type DocRow,
	type DocWrite,
	type FieldStatsRow,
	type PostingRow,
	type TokenRow,
} from './idb_store';
import { normalizeWhere, type WhereSchema } from '../core/where';
import { openTestDriver } from '../__tests__/idb_harness';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const SCHEMA: WhereSchema = {
	id: 'string',
	title: 'string',
	body: 'string',
	tags: 'string[]',
	status: 'enum',
	views: 'number',
	is_published: 'boolean',
	'address.city': 'string',
};

/** A small document set with overlapping vocabulary. */
function makeDoc(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		title: 'search engine',
		body: 'the quick brown fox jumps',
		tags: ['alpha', 'beta'],
		status: 'draft',
		views: 10,
		is_published: true,
		address: { city: 'boston' },
		...overrides,
	};
}

/** Every stored record, as a comparable snapshot. */
async function snapshot(store: IdbSearchStore): Promise<{
	postings: PostingRow[];
	tokens: TokenRow[];
	docs: DocRow[];
	field_stats: FieldStatsRow[];
}> {
	const txn = store.db.transaction(
		[POSTINGS_STORE, TOKENS_STORE, DOCS_STORE, FIELD_STATS_STORE],
		'readonly',
	);
	const [postings, tokens, docs, field_stats] = await Promise.all([
		request<PostingRow[]>(
			txn.objectStore(POSTINGS_STORE).getAll() as IDBRequest<PostingRow[]>,
		),
		request<TokenRow[]>(txn.objectStore(TOKENS_STORE).getAll() as IDBRequest<TokenRow[]>),
		request<DocRow[]>(txn.objectStore(DOCS_STORE).getAll() as IDBRequest<DocRow[]>),
		request<FieldStatsRow[]>(
			txn.objectStore(FIELD_STATS_STORE).getAll() as IDBRequest<FieldStatsRow[]>,
		),
	]);
	const key = (row: unknown): string => JSON.stringify(row);
	return {
		postings: postings.sort((a, b) => (key(a) < key(b) ? -1 : 1)),
		tokens: tokens.sort((a, b) => (key(a) < key(b) ? -1 : 1)),
		docs: docs.sort((a, b) => (key(a) < key(b) ? -1 : 1)),
		field_stats: field_stats.sort((a, b) => (key(a) < key(b) ? -1 : 1)),
	};
}

/** A driver holding exactly `docs`, written one batch per call. */
async function loaded(docs: Record<string, unknown>[], batches = 1) {
	const driver = await openTestDriver('article', SCHEMA);
	const writes: DocWrite[] = docs.map((doc) => ({
		entity_type: 'article',
		doc_id: String(doc.id),
		sparse_doc: doc,
	}));
	const size = Math.ceil(writes.length / batches) || 1;
	for (let index = 0; index < writes.length; index += size) {
		await driver.store.applyWrites(writes.slice(index, index + size));
	}
	return driver;
}

/* -------------------------------------------------------------------------- */
/* Write path                                                                 */
/* -------------------------------------------------------------------------- */

describe('write-path diffing', () => {
	it('leaves an update indistinguishable from a rebuild', async () => {
		const initial = [makeDoc('a'), makeDoc('b', { title: 'other words' }), makeDoc('c')];
		const updated = makeDoc('b', {
			title: 'search engine rewritten entirely',
			tags: ['gamma'],
			body: 'shorter',
		});

		const incremental = await loaded(initial);
		await incremental.store.applyWrites([
			{ entity_type: 'article', doc_id: 'b', sparse_doc: updated },
		]);

		const rebuilt = await loaded([initial[0], updated, initial[2]]);
		expect(await snapshot(incremental.store)).toEqual(await snapshot(rebuilt.store));
	});

	it('leaves a delete indistinguishable from never having written it', async () => {
		const incremental = await loaded([makeDoc('a'), makeDoc('b'), makeDoc('c')]);
		await incremental.store.applyWrites([
			{ entity_type: 'article', doc_id: 'b', sparse_doc: null },
		]);
		const rebuilt = await loaded([makeDoc('a'), makeDoc('c')]);
		expect(await snapshot(incremental.store)).toEqual(await snapshot(rebuilt.store));
	});

	it('empties every store when the last document goes', async () => {
		const driver = await loaded([makeDoc('a')]);
		await driver.store.applyWrites([
			{ entity_type: 'article', doc_id: 'a', sparse_doc: null },
		]);
		const state = await snapshot(driver.store);
		expect(state).toEqual({ postings: [], tokens: [], docs: [], field_stats: [] });
	});

	it('folds repeated writes to one document inside a single batch', async () => {
		const batched = await openTestDriver('article', SCHEMA);
		await batched.store.applyWrites([
			{ entity_type: 'article', doc_id: 'a', sparse_doc: makeDoc('a') },
			{
				entity_type: 'article',
				doc_id: 'a',
				sparse_doc: makeDoc('a', { title: 'final title' }),
			},
		]);
		const rebuilt = await loaded([makeDoc('a', { title: 'final title' })]);
		expect(await snapshot(batched.store)).toEqual(await snapshot(rebuilt.store));
	});

	it('batches and single writes agree exactly', async () => {
		const docs = Array.from({ length: 12 }, (_, index) =>
			makeDoc(`doc-${index}`, {
				title: `title ${index % 3}`,
				views: index,
				tags: index % 2 === 0 ? ['alpha'] : ['beta', 'gamma'],
			}),
		);
		const one_batch = await loaded(docs, 1);
		const many_batches = await loaded(docs, 6);
		expect(await snapshot(one_batch.store)).toEqual(await snapshot(many_batches.store));
	});

	it('keeps `df`, lengths and statistics exact through a churn sequence', async () => {
		const driver = await openTestDriver('article', SCHEMA);
		const live = new Map<string, Record<string, unknown>>();
		for (let step = 0; step < 24; step++) {
			const id = `doc-${step % 7}`;
			const remove = step % 5 === 4 && live.has(id);
			const doc = remove
				? null
				: makeDoc(id, {
						title: `title ${step % 4} words`,
						body: 'the quick brown fox '.repeat((step % 3) + 1),
						tags: step % 2 === 0 ? ['alpha', 'beta'] : [],
					});
			await driver.store.applyWrites([
				{ entity_type: 'article', doc_id: id, sparse_doc: doc },
			]);
			if (doc) live.set(id, doc);
			else live.delete(id);
		}
		const rebuilt = await loaded([...live.values()]);
		expect(await snapshot(driver.store)).toEqual(await snapshot(rebuilt.store));
	});

	it('recovers from a postings/document mismatch via the by-doc index', async () => {
		// Simulate the state a schema change (or a partial write from an older
		// build) would leave behind: the stored document's recorded lengths no
		// longer match what it tokenizes to, so its token set cannot be trusted.
		// The store must then diff against the postings actually on disk instead
		// of decrementing `df` for tokens that were never there — the same
		// verification the server store does before trusting a previous document.
		const driver = await loaded([makeDoc('a'), makeDoc('b')]);
		const stored = (await driver.store.getDocs('article', ['a'])).get('a') as DocRow;
		const txn = driver.db.transaction(
			[POSTINGS_STORE, TOKENS_STORE, DOCS_STORE],
			'readwrite',
		);
		txn
			.objectStore(DOCS_STORE)
			.put({ ...stored, lengths: { ...stored.lengths, title: 99 } });
		txn.objectStore(POSTINGS_STORE).put({
			entity_type: 'article',
			field: 'title',
			token: 'ghost',
			doc_id: 'a',
			tf: 1,
			len: 3,
		});
		txn.objectStore(TOKENS_STORE).put({
			entity_type: 'article',
			field: 'title',
			token: 'ghost',
			df: 1,
		});
		await transactionDone(txn);

		await driver.store.applyWrites([
			{
				entity_type: 'article',
				doc_id: 'a',
				sparse_doc: makeDoc('a', { title: 'fresh' }),
			},
		]);
		const state = await snapshot(driver.store);
		expect(state.tokens.find((row) => row.token === 'ghost')).toBeUndefined();
		expect(
			state.postings.filter((row) => row.doc_id === 'a' && row.token === 'ghost'),
		).toEqual([]);
	});
});

/* -------------------------------------------------------------------------- */
/* Atomicity                                                                  */
/* -------------------------------------------------------------------------- */

describe('the sync_meta atomicity seam', () => {
	it('commits an extra-store op in the same transaction as the index', async () => {
		const driver = await openTestDriver('article', SCHEMA);
		await driver.store.applyWrites(
			[{ entity_type: 'article', doc_id: 'a', sparse_doc: makeDoc('a') }],
			{
				extra_ops: [
					{
						store: 'sync_meta',
						action: 'put',
						key: 'article',
						value: { entity_type: 'article', end_updated_at: 42 },
					},
				],
			},
		);
		const txn = driver.db.transaction('sync_meta', 'readonly');
		const meta = await request<{ end_updated_at: number } | undefined>(
			txn.objectStore('sync_meta').get('article') as IDBRequest<
				{ end_updated_at: number } | undefined
			>,
		);
		expect(meta?.end_updated_at).toBe(42);
		expect((await snapshot(driver.store)).docs).toHaveLength(1);
	});

	it('rolls the index back when the extra-store op fails', async () => {
		const driver = await loaded([makeDoc('a')]);
		const before = await snapshot(driver.store);
		await expect(
			driver.store.applyWrites(
				[{ entity_type: 'article', doc_id: 'b', sparse_doc: makeDoc('b') }],
				{
					// A store that does not exist aborts the whole transaction, which is
					// the property that matters: the synced window can never outrun the
					// persisted index.
					extra_ops: [{ store: 'not_a_store', action: 'put', key: 'x', value: 1 }],
				},
			),
		).rejects.toThrow(DelightError);
		expect(await snapshot(driver.store)).toEqual(before);
	});

	it('rolls back when an op inside the transaction fails', async () => {
		const driver = await loaded([makeDoc('a')]);
		const before = await snapshot(driver.store);
		await expect(
			driver.store.applyWrites(
				[{ entity_type: 'article', doc_id: 'b', sparse_doc: makeDoc('b') }],
				// `sync_meta` is an out-of-line store, so a put with no key throws
				// mid-transaction — after the index writes have been issued.
				{ extra_ops: [{ store: 'sync_meta', action: 'put', value: { a: 1 } }] },
			),
		).rejects.toThrow(DelightError);
		expect(await snapshot(driver.store)).toEqual(before);
	});

	it('keeps two overlapping writers consistent', async () => {
		// IDB serializes overlapping readwrite transactions, which is exactly what
		// the read-the-old-document-inside-the-transaction rule leans on. Two
		// concurrent `applyWrites` on the SAME document must therefore leave the
		// store in the state of whichever ran second — never a mixture.
		const driver = await loaded([makeDoc('a')]);
		const first = makeDoc('a', { title: 'first writer wins nothing' });
		const second = makeDoc('a', { title: 'second writer' });
		await Promise.all([
			driver.store.applyWrites([
				{ entity_type: 'article', doc_id: 'a', sparse_doc: first },
			]),
			driver.store.applyWrites([
				{ entity_type: 'article', doc_id: 'a', sparse_doc: second },
			]),
		]);
		const state = await snapshot(driver.store);
		const rebuilt_first = await loaded([first]);
		const rebuilt_second = await loaded([second]);
		const options = [
			await snapshot(rebuilt_first.store),
			await snapshot(rebuilt_second.store),
		];
		expect(options).toContainEqual(state);
	});
});

/* -------------------------------------------------------------------------- */
/* Dictionary cache                                                           */
/* -------------------------------------------------------------------------- */

describe('the term dictionary cache', () => {
	it('is maintained incrementally across writes', async () => {
		const driver = await loaded([makeDoc('a', { title: 'alpha beta' })]);
		const first = await driver.store.getTokenDictionary('article', 'title');
		expect(first?.tokens).toEqual(['alpha', 'beta']);

		await driver.store.applyWrites([
			{
				entity_type: 'article',
				doc_id: 'b',
				sparse_doc: makeDoc('b', { title: 'gamma' }),
			},
		]);
		const second = await driver.store.getTokenDictionary('article', 'title');
		expect(second?.tokens).toEqual(['alpha', 'beta', 'gamma']);
		// The same object, mutated in place — no reload happened.
		expect(second).toBe(first);
		expect(second?.lengths).toEqual([5, 4, 5]);

		await driver.store.applyWrites([
			{ entity_type: 'article', doc_id: 'b', sparse_doc: null },
		]);
		expect((await driver.store.getTokenDictionary('article', 'title'))?.tokens).toEqual([
			'alpha',
			'beta',
		]);
	});

	it('matches a freshly loaded dictionary after churn', async () => {
		const driver = await loaded([makeDoc('a'), makeDoc('b', { title: 'other words' })]);
		await driver.store.getTokenDictionary('article', 'title');
		await driver.store.applyWrites([
			{
				entity_type: 'article',
				doc_id: 'a',
				sparse_doc: makeDoc('a', { title: 'zeta' }),
			},
			{ entity_type: 'article', doc_id: 'b', sparse_doc: null },
			{
				entity_type: 'article',
				doc_id: 'c',
				sparse_doc: makeDoc('c', { title: 'delta' }),
			},
		]);
		const maintained = await driver.store.getTokenDictionary('article', 'title');
		driver.store.clearDictionaryCache();
		const reloaded = await driver.store.getTokenDictionary('article', 'title');
		expect(maintained?.tokens).toEqual(reloaded?.tokens);
		expect(maintained?.signatures).toEqual(reloaded?.signatures);
	});

	it('memoizes the oversized-dictionary tolerance range read within one query', async () => {
		const cached = await loaded([makeDoc('a', { title: 'alpha beta gamma' })]);
		const uncached = new IdbSearchStore(cached.db, { max_cached_tokens: 0 });
		uncached.register(defineClientType({ entity_type: 'article', schema: SCHEMA }));
		const memo = new Map<string, string[]>();
		const transactions = vi.spyOn(cached.db, 'transaction');
		const first = await uncached.expandToken('article', 'title', 'alpba', false, 1, memo);
		const reads_after_first = transactions.mock.calls.length;
		expect(reads_after_first).toBeGreaterThan(0);
		// Every further tolerance token of the same query costs zero IDB reads.
		const second = await uncached.expandToken('article', 'title', 'gamm', false, 1, memo);
		expect(transactions.mock.calls.length).toBe(reads_after_first);
		transactions.mockRestore();
		expect(first).toEqual(['alpha']);
		expect(second).toEqual(['gamma']);
		// Without the memo the same call agrees exactly — the memo is a pure cache.
		expect(await uncached.expandToken('article', 'title', 'gamm', false, 1)).toEqual([
			'gamma',
		]);
	});

	it('is skipped past the cap, and the range fallback agrees with it', async () => {
		const cached = await loaded([
			makeDoc('a', { title: 'alpha alphabet beta' }),
			makeDoc('b', { title: 'alpine gamma' }),
		]);
		const dictionary = await cached.store.getTokenDictionary('article', 'title');
		expect(dictionary).not.toBeNull();

		const uncached = new IdbSearchStore(cached.db, { max_cached_tokens: 0 });
		uncached.register(defineClientType({ entity_type: 'article', schema: SCHEMA }));
		expect(await uncached.getTokenDictionary('article', 'title')).toBeNull();
		expect(await uncached.expandToken('article', 'title', 'alp', false, 0)).toEqual([
			'alpha',
			'alphabet',
			'alpine',
		]);
		expect(await uncached.expandToken('article', 'title', 'alpha', true, 0)).toEqual([
			'alpha',
		]);
		expect(await uncached.expandToken('article', 'title', 'zzz', true, 0)).toEqual([]);
		expect(await uncached.expandToken('article', 'title', 'alpba', false, 1)).toEqual([
			'alpha',
		]);
	});
});

/* -------------------------------------------------------------------------- */
/* Key ranges                                                                 */
/* -------------------------------------------------------------------------- */

describe('prefix key ranges', () => {
	it('bounds a prefix in code-unit space', () => {
		expect(codeUnitUpperBound('abc')).toBe('abd');
		expect(codeUnitUpperBound('ab\uFFFF')).toBe('ac');
		expect(codeUnitUpperBound('')).toBeUndefined();
		expect(codeUnitUpperBound('\uFFFF\uFFFF')).toBeUndefined();
		// An astral character is a surrogate pair, so the successor moves the trail
		// surrogate — the bound stays above every string that starts with it.
		expect(codeUnitUpperBound('a\u{1f600}')).toBe('a\u{1F601}');
	});

	it('covers astral tokens the plan sketch would have missed', async () => {
		const driver = await openTestDriver('article', SCHEMA);
		// Written straight into the store: the tokenizer folds astral characters
		// away, so this is the only way to exercise the range rule against them.
		const astral = [
			'zz',
			'z\u{10FFFF}',
			'z\u{10FFFF}tail',
			'z\u{1f600}',
			'z\uFFFF',
			'z\uFFFFmore',
			'{',
		];
		const txn = driver.db.transaction(TOKENS_STORE, 'readwrite');
		for (const token of astral) {
			txn.objectStore(TOKENS_STORE).put({
				entity_type: 'article',
				field: 'title',
				token,
				df: 1,
			});
		}
		await transactionDone(txn);

		const read = driver.db.transaction(TOKENS_STORE, 'readonly');
		const keys = await request<IDBValidKey[]>(
			read
				.objectStore(TOKENS_STORE)
				.getAllKeys(tokenPrefixRange('article', 'title', 'z')),
		);
		const tokens = keys.map((key) => String((key as IDBValidKey[])[2])).sort();
		expect(tokens).toEqual(
			[
				'z\u{10FFFF}',
				'z\u{10FFFF}tail',
				'z\u{1f600}',
				'z\uFFFF',
				'z\uFFFFmore',
				'zz',
			].sort(),
		);
		// The naive `prefix + '\uFFFF'` upper bound drops every astral token, and
		// even `prefix + '\u{10FFFF}'` drops the ones with anything after it.
		const naive = await request<IDBValidKey[]>(
			read
				.objectStore(TOKENS_STORE)
				.getAllKeys(
					IDBKeyRange.bound(
						['article', 'title', 'z'],
						['article', 'title', 'z\u{10FFFF}'],
					),
				),
		);
		expect(naive.length).toBeLessThan(keys.length);
	});
});

/* -------------------------------------------------------------------------- */
/* Candidate probes                                                           */
/* -------------------------------------------------------------------------- */

describe('index-driven candidate extraction', () => {
	const indexed = new Map([
		['status', { path: 'status' }],
		['tags', { path: 'tags', multi_entry: true }],
		['views', { path: 'views' }],
		['is_published', { path: 'is_published' }],
		['address.city', { path: 'address.city' }],
	]);

	function probesFor(where: Record<string, unknown>): ReturnType<typeof collectProbes> {
		return collectProbes(normalizeWhere(where, SCHEMA), indexed);
	}

	it('probes positive string/number predicates', () => {
		expect(probesFor({ status: 'draft' })).toEqual([
			{
				path: 'status',
				multi_entry: false,
				bounds: [{ lower: 'draft', upper: 'draft' }],
			},
		]);
		expect(probesFor({ views: { gte: 5 } })[0].bounds).toEqual([{ lower: 5 }]);
		expect(probesFor({ tags: { contains_all: ['alpha', 'beta'] } })[0]).toMatchObject({
			multi_entry: true,
			bounds: [{ lower: 'alpha', upper: 'alpha' }],
		});
		expect(probesFor({ and: [{ status: 'draft' }] })).toHaveLength(1);
	});

	it('never probes booleans, negations or `or` branches', () => {
		expect(probesFor({ is_published: true })).toEqual([]);
		expect(probesFor({ status: { not_in: ['draft'] } })).toEqual([]);
		expect(probesFor({ not: { status: 'draft' } })).toEqual([]);
		expect(probesFor({ or: [{ status: 'draft' }, { status: 'live' }] })).toEqual([]);
		// An ordered comparison against a non-numeric field: IDB's cross-type key
		// order is not `core/compare`'s, so no probe.
		expect(probesFor({ status: { gt: 'a' } })).toEqual([]);
		expect(probesFor({ views: { between: [9, 1] } })).toEqual([]);
	});

	it('returns a superset the filter can be applied to', async () => {
		const driver = await loaded([
			makeDoc('a', { status: 'draft', tags: ['alpha'] }),
			makeDoc('b', { status: 'live', tags: ['alpha', 'beta'] }),
			makeDoc('c', { status: 'draft', tags: [] }),
			makeDoc('d', { status: 'draft' }),
		]);
		const probe = collectProbes(
			normalizeWhere({ tags: { contains_any: ['alpha'] } }, SCHEMA),
			driver.store.indexed_paths,
		)[0];
		// `d` keeps the default tags, so it is in the candidate set too — a probe
		// is a superset, and `core/where` is what narrows it.
		expect(await driver.store.getProbeDocIds('article', probe)).toEqual(['a', 'b', 'd']);
		expect(await driver.store.countProbe('article', probe)).toBe(3);
	});

	it('leaks no other entity type through a multiEntry index', async () => {
		const driver = await loaded([makeDoc('a', { tags: ['alpha'] })]);
		driver.store.register(defineClientType({ entity_type: 'event', schema: SCHEMA }));
		await driver.store.applyWrites([
			{
				entity_type: 'event',
				doc_id: 'a',
				sparse_doc: makeDoc('a', { tags: ['alpha'] }),
			},
		]);
		const probe = collectProbes(
			normalizeWhere({ tags: 'alpha' }, SCHEMA),
			driver.store.indexed_paths,
		)[0];
		expect(await driver.store.getProbeDocIds('article', probe)).toEqual(['a']);
		expect(await driver.store.getProbeDocIds('event', probe)).toEqual(['a']);
		expect((await driver.store.getDocs('event', ['a'])).get('a')?.entity_type).toBe(
			'event',
		);
	});

	it('omits documents missing the indexed path', async () => {
		const driver = await loaded([
			makeDoc('a', { address: { city: 'boston' } }),
			makeDoc('b', { address: undefined }),
		]);
		const txn = driver.db.transaction(DOCS_STORE, 'readonly');
		const index = txn.objectStore(DOCS_STORE).index(docIndexName('address.city'));
		expect(await request<number>(index.count())).toBe(1);
	});
});

/* -------------------------------------------------------------------------- */
/* Upgrades                                                                   */
/* -------------------------------------------------------------------------- */

describe('database upgrades', () => {
	it('reconciles the declared index set on a version bump', async () => {
		const name = 'search-upgrade-fixture';
		const first = await openSearchDatabase({
			name,
			version: 1,
			index_paths: [{ path: 'status' }, { path: 'views' }],
		});
		expect([
			...first.transaction(DOCS_STORE, 'readonly').objectStore(DOCS_STORE).indexNames,
		]).toEqual([docIndexName('status'), docIndexName('views')]);
		first.close();

		const second = await openSearchDatabase({
			name,
			version: 2,
			index_paths: [{ path: 'status' }, { path: 'tags', multi_entry: true }],
		});
		const names = [
			...second.transaction(DOCS_STORE, 'readonly').objectStore(DOCS_STORE).indexNames,
		];
		expect(names).toEqual([docIndexName('status'), docIndexName('tags')]);
		second.close();
	});

	it('rebuilds a same-named index whose physical shape drifted', async () => {
		// A path declared scalar in one build and array in the next keeps its
		// index NAME — the shape (keyPath arity + multiEntry) is what changes. A
		// name-only reconciler would keep the stale scalar index, and every
		// contains_any probe against it would return zero rows: silent exclusion.
		const name = 'search-upgrade-shape-fixture';
		const scalar = await openSearchDatabase({
			name,
			version: 1,
			index_paths: [{ path: 'tags' }],
		});
		const scalar_store = new IdbSearchStore(scalar, { index_paths: [{ path: 'tags' }] });
		scalar_store.register(defineClientType({ entity_type: 'article', schema: SCHEMA }));
		await scalar_store.applyWrites([
			{
				entity_type: 'article',
				doc_id: 'a',
				sparse_doc: makeDoc('a', { tags: ['alpha'] }),
			},
		]);
		expect(
			scalar
				.transaction(DOCS_STORE, 'readonly')
				.objectStore(DOCS_STORE)
				.index(docIndexName('tags')).multiEntry,
		).toBe(false);
		scalar.close();

		const declaration = { path: 'tags', multi_entry: true };
		const reopened = await openSearchDatabase({
			name,
			version: 2,
			index_paths: [declaration],
		});
		const index = reopened
			.transaction(DOCS_STORE, 'readonly')
			.objectStore(DOCS_STORE)
			.index(docIndexName('tags'));
		expect(index.multiEntry).toBe(true);
		expect(index.keyPath).toBe('sparse_doc.tags');

		// The rebuilt index answers a contains_any probe for the pre-existing doc
		// (createIndex re-populates from the stored records).
		const rebuilt_store = new IdbSearchStore(reopened, { index_paths: [declaration] });
		rebuilt_store.register(defineClientType({ entity_type: 'article', schema: SCHEMA }));
		const probe = collectProbes(
			normalizeWhere({ tags: { contains_any: ['alpha'] } }, SCHEMA),
			rebuilt_store.indexed_paths,
		)[0];
		expect(probe.multi_entry).toBe(true);
		expect(await rebuilt_store.getProbeDocIds('article', probe)).toEqual(['a']);
		reopened.close();
	});

	it('waits out a transient blocked upgrade instead of failing immediately', async () => {
		const name = 'search-blocked-transient-fixture';
		const held = await openSearchDatabase({ name, version: 1 });
		// The usual production pattern: the other connection closes shortly after
		// its versionchange event, and the upgrade then proceeds.
		held.onversionchange = () => setTimeout(() => held.close(), 20);
		const upgraded = await openSearchDatabase({
			name,
			version: 2,
			blocked_timeout_ms: 2000,
		});
		expect(upgraded.version).toBe(2);
		upgraded.close();
	});

	it('rejects a permanently blocked upgrade with a 503 after the timeout', async () => {
		const name = 'search-blocked-permanent-fixture';
		const held = await openSearchDatabase({ name, version: 1 });
		held.onversionchange = () => {
			// A connection that never closes — the permanently blocked case.
		};
		await expect(
			openSearchDatabase({ name, version: 2, blocked_timeout_ms: 50 }),
		).rejects.toMatchObject({ status: 503, code: 'search_db_blocked' });
		held.close();
	});
});
