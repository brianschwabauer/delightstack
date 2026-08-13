// @vitest-environment node
/**
 * Client driver tests beyond the golden replay (plan §7.6).
 *
 * Three things live here that the frozen fixtures cannot express:
 *
 * 1. **A direct differential against the memory reference.** The goldens pin
 *    the answers; this pins that the *same corpus* run through both engines
 *    agrees query for query, which is the cheapest way to catch a divergence
 *    introduced between regenerations.
 * 2. **The index/scan equivalence.** Candidate extraction is an optimization,
 *    so the driver with `docs` indexes and the driver without must agree on
 *    every filter — including the ones the plan forbids indexing (booleans,
 *    `not`, `not_in`).
 * 3. **The routing contract.** A query carrying a vector must be refused here
 *    and identified by `requiresServer` before it is ever sent.
 */

import { describe, expect, it, vi } from 'vitest';
import { DelightError } from '@delightstack/utilities';
import { DOCS_STORE, transactionDone, type DocWrite } from './idb_store';
import { generateCorpus } from '../__tests__/fixtures/corpus';
import { batteryCasesForCorpus, type BatteryCase } from '../__tests__/fixtures/battery';
import { buildMemoryEngine, toEngineQuery } from '../__tests__/support';
import { buildIdbDriver, openTestDriver } from '../__tests__/idb_harness';
import { requiresServer } from './engine';
import type { SearchQuery } from '../core/types';
import type { WhereSchema } from '../core/where';

/** Battery cases a corpus supports that the client can answer (no vectors, §4.9). */
function clientCases(preset: 'article' | 'event'): BatteryCase[] {
	return batteryCasesForCorpus(preset).filter(
		(entry) => !entry.tags.includes('server-only'),
	);
}

describe('client vs memory reference', () => {
	it('agrees on the whole battery, both corpora', { timeout: 300_000 }, async () => {
		const failures: string[] = [];
		for (const preset of ['article', 'event'] as const) {
			const corpus = generateCorpus({ preset, size: 'tiny', seed: `${preset}-tiny` });
			const memory = buildMemoryEngine(corpus);
			const driver = await buildIdbDriver(corpus);
			for (const entry of clientCases(preset)) {
				const query = toEngineQuery(entry.query);
				let expected;
				let expected_error: string | undefined;
				try {
					expected = memory.search(query);
				} catch (error) {
					expected_error = (error as Error).message;
				}
				let actual;
				let actual_error: string | undefined;
				try {
					actual = await driver.engine.list(driver.entity_type, query);
				} catch (error) {
					actual_error = (error as Error).message;
				}
				const label = `${preset}/${entry.name}`;
				if (expected_error || actual_error) {
					if (expected_error !== actual_error) {
						failures.push(`${label}: "${actual_error}" != "${expected_error}"`);
					}
					continue;
				}
				const left = JSON.stringify({
					ids: actual?.hits.map((hit) => hit.id),
					count: actual?.count,
					facets: actual?.facets,
				});
				const right = JSON.stringify({
					ids: expected?.hits.map((hit) => hit.id),
					count: expected?.count,
					facets: expected?.facets,
				});
				if (left !== right)
					failures.push(`${label}: ${left.slice(0, 200)} != ${right.slice(0, 200)}`);
			}
		}
		expect(failures).toEqual([]);
	});

	it(
		'agrees on a 1000-document corpus for the scored cases',
		{ timeout: 300_000 },
		async () => {
			const corpus = generateCorpus({
				preset: 'article',
				size: 'small',
				seed: 'article-small',
			});
			const memory = buildMemoryEngine(corpus);
			const driver = await buildIdbDriver(corpus);
			const failures: string[] = [];
			for (const entry of clientCases('article').filter(
				(candidate) =>
					candidate.tags.includes('scored') || candidate.tags.includes('facets'),
			)) {
				const query = toEngineQuery(entry.query);
				if (entry.tags.includes('error')) {
					// Rejections are compared by message in the tiny-corpus differential
					// above; here they would just be the same throw twice.
					continue;
				}
				const expected = memory.search(query);
				const actual = await driver.engine.list(driver.entity_type, query);
				if (
					JSON.stringify(actual.hits.map((hit) => hit.id)) !==
					JSON.stringify(expected.hits.map((hit) => hit.id))
				) {
					failures.push(`${entry.name}: ids differ`);
				}
				if (actual.count !== expected.count)
					failures.push(`${entry.name}: count differs`);
				if (JSON.stringify(actual.facets) !== JSON.stringify(expected.facets)) {
					failures.push(`${entry.name}: facets differ`);
				}
			}
			expect(failures).toEqual([]);
		},
	);
});

