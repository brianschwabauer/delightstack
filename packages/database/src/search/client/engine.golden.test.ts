// @vitest-environment node
/**
 * The golden-vector replay against the **client driver over IndexedDB**
 * (plan §8.2).
 *
 * This is the gate for the client driver: the same committed fixtures that
 * `search/__tests__/golden.test.ts` replays through `core/*` + the memory
 * reference, and `server/engine.golden.test.ts` replays through real SQLite,
 * are replayed here through the IDB write path, the postings/dictionary stores,
 * the index-driven candidate extraction and the async pipeline — and
 * byte-identical ids, counts and facets are required.
 *
 * Vector and hybrid fixtures (`server-only`) are the one exception, per §4.9:
 * no client vector path exists, so instead of a result they must produce a
 * descriptive rejection, and `requiresServer` must have said so up front.
 *
 * See `search/__tests__/idb_harness.ts` for the `fake-indexeddb` setup.
 */

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { DelightError } from '@delightstack/utilities';
import { generateCorpus } from '../__tests__/fixtures/corpus';
import {
	GOLDEN_FORMAT_VERSION,
	type GoldenCorpusRef,
	type GoldenSuite,
} from '../__tests__/fixtures/golden_format';
import { GOLDEN_SUITES } from '../__tests__/golden/generate';
import { toEngineQuery } from '../__tests__/support';
import { buildIdbDriver, type LoadedIdbDriver } from '../__tests__/idb_harness';
import { requiresServer } from './engine';

/** Reads a committed suite. */
function readSuite(file: string): GoldenSuite {
	const text = readFileSync(
		new URL(`../__tests__/golden/${file}`, import.meta.url),
		'utf8',
	);
	return JSON.parse(text) as GoldenSuite;
}

/** A corpus reference's cache key. */
function corpusKey(ref: GoldenCorpusRef): string {
	return `${ref.preset}|${ref.size}|${ref.seed}`;
}

describe.each(GOLDEN_SUITES.map((spec) => spec.file))(
	'client driver — golden suite %s',
	(file) => {
		let suite: GoldenSuite;
		const drivers = new Map<string, LoadedIdbDriver>();

		async function driverFor(ref: GoldenCorpusRef): Promise<LoadedIdbDriver> {
			const key = corpusKey(ref);
			const cached = drivers.get(key);
			if (cached) return cached;
			const corpus = generateCorpus({
				preset: ref.preset,
				size: ref.size,
				seed: ref.seed,
			});
			expect(corpus.docs.length, `${key} doc_count`).toBe(ref.doc_count);
			const driver = await buildIdbDriver(corpus);
			drivers.set(key, driver);
			return driver;
		}

		beforeAll(() => {
			suite = readSuite(file);
			expect(suite.format_version).toBe(GOLDEN_FORMAT_VERSION);
		});

		it('reproduces every frozen result', { timeout: 900_000 }, async () => {
			const failures: string[] = [];
			for (const vector of suite.vectors) {
				const label = `${vector.name} @ ${corpusKey(vector.corpus_ref)}`;
				const driver = await driverFor(vector.corpus_ref);
				const query = toEngineQuery(vector.query);
				if (vector.tags.includes('server-only')) {
					// §4.9: no client vector path. The router must have caught it, and
					// the driver must refuse rather than silently answer without them.
					if (!requiresServer(query)) failures.push(`${label}: requiresServer false`);
					await expect(driver.engine.list(driver.entity_type, query)).rejects.toThrow(
						DelightError,
					);
					continue;
				}
				let result;
				try {
					result = await driver.engine.list(driver.entity_type, query);
				} catch (error) {
					failures.push(`${label}: threw ${(error as Error).message}`);
					continue;
				}
				const ids = result.hits.map((hit) => hit.id);
				const expected_ids = vector.expected_ids_in_order.map((id) => String(id));
				if (JSON.stringify(ids) !== JSON.stringify(expected_ids)) {
					failures.push(
						`${label}: ids ${JSON.stringify(ids).slice(0, 200)} != ${JSON.stringify(expected_ids).slice(0, 200)}`,
					);
					continue;
				}
				if (result.count !== vector.expected_counts.total) {
					failures.push(
						`${label}: count ${result.count} != ${vector.expected_counts.total}`,
					);
				}
				if (ids.length !== vector.expected_counts.returned) {
					failures.push(
						`${label}: returned ${ids.length} != ${vector.expected_counts.returned}`,
					);
				}
				const expected_facets = vector.expected_facets;
				if (expected_facets) {
					if (JSON.stringify(result.facets) !== JSON.stringify(expected_facets)) {
						failures.push(
							`${label}: facets ${JSON.stringify(result.facets)} != ${JSON.stringify(expected_facets)}`,
						);
					}
				} else if (result.facets) {
					failures.push(`${label}: unexpected facets`);
				}
			}
			expect(failures).toEqual([]);
		});

		it('reproduces every frozen rejection', { timeout: 900_000 }, async () => {
			const failures: string[] = [];
			for (const vector of suite.error_vectors) {
				const label = `${vector.name} @ ${corpusKey(vector.corpus_ref)}`;
				const driver = await driverFor(vector.corpus_ref);
				const query = toEngineQuery(vector.query);
				const server_only = vector.tags.includes('server-only');
				try {
					await driver.engine.list(driver.entity_type, query);
					failures.push(`${label}: did not throw`);
				} catch (error) {
					if (!DelightError.is(error)) {
						failures.push(`${label}: threw a non-DelightError`);
						continue;
					}
					if (server_only) {
						// A vector query is refused before anything else is validated, so
						// only the status is comparable — the reason differs by design.
						if (error.status !== 400) failures.push(`${label}: status ${error.status}`);
						continue;
					}
					if (error.status !== vector.expected_status) {
						failures.push(
							`${label}: status ${error.status} != ${vector.expected_status}`,
						);
					}
					const expected_message = vector.expected_message_contains;
					if (expected_message && !error.message.includes(expected_message)) {
						failures.push(`${label}: message "${error.message}"`);
					}
				}
			}
			expect(failures).toEqual([]);
		});
	},
);
