/**
 * Test harness for the client driver over a real IndexedDB implementation.
 *
 * `fake-indexeddb` is the standard in-process IDB — the same one the `idb`
 * library tests against — and it implements the parts this driver actually
 * leans on: compound and `multiEntry` indexes, key ranges, IDB's own key
 * ordering, and transaction auto-commit semantics. It is a **devDependency
 * only**; nothing shipped imports it.
 *
 * Real-browser passes (Chrome plus one non-V8 engine) are still required by
 * plan §8.2 — this harness is the fast gate, not a replacement for them.
 *
 * Tests using it must run in the `node` environment (`// @vitest-environment
 * node`), because the edge-runtime default has no `structuredClone` shape
 * `fake-indexeddb` is happy with.
 */

import 'fake-indexeddb/auto';
import {
	defineClientType,
	openSearchDatabase,
	IdbSearchStore,
	type ClientSearchType,
	type DocIndexPath,
	type DocWrite,
} from '../client/idb_store';
import { IdbSearchEngine, type IdbSearchEngineOptions } from '../client/engine';
import type { WhereSchema } from '../core/where';
import type { SearchableType } from '../core/types';
import { flattenSchema } from './support';
import type { Corpus, FixtureDocument } from './fixtures/corpus';

/** Unique database names, so no two tests can ever share state. */
let database_counter = 0;

/** Whether a declared type's values can be IDB index keys at all. */
function isIndexableType(type: SearchableType): boolean {
	return (
		type === 'string' ||
		type === 'string[]' ||
		type === 'number' ||
		type === 'number[]' ||
		type === 'enum' ||
		type === 'enum[]'
	);
}

/** Whether a declared type holds a list of values (a `multiEntry` index). */
function isArrayType(type: SearchableType): boolean {
	return (
		type === 'string[]' ||
		type === 'number[]' ||
		type === 'enum[]' ||
		type === 'boolean[]'
	);
}

/**
 * The `docs` indexes a schema deserves: every string/number/enum path, with
 * `multiEntry` on the array ones. Booleans, geopoints and vectors get none —
 * booleans are not valid IDB keys and the other two are never index-decidable.
 */
export function indexPathsFor(schema: WhereSchema): DocIndexPath[] {
	return Object.keys(schema)
		.filter((path) => isIndexableType(schema[path]))
		.sort()
		.map((path) => ({ path, multi_entry: isArrayType(schema[path]) }));
}

/**
 * Project a fixture document the way production projects a synced one: null and
 * undefined keys omitted at every depth (`toSparse`), and **vector fields
 * stripped** — they never reach the client (§7.0).
 */
export function toClientDocument(
	doc: FixtureDocument,
	schema: WhereSchema,
	prefix = '',
): FixtureDocument {
	const sparse: FixtureDocument = {};
	for (const key of Object.keys(doc)) {
		const path = prefix ? `${prefix}.${key}` : key;
		const value = doc[key];
		if (value === null || value === undefined) continue;
		const type = schema[path];
		if (typeof type === 'string' && type.startsWith('vector[')) continue;
		if (typeof value === 'object' && !Array.isArray(value)) {
			sparse[key] = toClientDocument(value as FixtureDocument, schema, path);
		} else {
			sparse[key] = value;
		}
	}
	return sparse;
}

/** One loaded corpus: the database, the store, the driver and its config. */
export interface LoadedIdbDriver {
	db: IDBDatabase;
	store: IdbSearchStore;
	engine: IdbSearchEngine;
	config: ClientSearchType;
	entity_type: string;
}

/** Options for {@link buildIdbDriver}. */
export interface BuildIdbDriverOptions extends IdbSearchEngineOptions {
	/** Documents per write transaction. @default 100 */
	batch_size?: number;
	/** Skip the `docs` indexes entirely (forces the scan path). @default false */
	without_indexes?: boolean;
}

/** Open an empty database for one entity type. */
export async function openTestDriver(
	entity_type: string,
	schema: WhereSchema,
	options: BuildIdbDriverOptions & {
		primary_key?: string;
		primary_key_type?: 'string' | 'number';
	} = {},
): Promise<LoadedIdbDriver> {
	const index_paths = options.without_indexes ? [] : indexPathsFor(schema);
	database_counter += 1;
	const db = await openSearchDatabase({
		name: `search-test-${database_counter}`,
		version: 1,
		index_paths,
		extra_stores: [{ name: 'sync_meta' }],
	});
	const store = new IdbSearchStore(db, { index_paths });
	const config = defineClientType({
		entity_type,
		schema,
		primary_key: options.primary_key,
		primary_key_type: options.primary_key_type,
	});
	store.register(config);
	return { db, store, engine: new IdbSearchEngine(store, options), config, entity_type };
}

/** Open a database and index every document of `corpus` into it. */
export async function buildIdbDriver(
	corpus: Corpus,
	options: BuildIdbDriverOptions = {},
): Promise<LoadedIdbDriver> {
	const schema = flattenSchema(corpus.schema);
	const driver = await openTestDriver(corpus.preset, schema, {
		...options,
		primary_key: corpus.primary_key,
		primary_key_type: corpus.primary_key_type,
	});
	const batch_size = options.batch_size ?? 100;
	const writes: DocWrite[] = corpus.docs.map((doc) => ({
		entity_type: corpus.preset,
		doc_id: String(doc[corpus.primary_key]),
		sparse_doc: toClientDocument(doc, schema),
	}));
	for (let index = 0; index < writes.length; index += batch_size) {
		await driver.store.applyWrites(writes.slice(index, index + batch_size));
	}
	return driver;
}