describe('index-driven candidates vs a full scan', () => {
	it('agree on every filter case', { timeout: 300_000 }, async () => {
		const corpus = generateCorpus({
			preset: 'article',
			size: 'tiny',
			seed: 'article-tiny',
		});
		const indexed = await buildIdbDriver(corpus);
		const scanned = await buildIdbDriver(corpus, { without_indexes: true });
		const failures: string[] = [];
		for (const entry of clientCases('article').filter(
			(candidate) => candidate.query.where,
		)) {
			const query = toEngineQuery(entry.query);
			const [left, right] = await Promise.all([
				indexed.engine
					.list(indexed.entity_type, query)
					.catch((error: Error) => error.message),
				scanned.engine
					.list(scanned.entity_type, query)
					.catch((error: Error) => error.message),
			]);
			if (JSON.stringify(left) !== JSON.stringify(right)) failures.push(entry.name);
		}
		expect(failures).toEqual([]);
	});

	it('never lets a boolean predicate reach an index', async () => {
		// Booleans are not valid IDB keys, so a boolean index holds nothing and an
		// index-driven answer would be empty. The engine must scan instead.
		const corpus = generateCorpus({
			preset: 'article',
			size: 'tiny',
			seed: 'article-tiny',
		});
		const driver = await buildIdbDriver(corpus);
		const result = await driver.engine.list('article', {
			where: { is_published: true } as SearchQuery['where'],
		});
		const memory = buildMemoryEngine(corpus);
		expect(result.hits.map((hit) => hit.id)).toEqual(
			memory
				.search({ where: { is_published: true } as SearchQuery['where'] })
				.hits.map((hit) => hit.id),
		);
		expect(result.count).toBeGreaterThan(0);
	});
});

describe('the index-cursor browse fast path', () => {
	const BROWSE_SCHEMA: WhereSchema = {
		id: 'string',
		title: 'string',
		updated_at: 'number',
	};

	/** 1000 documents with heavy `updated_at` ties (97 distinct values). */
	function browseDocs(): Record<string, unknown>[] {
		return Array.from({ length: 1000 }, (_, index) => ({
			id: `doc-${String(index).padStart(4, '0')}`,
			title: `note ${index}`,
			updated_at: 1_000 + ((index * 37) % 97),
		}));
	}

	async function loadedDriver(
		docs: Record<string, unknown>[],
		options: { without_indexes?: boolean } = {},
	) {
		const driver = await openTestDriver('article', BROWSE_SCHEMA, options);
		const writes: DocWrite[] = docs.map((doc) => ({
			entity_type: 'article',
			doc_id: String(doc.id),
			sparse_doc: doc,
		}));
		for (let index = 0; index < writes.length; index += 200) {
			await driver.store.applyWrites(writes.slice(index, index + 200));
		}
		return driver;
	}

	it(
		'answers the default browse query without materializing the corpus, identically',
		{ timeout: 120_000 },
		async () => {
			const docs = browseDocs();
			const indexed = await loadedDriver(docs);
			const scanned = await loadedDriver(docs, { without_indexes: true });
			const query: SearchQuery = {
				term: '',
				limit: 100,
				order: [{ field: 'updated_at', direction: 'DESC' }],
			};

			const scans = vi.spyOn(indexed.store, 'getAllDocs');
			const fast = await indexed.engine.list('article', query);
			expect(scans).not.toHaveBeenCalled();

			// The scan driver has no `docs` indexes, so it takes the previous
			// getAllDocs → sort path: the reference the cursor path must equal
			// byte for byte, tie-breaks (primary key ascending) included.
			const slow = await scanned.engine.list('article', query);
			expect(fast.count).toBe(slow.count);
			expect(fast.hits).toEqual(slow.hits);

			// Paging and both directions agree too.
			for (const variant of [
				{ ...query, offset: 37, limit: 10 },
				{ ...query, order: [{ field: 'updated_at', direction: 'ASC' as const }] },
				{ ...query, limit: 0 },
				{ ...query, offset: 990, limit: 100 },
			]) {
				const left = await indexed.engine.list('article', variant);
				const right = await scanned.engine.list('article', variant);
				expect(left.count, JSON.stringify(variant)).toBe(right.count);
				expect(left.hits, JSON.stringify(variant)).toEqual(right.hits);
			}
			expect(scans).not.toHaveBeenCalled();
			scans.mockRestore();
		},
	);

	it('falls back to the scan when a document lacks the order field', async () => {
		const docs = [
			{ id: 'a', title: 'one', updated_at: 3 },
			{ id: 'b', title: 'two' }, // invisible to the by$updated_at index
			{ id: 'c', title: 'three', updated_at: 1 },
		];
		const indexed = await loadedDriver(docs);
		const scanned = await loadedDriver(docs, { without_indexes: true });
		const query: SearchQuery = {
			term: '',
			limit: 10,
			order: [{ field: 'updated_at', direction: 'DESC' }],
		};
		const scans = vi.spyOn(indexed.store, 'getAllDocs');
		const fast = await indexed.engine.list('article', query);
		// Coverage check failed (2 index entries vs 3 documents) → the honest scan.
		expect(scans).toHaveBeenCalled();
		scans.mockRestore();
		const slow = await scanned.engine.list('article', query);
		expect(fast.hits).toEqual(slow.hits);
		expect(fast.hits.map((hit) => hit.id)).toEqual(['a', 'c', 'b']); // missing sorts last
		expect(fast.count).toBe(3);
	});
});

