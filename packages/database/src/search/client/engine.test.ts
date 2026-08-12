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

import { describe, expect, it } from 'vitest';
import { DelightError } from '@delightstack/utilities';
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
