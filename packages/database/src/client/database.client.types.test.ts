// @vitest-environment node
import { describe, it, expect, expectTypeOf } from 'vitest';
import { Database } from '../schema/schema';
import type { DatabaseClient, SearchResult } from './database.client.svelte';

// ── Type-level tests ─────────────────────────────────────────────────────────
// These assert how `db.list(...)` types its documents: the sparse projection by
// default, full entities when the query literal carries `sparse: false`.
// The assertions are checked by the compiler (`pnpm typecheck` runs tsgo over
// src/**/*.ts), not by the runner — the inference cases need call expressions
// against a `declare`d client, so they live in functions that are never
// invoked. Breaking a narrowing fails `typecheck`, not `vitest`.

const TEMPLATE = Database.table('template', (schema) => ({
	name: schema.string().searchable(),
	// Not searchable: absent from the sparse projection, present on the entity.
	field_schema: schema.object({ version: schema.number() }),
	use_count: schema.number(),
}));

type Templates = { template: typeof TEMPLATE };
type Sparse = Database.SearchEntity<typeof TEMPLATE>;
type Full = Database.Entity<typeof TEMPLATE>;

declare const db: DatabaseClient<Templates>;

// ── Field tiers ──────────────────────────────────────────────────────────────

const NOTE = Database.table('note', (schema) => ({
	title: schema.string().searchable(),
	// Indexed on the server, never on the wire.
	body: schema.string().searchable().serverOnly(),
	// The mirror tier: on the wire, never indexed.
	rendered: schema.string().carried(),
}));

type NoteSparse = Database.SearchEntity<typeof NOTE>;
type NoteFull = Database.Entity<typeof NOTE>;

/**
 * A `serverOnly()` field is absent from the synced document's type.
 *
 * This is the reason the tier has a type marker rather than a runtime flag: the
 * value can never arrive over the wire, so offering it on the client's document
 * type would be autocomplete for something that is always missing.
 */
function assertServerOnlyIsNotInTheSparseDocument() {
	expectTypeOf<NoteSparse['title']>().toEqualTypeOf<string | undefined>();
	expectTypeOf<NoteSparse['rendered']>().toEqualTypeOf<string | undefined>();
	// Typed absent, not merely missing: reading it gets `undefined`, so using it
	// as a string is a compile error rather than a silent `any`.
	expectTypeOf<NoteSparse['body']>().toEqualTypeOf<undefined>();
	// Held back from the wire, not from the database — a full read still has it.
	expectTypeOf<NoteFull['body']>().toEqualTypeOf<string>();
}

/** No query, or a query without `sparse: false`, keeps the sparse projection. */
function assertSparseByDefault() {
	expectTypeOf(db.list('template').items).toEqualTypeOf<Sparse[]>();
	expectTypeOf(db.list('template', { term: 'a' }).items).toEqualTypeOf<Sparse[]>();
	expectTypeOf(db.list('template', { sparse: true }).items).toEqualTypeOf<Sparse[]>();
	expectTypeOf(db.list('template').hits[0].document).toEqualTypeOf<Sparse>();
}

/** A literal `sparse: false` narrows to the full entity. */
function assertObjectLiteralNarrows() {
	const handle = db.list('template', { term: 'a', sparse: false });
	expectTypeOf(handle.items).toEqualTypeOf<Full[]>();
	expectTypeOf(handle.hits[0].document).toEqualTypeOf<Full>();
	// The non-searchable fields the narrowing exists for.
	expectTypeOf(handle.items[0].use_count).toEqualTypeOf<number>();
	expectTypeOf(handle.items[0].field_schema.version).toEqualTypeOf<number>();
}

/** `as const` and the function form narrow the same way. */
function assertConstAndFunctionFormNarrow() {
	expectTypeOf(db.list('template', { sparse: false } as const).items).toEqualTypeOf<
		Full[]
	>();
	expectTypeOf(
		db.list('template', () => ({ term: 'a', sparse: false })).items,
	).toEqualTypeOf<Full[]>();
}

/** A query without a literal type widens `sparse` to `boolean` — stays sparse. */
function assertWidenedQueryStaysSparse() {
	const query: Database.SearchQuery<typeof TEMPLATE> = { sparse: false };
	expectTypeOf(db.list('template', query).items).toEqualTypeOf<Sparse[]>();
	const dynamic = { sparse: Math.random() > 0.5 };
	expectTypeOf(db.list('template', dynamic).items).toEqualTypeOf<Sparse[]>();
}

/** `load()` resolves with the same document shape the handle exposes. */
async function assertLoadMatchesHandle() {
	expectTypeOf(db.list('template').load()).resolves.toEqualTypeOf<
		SearchResult<typeof TEMPLATE>
	>();
	expectTypeOf(db.list('template', { sparse: false }).load()).resolves.toEqualTypeOf<
		SearchResult<typeof TEMPLATE, Full>
	>();
	// Existing consumer annotations (the one-generic form) still compile.
	const result: SearchResult<typeof TEMPLATE> = await db.list('template').load();
	expectTypeOf(result.items).toEqualTypeOf<Sparse[]>();
}

// The one-generic form still means "sparse documents", so explicit
// `SearchResult<T>` annotations keep their old meaning.
expectTypeOf<SearchResult<typeof TEMPLATE>>().toEqualTypeOf<
	SearchResult<typeof TEMPLATE, Sparse>
>();

// The server-facing result type narrows on the same literal (it already did —
// `Database.SearchQueryResults` keys off `Query['sparse']`).
expectTypeOf<
	Database.SearchQueryResults<typeof TEMPLATE>['hits'][number]['document']
>().toEqualTypeOf<Sparse>();
expectTypeOf<
	Database.SearchQueryResults<
		typeof TEMPLATE,
		{ sparse: false }
	>['hits'][number]['document']
>().toEqualTypeOf<Full>();

describe('db.list document typing', () => {
	it('is asserted at compile time', () => {
		expect([
			assertSparseByDefault,
			assertObjectLiteralNarrows,
			assertConstAndFunctionFormNarrow,
			assertWidenedQueryStaysSparse,
			assertLoadMatchesHandle,
		]).toHaveLength(5);
	});
});