describe('score paging over a missing document', () => {
	it('pulls the next scored entry forward instead of shorting the page', async () => {
		const schema: WhereSchema = { id: 'string', title: 'string' };
		const driver = await openTestDriver('article', schema);
		await driver.store.applyWrites([
			{
				entity_type: 'article',
				doc_id: 'a',
				sparse_doc: { id: 'a', title: 'alpha' },
			},
			{
				entity_type: 'article',
				doc_id: 'b',
				sparse_doc: { id: 'b', title: 'alpha alpha other words here' },
			},
			{
				entity_type: 'article',
				doc_id: 'c',
				sparse_doc: { id: 'c', title: 'alpha words' },
			},
		]);
		// Which id scores highest is BM25's business — learn the order first.
		const full = await driver.engine.list('article', { term: 'alpha', limit: 3 });
		expect(full.hits).toHaveLength(3);
		const top = full.hits[0].id;

		// Corrupt the store the way the pull-forward path guards against: the
		// top-scored document row is gone but its postings remain.
		const txn = driver.db.transaction(DOCS_STORE, 'readwrite');
		txn.objectStore(DOCS_STORE).delete(['article', top]);
		await transactionDone(txn);

		// The deferrable page (no order/facets/distinct) must pull the third
		// entry forward: two real hits, and a count that excludes the ghost.
		const paged = await driver.engine.list('article', { term: 'alpha', limit: 2 });
		expect(paged.hits.map((hit) => hit.id)).toEqual(
			full.hits.slice(1).map((hit) => hit.id),
		);
		expect(paged.count).toBe(2);
	});
});

describe('routing', () => {
	const SCHEMA: WhereSchema = { id: 'string', title: 'string', embedding: 'vector[4]' };

	it('sends every vector query to the server', async () => {
		const driver = await openTestDriver('article', SCHEMA);
		const query: SearchQuery = { vector: { value: [1, 0, 0, 0], field: 'embedding' } };
		expect(requiresServer(query)).toBe(true);
		expect(requiresServer({ term: 'anything' })).toBe(false);
		expect(requiresServer(undefined)).toBe(false);
		await expect(driver.engine.list('article', query)).rejects.toThrow(DelightError);
		await driver.engine.list('article', query).catch((error: DelightError) => {
			expect(error.status).toBe(400);
			expect(error.message).toContain('server-only');
		});
	});

	it('refuses a hybrid query too', async () => {
		const driver = await openTestDriver('article', SCHEMA);
		const query: SearchQuery = {
			term: 'hello',
			vector: { value: [1, 0, 0, 0], field: 'embedding' },
		};
		expect(requiresServer(query)).toBe(true);
		await expect(driver.engine.list('article', query)).rejects.toThrow(DelightError);
	});
});

describe('determinism', () => {
	it('reports zero elapsed without an injected clock', async () => {
		const corpus = generateCorpus({ preset: 'event', size: 'tiny', seed: 'event-tiny' });
		const driver = await buildIdbDriver(corpus);
		const result = await driver.engine.list(driver.entity_type, { term: 'summit' });
		expect(result.elapsed).toEqual({ raw: 0, formatted: '0ms' });
	});

	it('uses the injected clock when there is one', async () => {
		const corpus = generateCorpus({ preset: 'event', size: 'tiny', seed: 'event-tiny' });
		let tick = 0;
		const driver = await buildIdbDriver(corpus, { now: () => (tick += 5) });
		const result = await driver.engine.list(driver.entity_type, {});
		expect(result.elapsed.raw).toBe(5);
	});
});
