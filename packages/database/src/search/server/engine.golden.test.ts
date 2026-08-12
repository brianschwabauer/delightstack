// @vitest-environment node
/**
 * The golden-vector replay against the **server driver over real SQLite**
 * (plan §8.2).
 *
 * This is the gate for the server driver: the same committed fixtures that
 * `search/__tests__/golden.test.ts` replays through `core/*` + the memory
 * reference are replayed here through the full server stack — entity tables
 * with real columns and a `json` overflow column, `sv$` generated columns, the
 * `sqlite_store` write path, the SQL compiler and the synchronous pipeline —
 * and byte-identical ids, counts and facets are required.
 *
 * Vector and hybrid fixtures are included: they are server-only (§4.9), so the
 * memory reference and this driver are their only two implementations.
 *
 * See `search/__tests__/sqlite_harness.ts` for why this runs on `node:sqlite`.
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
import { flattenSchema, toEngineQuery } from '../__tests__/support';
import {
	createEntityTable,
	insertEntityRow,
	NodeSqlStorage,
} from '../__tests__/sqlite_harness';
import { SqliteSearchEngine } from './engine';

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

/** One loaded corpus: a database, the driver, and the entity type name. */
interface LoadedDriver {
	sql: NodeSqlStorage;
	engine: SqliteSearchEngine;
	entity_type: string;
}

/**
 * Build a database holding one corpus: entity rows written the way
 * `db.server.ts` writes them, then the whole table indexed through the driver's
 * own rebuild path (which reads the rows back, so the column/`json` round trip
 * is under test too).
 */
function loadDriver(ref: GoldenCorpusRef): LoadedDriver {
	const corpus = generateCorpus({ preset: ref.preset, size: ref.size, seed: ref.seed });
	expect(corpus.docs.length, `${corpusKey(ref)} doc_count`).toBe(ref.doc_count);
	const sql = new NodeSqlStorage();
	sql.record = false;
	const engine = new SqliteSearchEngine(sql);
	engine.bootstrap();
	const table = createEntityTable(sql, {
		entity_type: ref.preset,
		table_name: `${ref.preset}s`,
		schema: flattenSchema(corpus.schema),
		primary_key: corpus.primary_key,
		primary_key_type: corpus.primary_key_type,
	});
	engine.register(table);
	for (const doc of corpus.docs) insertEntityRow(sql, table, doc);
	let after: string | number | undefined;
	for (;;) {
		const batch = engine.rebuildBatch(ref.preset, { after, batch_size: 250 });
		after = batch.last_primary_key;
		if (batch.done) break;
	}
	return { sql, engine, entity_type: ref.preset };
}

describe.each(GOLDEN_SUITES.map((spec) => spec.file))(
	'server driver — golden suite %s',
	(file) => {
		let suite: GoldenSuite;
		const drivers = new Map<string, LoadedDriver>();

		function driverFor(ref: GoldenCorpusRef): LoadedDriver {
			const key = corpusKey(ref);
			const cached = drivers.get(key);
			if (cached) return cached;
			const driver = loadDriver(ref);
			drivers.set(key, driver);
			return driver;
		}

		beforeAll(() => {
			suite = readSuite(file);
			expect(suite.format_version).toBe(GOLDEN_FORMAT_VERSION);
		});

		it('reproduces every frozen result', { timeout: 600_000 }, () => {
			const failures: string[] = [];
			for (const vector of suite.vectors) {
				const label = `${vector.name} @ ${corpusKey(vector.corpus_ref)}`;
				const driver = driverFor(vector.corpus_ref);
				let result;
				try {
					result = driver.engine.list(driver.entity_type, toEngineQuery(vector.query));
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

		it('reproduces every frozen rejection', { timeout: 600_000 }, () => {
			const failures: string[] = [];
			for (const vector of suite.error_vectors) {
				const label = `${vector.name} @ ${corpusKey(vector.corpus_ref)}`;
				const driver = driverFor(vector.corpus_ref);
				try {
					driver.engine.list(driver.entity_type, toEngineQuery(vector.query));
					failures.push(`${label}: did not throw`);
				} catch (error) {
					if (!DelightError.is(error)) {
						failures.push(`${label}: threw a non-DelightError`);
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
