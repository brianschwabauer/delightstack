# @delightstack/database

Type-safe database layer for Cloudflare Durable Objects with built-in full-text search, schema validation, automatic migrations, and a reactive Svelte 5 client that syncs a local search index.

## Features

- **Declarative schema** — Define tables with a fluent TypeScript API. Field types, constraints, and validators are inferred at compile time.
- **Full-text & vector search** — A built-in search engine with no third-party dependency: BM25 ranking, typo tolerance, prefix search, facets, geo and vector/hybrid queries. Mark fields as `.searchable()` and query them. The index lives in SQLite rows written inside the same transaction as the entity row, so there is no snapshot to serialize and no cold-start rebuild.
- **Automatic migrations** — New columns are added automatically when you update your schema. No migration files to manage.
- **Dependency-free validation** — Every `create()` and `update()` call validates data against the schema at runtime. String formats (`.email()`, `.url()`, `.datetime()`), length/number ranges (`.min()`, `.max()`), and custom `.check()` functions are enforced — all in-house, no zod.
- **Transactions** — Batch multiple create/update/delete/exec operations into a single atomic transaction.
- **Incremental sync** — `sync()` returns only the changes since a given timestamp, enabling efficient client-side search index mirroring.
- **Form generation** — Schema definitions automatically produce HTML form field attributes plus a Standard Schema validator for whole-form validation.
- **Auto-generated API routes** — `createDatabaseHandle({ tables, hooks })` plugs into SvelteKit's `handle` and serves CRUD + sync routes for every table, with lifecycle hooks for auth and side effects.
- **Reactive client (Svelte 5)** — `DatabaseClient` gives you three reactive read handles (`get` / `entity` / `list`), IndexedDB caching, a local IndexedDB search index, optimistic updates, and coverage-based client/server query routing — all heavy work running off-thread in a SharedWorker.

## Upgrading to v2

v2 is a major release: the search engine, the client read API, and the schema validation layer were all replaced. The full set of breaking changes:

### Client: three handles replace five read APIs

`db.watch` (`DatabaseWatch`), `db.read` (`EntityReader`), `EntityState.from`, and `markHydrated` are **removed**. `db.get`, `db.entity`, and `db.list` now return reactive handle objects — not promises.

```ts
// v1
let person = $derived(await db.get('person', id)); // db.get returned a Promise
const people = db.watch('person', { term: 'alice' }); // live list
const reader = db.read('person', () => id); // read-only reactive handle

// v2
const person = db.get('person', id); // reactive EntityHandle
person.value; // live value (undefined until loaded)
let loaded = $derived(await db.get('person', id).load()); // awaited form, still reactive
const people = db.list('person', { term: 'alice' }); // live ListHandle (the old watch + list merged)
const once = await db.list('person', { term: 'alice' }).load(); // one-shot form
```

- `WatchStatus` is renamed **`HandleStatus`** (same `'loading' | 'refreshing' | 'ready' | 'error'` union).
- The client `SearchResult` drops `elapsed` and gains `mode: 'client' | 'server'` — the live routing decision, per result.
- The worker RPCs `getSearchMode` / `isSynced` are removed; read `result.mode` (or `handle.mode`) instead.

### Newer v2 changes (same release)

- `ListHandle.results` → **`hits`** and `ListHandle.docs` → **`items`** (and `SearchResult.docs` → `items`). The hit objects keep their `{ id, score, document }` shape — `document` is also the wire field name in server list responses.
- `createDatabaseHandle`'s **`sync` option now defaults to `true`** — pass `sync: false` to opt out. (Previously it was off unless enabled, which silently broke client search.)
- **Reserved field names**: `and`, `or`, `not`, and `$derived` can no longer be used as table field names (compile-time and runtime errors) — the first three collide with the `where`-clause grammar, the last with the internal derived-values store. `created_at`/`updated_at` were already reserved.
- `sparse: false` now routes client queries to the server automatically, and combining it with `source: 'client'` is an error (same treatment as `vector`).
- New: **`db.signOut()`** wipes all locally persisted data (entity cache, sync cursors, and the local search index) — see [Lifecycle](#lifecycle).
- `DatabaseClient`'s lifecycle booleans consolidated: **`db.status`** (`'idle' | 'initializing' | 'ready' | 'signed_out'`) replaces `initialized`, `hydrated` (now internal), and `signed_out`; the `syncing`/`synced` booleans remain.

### Schema: zod is removed

Validation is now in-house and dependency-free. `parse()` behavior is unchanged, except failures throw `DelightError` (status 400, with an `issues` array attached).

- Some zod-passthrough builder methods are **deleted**: `length`, `nonempty`, `lowercase`/`uppercase` (the case *asserts*), `gte`/`lte` (use `min`/`max`), `positive`/`negative` (use `gt(0)`/`lt(0)`), `multipleOf` (use `step`), `refine`/`superRefine` (use `check`), `transform`, and `prefault`. Others were re-implemented in-house and still work: `startsWith`/`endsWith`/`includes`, the transforms `trim`/`toLowerCase`/`toUpperCase`/`normalize`, and the exclusive bounds `gt`/`lt`.
- **`.check(fn)`** is the custom-validation escape hatch (return an error string to fail).
- **`.step(n)`** replaces `multipleOf` — it validates divisibility (decimal-safe) *and* sets the form input's step attribute.
- `Database.Table` is the one table type; `Database.AnyTable` remains as a deprecated alias.
- `table()` no longer takes a third options argument (the temporary `search_engine` opt-in is gone).

```ts
// v1
username: schema.string().nonempty().lowercase().refine((v) => !v.includes(' '), 'No spaces'),

// v2
username: schema.string().min(1).check((v) => (v.includes(' ') ? 'No spaces' : undefined)),
```

### Server & handler

- `createDatabaseHandle` supports **only** the `tables` + `hooks` mode. `defineRoute` and the `routes` array are removed:

  ```ts
  // v1
  createDatabaseHandle({ getDatabase, routes: [defineRoute({ entity: 'post', table: postTable, hooks })] });

  // v2
  createDatabaseHandle({ getDatabase, tables, hooks: { post: { ... } } });
  ```

- The sync endpoint is POST-only, and `DatabaseSyncRequest` drops the top-level `start_updated_at` / `end_updated_at` / `limit` — ranges and limits are **per-entity** in the `entity` map (one request still syncs any number of entity types; `config_version` is now optional).
- The batch array overload of `DatabaseServer.get()` is removed — call `get()` per id.
- The never-populated `event.user_id` fields on transaction operations are removed, as is `EntityChangedMessage.user_id` in `@delightstack/websocket` (`entityChanged` is now `(action, entity_type, id, data?, sparse?)`).
- **`SqlServer` moved to `@delightstack/auth`** (it was auth-private in practice), and **`prepareSql` / `SqlTaggedTemplate` moved to `@delightstack/utilities`** (still re-exported from `@delightstack/database/server` for compatibility).
- **The root entry is now schema + types only.** It no longer re-exports `/server`, so `createDatabaseHandle` (and `prepareSql`) must be imported from `@delightstack/database/server`. The unused `./schema` export is removed. This keeps a schema-only import from dragging the SvelteKit handler into worker/client bundles.
- New: **`DatabaseStub<Config>`** — the typed async RPC projection of `DatabaseServer` for typing DO stubs (see [Typed stubs](#typed-stubs-databasestub)).
- New: **alarm registry + `instanceName`** — `registerAlarm(name, fn)` and a base `alarm()` with per-handler error isolation (integrations self-register); `DatabaseServer.instanceName(ctx)` / `this.instance_name` recover the `idFromName()` key without the `ctx.id` cast.
- New: **the database ↔ websocket contract is typed** — `DatabaseBroadcast` / `DatabaseClientHooks` / `DatabaseEntityChange` are exported from the root; `@delightstack/websocket` implements them, so drift between the packages is a compile error.
- **`foreignKey` accepts the referenced table object** (`table: organizationTable`) in addition to its name string — a typo'd reference becomes a compile error.

### Search engine: Orama is gone (unreleased 1.x → 2.0 changesets)

- The built-in SQLite engine is the only engine; `@orama/orama` and `@msgpack/msgpack` are no longer dependencies. Durable Objects **migrate themselves once** on first wake: sync metadata moves to `search_state`/`search_tombstones`, search rows rebuild from entity rows, `config_version` bumps (every client resyncs once), and the legacy `search_index`/`search_journal` tables are dropped. `table.config.orama` is now `table.config.index_schema` (the flat search schema itself).
- **Query-key renames, with no legacy aliases** — old spellings stop working in typed queries, URLs, and old cursors: `distinctOn` → `distinct_on`, `properties` → `fields`, `vector.property` → `vector.field`, `order[].key` → `order[].field`, `containsAll`/`containsAny`/`nin` → `contains_all`/`contains_any`/`not_in`, and `q` is removed entirely (use `term`). `vector` gains an optional `similarity` floor (default `0.8`). The tokenizer also changed (apostrophe folding, camelCase splitting, dotted acronyms, whole numbers kept) — rankings shift slightly on affected corpora.
- **The client index moved into IndexedDB** — no memory ceiling, no rebuild-on-load, transactional index writes, and byte-identical results between client and server. The old 5000-document auto-switch is replaced by **coverage-based routing** (see [Query routing](#query-routing)), and synced sparse documents no longer carry `vector[...]` fields (vector search is server-only).
- `schema.array(schema.enum([...])).searchable()` now actually works (`enum[]` in the index schema: filterable and facetable, never term-matched), and searchable arrays now appear in the inferred `Database.SearchSchema<Table>` type.

## Architecture

```
  ┌─────────────────────────────────────────────────────┐
  │               Cloudflare Durable Object             │
  │                                                     │
  │  ┌────────────┐   ┌──────────┐   ┌───────────────┐  │
  │  │   Schema   │──>│  SQLite  │   │  Search Tables│  │
  │  │ Definition │   │ (storage)│   │   (SQLite)    │  │
  │  └────────────┘   └──────────┘   └───────────────┘  │
  │        │               ▲ ▲               ▲          │
  │        │               │ │               │          │
  │        ▼               │ │               │          │
  │  ┌─────────────────────┴─┴───────────────┴───────┐  │
  │  │              DatabaseServer                   │  │
  │  │  create() get() update() delete() list() ...  │  │
  │  └───────────────────────────────────────────────┘  │
  │                        │                            │
  │                        ▼                            │
  │               ┌────────────────┐                    │
  │               │   WebSocket    │                    │
  │               │  (broadcast)   │                    │
  │               └────────────────┘                    │
  └─────────────────────────────────────────────────────┘
```

**Schema → SQLite + search tables:** Each table definition produces a SQLite table (for persistent storage) and a set of shared search tables (`search_postings`, `search_tokens`, `search_docs`, `search_field_stats`, `search_vectors`, plus `search_state`/`search_tombstones` for sync). The `DatabaseServer` writes both inside one transaction, so a rolled-back write can never leave a stale index behind.

**Single-writer model:** Durable Objects guarantee a single instance handles all writes, eliminating race conditions. SQLite transactions provide atomicity within that instance.

**JSON catch-all column:** Root-level scalar fields (string, number, boolean, enum, foreign key) get their own SQLite columns. Non-scalar fields (object, array, vector, geopoint) are serialized into a single `json` TEXT column and transparently deserialized on read.

## Quickstart

### 1. Define your schema

```typescript
import { Database } from '@delightstack/database';

const personTable = Database.table('person', (schema) => ({
	name: schema.string().min(1).max(100).searchable(),
	email: schema.string().email().unique().searchable(),
	role: schema.enum(['admin', 'user', 'guest']).searchable(),
	bio: schema.string().optional(),
	avatar_url: schema.string().url().optional(),
}));

const postTable = Database.table('post', (schema) => ({
	title: schema.string().searchable(),
	body: schema.string().searchable(),
	author_id: schema.foreignKey({
		type: 'string',
		table: 'person',
		column: 'id',
		on_delete: 'CASCADE',
	}),
	tags: schema.array(schema.string()).searchable().optional(),
	published: schema.boolean().default(false),
}));

export const tables = { person: personTable, post: postTable };
```

> **`id`, `created_at`, and `updated_at` are auto-managed — do not declare them.** Every table gets a string `id` primary key injected automatically (declare `schema.primaryKey()` yourself only for a numeric auto-increment key or a custom name). `created_at` / `updated_at` are epoch-millisecond **numbers** set by the server on every write; declaring either in your schema throws at table-definition time. Declaring them as datetime strings (the v1 pattern) would break `parse()` — they are numbers now.

### 2. Create your Durable Object

```typescript
// worker entry point (e.g. server/src/index.ts)
import { DatabaseServer } from '@delightstack/database/worker';
import { tables } from './schema';

export class MyDatabase extends DatabaseServer<typeof tables> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(tables, () => env.WEBSOCKET, ctx, env);
	}
}
```

> **Import `DatabaseServer` from `@delightstack/database/worker`, not the package root.** The class imports `cloudflare:workers`, which only resolves inside the Workers runtime — the main entry (and `/server`) export only its *type*, so `import { DatabaseServer } from '@delightstack/database'` fails to resolve the value in a SvelteKit/Vite build. The `/worker` entry belongs in your Worker entry point; app code that needs the type uses `import type { DatabaseServer } from '@delightstack/database'`.

The second constructor argument lazily returns your WebSocket Durable Object (any object with an `entityChanged(action, entity_type, id, data?, sparse?)` method) for broadcasting changes; return `undefined` to skip broadcasting.

On first instantiation, `DatabaseServer` automatically creates the SQLite tables, indexes, and search tables. On subsequent runs, it detects schema changes and adds new columns. It does not automatically delete old tables.

### 3. Use the API

```typescript
// Create
const person = db.create('person', {
	email: 'alice@example.com',
	name: 'Alice',
	role: 'admin',
});
// person.id is auto-generated, created_at/updated_at are set automatically

// Read
const alice = db.get('person', person.id);

// Read with foreign key expansion
const post = db.get('post', post_id, ['author_id']);
// post.expanded.author_id → full person record

// Update (deep partial merge)
db.update('person', person.id, { name: 'Alice B.' });

// Delete
db.delete('person', person.id);

// Search
const results = db.list('person', {
	term: 'alice',
	where: { role: 'admin' },
	limit: 20,
});

// Raw SQL
const rows = db.exec(`SELECT * FROM person WHERE role = ?`, 'admin');

// Tagged template (prevents SQL injection)
const rows = db.exec((sql) => {
	const role = 'admin';
	return sql`SELECT * FROM person WHERE role = ${role}`;
});
```

## Schema Reference

> **Reserved field names.** `id` is auto-injected (unless you declare your own primary key), `created_at`/`updated_at` are auto-managed, and `and`/`or`/`not`/`$derived` are reserved (`where`-grammar keywords and the internal derived-values store). Declaring any of them is a compile-time and runtime error.

### Field Types

| Type            | Constructor                     | Storage               | Notes                                                                                 |
| --------------- | ------------------------------- | --------------------- | ------------------------------------------------------------------------------------- |
| **Primary Key** | `schema.primaryKey()`           | `TEXT PRIMARY KEY`    | Optional — an `id` string key is auto-injected when omitted. `{ type: 'number' }` for auto-increment integer. |
| **String**      | `schema.string()`               | `TEXT`                | Format validators, length constraints, regex patterns.                                |
| **Number**      | `schema.number()`               | `NUMERIC`             | Use `.int()` for `INTEGER`. Supports min/max and a form `step`.                       |
| **Boolean**     | `schema.boolean()`              | `BOOLEAN`             | Stored as 0/1 in SQLite.                                                              |
| **Enum**        | `schema.enum(['a', 'b'])`       | `TEXT`                | Constrained to the provided values. Also accepts `[{ value, label }]` pairs — labels drive form Select options. |
| **Foreign Key** | `schema.foreignKey({...})`      | `TEXT REFERENCES ...` | Typed reference to another table with cascade options.                                |
| **Object**      | `schema.object({...})`          | `json` column         | Nested fields. Stored in the internal JSON overflow column.                           |
| **Array**       | `schema.array(schema.string())` | `json` column         | Typed array. `string[]`/`number[]`/`boolean[]`/`enum[]` items can be `.searchable()`. |
| **Geopoint**    | `schema.geopoint()`             | `json` column         | `{ lat, lon }`. Always searchable for geospatial queries.                             |
| **Vector**      | `schema.vector(768)`            | `json` column         | Fixed-dimension embedding. Always searchable; vector search runs server-side only.    |

### Modifiers

```typescript
schema
	.string()
	.optional() // Nullable (stored as NULL)
	.readonly() // Immutable after creation
	.default('foo') // Default value (or a function: () => value)
	.searchable() // Indexed for full-text search
	.sortable() // Sortable in search results (implies searchable)
	.indexable() // SQLite B-tree index for fast WHERE queries
	.unique() // UNIQUE constraint in SQLite
	.label('Name') // UI label for form generation
	.placeholder('Enter name') // UI placeholder
	.description('Shown below the input') // UI helper text
	.check((v) => (v === 'bad' ? 'Not allowed' : undefined)); // Custom validation
```

Not every modifier exists on every type: `indexable`/`unique` are for string and number fields (which own a SQLite column); `default`, `label`, `placeholder`, `description`, `check`, and `derived` are for the scalar types (string, number, boolean, enum); arrays support `min`/`max` (length), `label`, `placeholder`, `description`, and `searchable`; `optional`/`readonly` work everywhere.

### String Formats

Mutually exclusive — pick one. Formats compose with `.min()`/`.max()` (both are checked).

```typescript
schema.string().email(); // RFC email
schema.string().url(); // Valid URL
schema.string().uuid(); // UUID
schema.string().datetime(); // ISO 8601 datetime
schema.string().date(); // YYYY-MM-DD
schema.string().time(); // HH:MM[:SS]
schema.string().ipv4(); // IPv4 address
schema.string().ipv6(); // IPv6 address
schema.string().base64(); // Base64 string
schema.string().color(); // Hex color (#RGB or #RRGGBB)
schema.string().password(); // Masked input (UI hint only)
schema.string().phone(); // Phone number (UI hint only)
```

> **Input coercion.** Before validating, `parse()` (and the form standard schema — both share one validator) converts inputs with a single canonical representation to the field's declared type:
>
> - `Date` → epoch-ms number for `number()` fields (including `created_at`/`updated_at`), `"YYYY-MM-DD"` for `.date()`, `"HH:MM:SS"` for `.time()`, full ISO 8601 for `.datetime()`
> - `URL` instance → `.href` for `.url()` fields
> - Whole numeric strings (`"42"`, `" 4.5 "`) → numbers for `number()` fields — so native `FormData` values validate
> - `'true'`/`'on'`/`'1'`/`1` → `true` and `'false'`/`'0'`/`0` → `false` for `boolean()` fields
> - `Float32Array`/`Float64Array` (and other typed arrays) → plain number arrays for `vector()` fields
> - `{ latitude, longitude }` (e.g. a `GeolocationCoordinates`) → `{ lat, lon }` for `geopoint()` fields; out-of-range coordinates clamp
>
> Ambiguous conversions are deliberately not attempted: JSON strings never auto-parse, ISO text never coerces into plain `number()` fields, and a `Date` into an unformatted `string()` field is still an error.

### String Validators

```typescript
schema
	.string()
	.min(1) // Minimum length
	.max(255) // Maximum length
	.regex(/^[A-Z]+$/) // Regex pattern (repeatable)
	.startsWith('user_') // Must start with the prefix
	.endsWith('.md') // Must end with the suffix
	.includes('@') // Must contain the substring
	.textarea(); // Renders as textarea in forms (no validation effect)
```

Transforms rewrite the value during `parse()` — they run in declaration order,
**before** validators (so `.trim().min(1)` rejects a whitespace-only string),
and the transformed value is what gets stored:

```typescript
schema.string().trim(); // Strip surrounding whitespace
schema.string().toLowerCase(); // e.g. emails, slugs
schema.string().toUpperCase();
schema.string().normalize(); // Unicode normalization (NFC by default)
```

Anything beyond these goes through `.check()` (runs last, after transforms and
built-in validators):

```typescript
schema.string().check((value) => {
	if (value.endsWith('.test')) return 'Test domains are not allowed';
});
```

### Number Validators

```typescript
schema
	.number()
	.int() // Must be integer (INTEGER column)
	.min(0) // >= value (inclusive)
	.max(100) // <= value (inclusive)
	.gt(0) // > value (exclusive — "price must be positive")
	.lt(100) // < value (exclusive)
	.step(0.01); // Must be a multiple (decimal-safe) + sets the form step attribute
```

### Derived Fields

A derived field is **search-only**: computed from other fields at index time, never stored in SQLite, absent from `Database.Entity` but present in `Database.SearchEntity`. `derived()` implies `searchable` + `readonly`.

```typescript
const personTable = Database.table('person', (s) => ({
	first_name: s.string(),
	last_name: s.string(),
	// Same-table derived value
	full_name: s.string().derived((data) => `${data.first_name} ${data.last_name}`),
	organization_id: s.foreignKey({ type: 'string', table: 'organization', column: 'id' }),
	// Cross-table derived value: declare the FK dependencies, receive the
	// referenced rows. Writes to the referenced organization cascade a reindex.
	organization_name: s
		.string()
		.derived(['organization_id'], (data, refs) => refs.organization_id?.name ?? ''),
}));
```

### Foreign Keys

```typescript
schema.foreignKey({
	type: 'string', // Type of the referenced column
	table: 'person', // Referenced table name
	column: 'id', // Referenced column name
	on_delete: 'CASCADE', // CASCADE | SET NULL | RESTRICT | NO ACTION | SET DEFAULT
	on_update: 'CASCADE', // Same options
});
// or chain: schema.foreignKey({...}).onDelete('CASCADE').onUpdate('CASCADE')
```

Foreign key constraints are always enforced in Durable Object SQLite (workerd compiles it with foreign keys ON by default).

### Indexes

```typescript
// Simple index
schema.string().indexable();

// Named unique index
schema.string().indexable({ name: 'idx_email', unique: true });

// Composite index (covering)
schema.string().indexable({
	additional_columns: [{ column: 'created_at', descending: true }],
});
```

## Type Inference

The schema system infers TypeScript types from your field definitions:

```typescript
const personTable = Database.table('person', (schema) => ({
	name: schema.string(),
	age: schema.number().int().optional(),
	role: schema.enum(['admin', 'user']),
}));

type Person = Database.Entity<typeof personTable>;
// {
//   readonly id: string;          // auto-injected primary key
//   name: string;
//   age?: number | null;
//   role: 'admin' | 'user';
//   readonly created_at: number;  // epoch ms, auto-managed
//   readonly updated_at: number;  // epoch ms, auto-managed
// }
```

Optional fields become `T | undefined | null`. Readonly fields get the `readonly` modifier. Enum values are narrowed to their literal union. Other useful types: `Database.SearchEntity<Table>` (the sparse indexed document), `Database.SearchQuery<Table>` (a typed query), and `Database.Table` (the widened constraint any table satisfies).

## DatabaseServer API

### Constructor

```typescript
class DatabaseServer<Config, Meta> extends DurableObject {
	constructor(
		config: Config, // Record of table definitions
		ws: () => DatabaseBroadcast | undefined, // Lazy WebSocket DO for broadcasting
		ctx: DurableObjectState, // Durable Object context
		env: Env, // Environment bindings ({ DEV: boolean })
	);
}
```

The `ws` factory returns anything implementing the `DatabaseBroadcast` contract (`WebsocketServer` from `@delightstack/websocket` does), or `undefined` to skip broadcasting.

### Instance name & alarms

```typescript
export class OrgDatabaseServer extends DatabaseServer<typeof tables> {
	constructor(ctx: DurableObjectState, env: Env) {
		// The name this DO was created with via idFromName() (e.g. the org id).
		// Static so it's usable before super(); also available as `this.instance_name`.
		const room = DatabaseServer.instanceName(ctx);
		super(tables, () => env.WS.get(env.WS.idFromName(room)), ctx, env);
		// imageProcessing()/aiProcessing() call db.registerAlarm() themselves —
		// the base alarm() runs every registered handler with per-handler
		// error isolation, so no hand-written alarm() fan-out is needed.
	}
}
```

`registerAlarm(name, handler)` adds a named handler to the base `alarm()`. Only override `alarm()` when you need full control — the override then owns calling the registered handlers.

### Typed stubs (`DatabaseStub`)

Cloudflare types DO stubs opaquely, so cast **once** at the boundary with `DatabaseStub<typeof tables>` — the async RPC projection of `DatabaseServer` — and every later call is fully typed:

```typescript
// app.d.ts
import type { DatabaseStub } from '@delightstack/database';
interface Locals { db: DatabaseStub<typeof tables> | undefined }

// hooks.server.ts
event.locals.db = penv.DB.get(id) as unknown as DatabaseStub<typeof tables>;

// anywhere on the server
const post = await locals.db.get('post', post_id); // Database.Entity<typeof postTable>
```

Only RPC-serializable methods are projected — the tagged-template `exec` overload and `batch()` take function arguments that don't survive the RPC boundary.

### CRUD

| Method     | Signature                         | Notes                                                                                |
| ---------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| **create** | `create(type, data) → Entity`     | Auto-generates ID and timestamps. Validates against the schema. Updates search index. |
| **get**    | `get(type, id, expand?) → Entity` | Throws `DelightError` (404) if not found. `expand` populates foreign key references into `entity.expanded`. |
| **update** | `update(type, id, data) → Entity` | Deep partial merge. Validates merged result. Updates search index.                   |
| **delete** | `delete(type, id) → void`         | Removes from SQLite and search index. Tracks deletion (tombstone) for sync.          |

All CRUD methods are **synchronous** (SQLite in Durable Objects is synchronous).

`create()` strips `id`, `created_at`, and `updated_at` from input data — these are auto-managed. `update()` auto-sets `updated_at`. Validation failures throw `DelightError` (status 400) with an `issues` array of `{ path, message }`.

### Search & List

`db.list(type, query)` runs a search query and returns matching documents. All query fields:

```typescript
db.list('person', {
  // Full-text search term (prefix-matched per token by default)
  term: 'alice',

  // Which searchable fields the term matches against. '*' (default) = all.
  fields: ['name', 'email'],

  // Filters applied before scoring (see the where grammar below)
  where: { role: { eq: 'admin' } },

  // Ordering — only `updated_at` and fields marked `.sortable()` are valid.
  // Browse queries (no term/vector) default to updated_at DESC; relevance
  // queries default to score order.
  order: [{ field: 'updated_at', direction: 'DESC' }],

  // Pagination
  limit: 20, // clamped to 5000 sparse / 100 full; defaults 100 sparse / 10 full
  offset: 40, // skip N results (clamped to 100 000)
  cursor: previous.cursor, // keyset cursor — when set, other params are ignored
                           // (except your `where`, which is re-ANDed for safety)

  // Facet counts alongside the results
  facets: {
    role: { limit: 10, sort: 'desc' }, // string/enum facet
    age: { ranges: [{ from: 0, to: 18 }, { from: 18, to: 65 }] }, // number facet
    published: {}, // boolean facet — both buckets always reported
  },

  // Per-field score multipliers during term matching
  boost: { title: 2 },

  // Match the term exactly instead of by prefix
  exact: false,

  // Max levenshtein distance for typo tolerance (clamped to 0–3)
  tolerance: 1,

  // Multi-token combining: 0 = every token must match, 1 (default) = any
  // token, fractional = all-token matches + that top fraction of partials
  threshold: 0.5,

  // Keep only the first result per distinct value of this field
  distinct_on: 'author_id',

  // Vector search (server-only). `vector` alone = vector search,
  // term + vector = hybrid, term alone = full text. `similarity` is the
  // inclusive minimum cosine similarity (default 0.8).
  vector: { value: [0.1, 0.2 /* … */], field: 'embedding', similarity: 0.8 },

  // true (default) = sparse search documents; false = full entities from
  // SQLite. Like `vector`, `sparse: false` is server-only — on the client it
  // routes the query to the server (only the server has the full rows).
  sparse: true,

  // Client-only routing override — see the client's Query routing section.
  // Ignored by the server. 'client' cannot be combined with `vector` or
  // `sparse: false` (both compile-time and runtime errors).
  source: 'auto',
});
```

Returns:

```typescript
{
  count: number;       // Total matching results
  elapsed: { raw: number; formatted: string };
  cursor: string | null; // Next page cursor (base64); null when exhausted
  facets?: FacetResult;  // When facets were requested
  hits: Array<{
    id: string;
    document: Entity | SearchEntity; // full or sparse, per `sparse`
    score: number;
  }>;
}
```

#### The `where` grammar

```typescript
where: {
  // string / string[] fields — exact token match (value or one-of array)
  name: 'alice',
  tags: ['a', 'b'],

  // number fields — comparison operators
  age: { gte: 18, lt: 65 },       // gt / gte / lt / lte / eq / between: [a, b]

  // boolean fields
  published: true,

  // enum fields
  role: { eq: 'admin' },           // eq / in / not_in
  role: 'admin',                   // shorthand — normalized to { eq: 'admin' }
  role: ['admin', 'editor'],       // shorthand — normalized to { in: [...] }

  // enum[] / array fields
  labels: { contains_all: ['a', 'b'] }, // every value present
  labels: { contains_any: ['x', 'y'] }, // at least one present

  // geopoint fields
  location: { radius: { coordinates: { lat, lon }, value: 5, unit: 'km' } },
  location: { polygon: { coordinates: [{ lat, lon }, /* … */] } },

  // composites (nestable up to 10 levels)
  and: [ { role: { eq: 'admin' } }, { or: [ /* … */ ] } ],
  not: { role: { eq: 'guest' } },
}
```

### Raw SQL

```typescript
// String + bindings
db.exec(`SELECT * FROM person WHERE role = ?`, 'admin');

// Tagged template (recommended — prevents SQL injection)
db.exec((sql) => {
	const role = 'admin';
	return sql`SELECT * FROM person WHERE role = ${role}`;
});
```

Returns `Record<string, SqlStorageValue>[]`.

### Transactions

Batch multiple operations atomically. Order is preserved, so later operations can depend on earlier ones:

```typescript
const results = db.transaction([
  { create: { type: 'person', data: { name: 'Alice', ... } } },
  { create: { type: 'post', data: { title: 'Hello', ... } } },
  { update: { type: 'org', id: 'org-1', data: { user_count: 5 } } },
  { delete: { type: 'invite', id: 'inv-1' } },
  { exec: { statement: 'UPDATE stats SET count = count + 1' } },
]);
```

Maximum 5,000 operations per transaction. All operations succeed or all roll back — including the search index writes.

### Sync

Returns per-entity changes for client-side search index mirroring. Ranges, limits, and ceilings are **per entity** — there are no top-level range fields:

```typescript
const changes = db.sync({
	entity: {
		person: { start_updated_at: last_sync, limit: 500 },
		post: { config_version: 3, end_updated_at: cursor, defer_over: 50_000 },
	},
});
// Omit `entity` entirely to sync every table.

// changes.entity.person.created     → new entities (sparse, minus vector fields)
// changes.entity.person.updated     → changed entities (sparse)
// changes.entity.person.deleted     → deleted entity IDs
// changes.entity.person.config      → new search schema (only when the version changed)
// changes.entity.person.total_count → total rows in the table
// changes.entity.person.{start,end,first,last}_updated_at → the covered window
```

Per-entity request fields: `start_updated_at` / `end_updated_at` (half-open window; ascending when `start` is set, descending backfill otherwise), `limit`, `config_version` (optional — when set and stale, the response carries the new `config`), and `defer_over` — a row-count ceiling: when the table's `total_count` exceeds it, the server withholds the page and answers count-only (`deferred: true`, no cursor advance). The client sends this automatically during backfill — see [`max_synced_docs`](#query-routing).

`total_count` reads a counter maintained on `search_state` (bumped on every index/remove), never a `COUNT(*)` — Cloudflare bills Durable Object SQLite per row scanned, so counting a large table on every sync page would cost exactly what the ceiling exists to avoid.

### Metadata

Attach arbitrary metadata to the Durable Object:

```typescript
db.setMeta({ org_id: 'org-123', plan: 'pro' });
const meta = db.getMeta(); // { org_id: 'org-123', plan: 'pro' }
```

### Destructive Operations

```typescript
db.destroy(); // Drop all tables and data
db.restore(timestamp); // Point-in-time recovery (Cloudflare feature)
db.restore(bookmark); // Restore to a specific bookmark
```

## Database Handler (SvelteKit)

`createDatabaseHandle()` intercepts requests to `/api/${entity}` for every table you pass it and performs CRUD with lifecycle hooks — no `+server.ts` files per entity.

### Setup

```typescript
// hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';
import { createDatabaseHandle } from '@delightstack/database/server';
import { tables } from '$lib/schema';

const databaseHandle = createDatabaseHandle({
	getDatabase: (event) => event.locals.db,
	tables,
	hooks: {
		post: {
			beforeCreate: ({ data, event }) => ({
				...data,
				author_id: event.locals.user!.id,
			}),
			beforeUpdate: ({ existing, event }) => {
				if (existing.author_id !== event.locals.user?.id) {
					throw DelightError.forbidden('Not authorized');
				}
			},
		},
	},
	// sync defaults to true — POST /api/sync feeds the client's local index
});

export const handle = sequence(authHandle, appHandle, databaseHandle);
```

Options:

- **`getDatabase(event)`** — returns the `DatabaseServer` stub for the request (return `undefined` when none is available, e.g. no org selected → 500 response).
- **`tables`** — the table map; a CRUD route is generated at `/api/${entity}` for each key.
- **`hooks`** — per-entity lifecycle hooks, keyed by entity name.
- **`requireAuth`** — defaults to **`true`**: create/update/delete (and the sync endpoint) are rejected with a **401** unless `event.locals.session` is set. If you are not using `@delightstack/auth` (or your session lives elsewhere), pass `requireAuth: false` or you will get surprise 401s on every write. Read operations are unaffected — guard them via `beforeGet`/`beforeList`.
- **`sync`** — **defaults to `true`**, exposing `POST /api/sync` (the client's sync, backfill, and local search depend on it). Pass `false` to disable, or `{ path?, beforeSync? }` to customize the path / add per-user authorization. **Security note:** the sync endpoint returns the sparse (searchable) fields of ALL entities — row-level restrictions in `beforeList` hooks do NOT apply to it. `requireAuth` gates it behind a session; for entities with per-user visibility use `beforeSync` or opt them out of syncing with `search_mode: 'server'`.

### Route Mapping

| Method   | Path              | Operation  | DB Call                         |
| -------- | ----------------- | ---------- | ------------------------------- |
| `GET`    | `/api/person`     | **list**   | `db.list('person', query)`      |
| `POST`   | `/api/person`     | **create** | `db.create('person', data)`     |
| `GET`    | `/api/person/:id` | **get**    | `db.get('person', id)`          |
| `PATCH`  | `/api/person/:id` | **update** | `db.update('person', id, data)` |
| `DELETE` | `/api/person/:id` | **delete** | `db.delete('person', id)`       |
| `POST`   | `/api/sync`       | **sync**   | `db.sync(body)`                 |

Any other method returns `405`. URLs that don't match any route pass through to SvelteKit's normal routing via `resolve(event)`.

### Lifecycle Hooks

All hooks receive the SvelteKit `RequestEvent` as `event`. **Before hooks** can throw to reject and can return modified data; **after hooks** are for side effects.

| Hook           | Context Properties                | Notes                                                                        |
| -------------- | --------------------------------- | ---------------------------------------------------------------------------- |
| `beforeCreate` | `data`, `event`                   | `data` is parsed via `table.parse()`. Return an object to override.          |
| `beforeUpdate` | `id`, `data`, `existing`, `event` | `existing` is pre-fetched. `data` is the raw partial. Return to override.    |
| `beforeDelete` | `id`, `existing`, `event`         | `existing` is pre-fetched.                                                   |
| `beforeGet`    | `id`, `event`                     | Lightweight guard — entity is not pre-fetched.                               |
| `beforeList`   | `query`, `event`                  | `query` is decoded from URL params. Return an object to override (the documented row-level-auth pattern: inject a `where` restriction). |
| `afterCreate`  | `data`, `event`                   | `data` is the created entity from the DB.                                    |
| `afterUpdate`  | `data`, `event`                   | `data` is the updated entity from the DB.                                    |
| `afterDelete`  | `id`, `event`                     | Entity has been deleted.                                                     |

Hooks are typed per entity — inside `hooks.post.beforeUpdate`, `existing` is `Database.Entity<typeof postTable>`.

### List Query Parameters

`GET` requests to collection routes decode URL search params via `decodeSearchQuery` — the symmetric counterpart of the client's `encodeSearchQuery`:

| Param                       | Example                            | Description                                    |
| --------------------------- | ---------------------------------- | ---------------------------------------------- |
| `term`                      | `?term=alice`                      | Full-text search term                          |
| `limit` / `offset`          | `?limit=20&offset=40`              | Pagination                                     |
| `cursor`                    | `?cursor=abc123`                   | Keyset pagination token                        |
| `order`                     | `?order=name:ASC\|updated_at:DESC` | `field:direction` pairs (`\|` or `,` separated) |
| `where` / `facets` / `boost` / `vector` | `?where={"role":{"eq":"admin"}}` | JSON-encoded                       |
| `fields`                    | `?fields=name,email`               | Comma-separated, or `*`                        |
| `sparse` / `exact`          | `?sparse=false`                    | Booleans                                       |
| `threshold` / `tolerance`   | `?threshold=0.5`                   | Numbers                                        |
| `distinct_on`               | `?distinct_on=author_id`           | Field name                                     |

Only the canonical spellings are read — `q`, `distinctOn`, `properties`, and other pre-v2 names are ignored.

### Error Handling

All errors are normalized through `DelightError.from()` and returned as JSON: `{ "message": "Not authorized", "status": 403 }`.

## Form Generation

The schema automatically produces form field props and a whole-form validator:

```typescript
const table = Database.table('person', (schema) => ({
	email: schema.string().email().label('Email Address').placeholder('you@example.com'),
	name: schema.string().min(1).max(100).label('Full Name'),
	age: schema.number().int().min(0).max(150).step(1).optional(),
	role: schema.enum([{ value: 'admin', label: 'Administrator' }, { value: 'user', label: 'User' }]),
}));

// table.form.field.email
// { name: 'email', type: 'email', required: true, readonly: false,
//   label: 'Email Address', placeholder: 'you@example.com', parse: (value) => ... }

// table.form.field.role
// { ..., options: [{ value: 'admin', label: 'Administrator' }, { value: 'user', label: 'User' }] }

// table.form.schema — a Standard Schema (v1) validator over all form fields,
// keyed by the same dot-notation names. Pass to a Form component's `schema` prop.
```

Field props include `type` (`text`/`email`/`url`/`date`/`datetime-local`/`time`/`color`/`password`/`tel`/`textarea`/`number`/`boolean`), `minlength`/`maxlength`/`pattern` for strings, `min`/`max`/`step` for numbers, `options` for enums, `multiple` for array items, `tristate`/`default_checked` for booleans, and a per-field `parse(value)` that throws a `DelightError` with a human-readable message. Nested object fields appear under dot-notation names (`address.city`). Labels default to Title Case of the field name.

On the client, `db.entity(...)` carries these helpers as `entity.form`, so a page needs only the entity to build a form.

## Client (Svelte 5)

The client package provides a reactive, type-safe API client for the browser. It uses the same table definitions as the server — single source of truth — and gives you local full-text search over an IndexedDB index, IndexedDB entity caching, optimistic updates, and automatic routing to server-side search whenever the local index does not cover the whole table.

> **Svelte 5 required.** The client uses Svelte 5 runes and is not compatible with other frameworks. The server and schema entry points have no framework dependency.

### How it works

```
┌─ Browser Main Thread ─────────────────────────────────────┐
│                                                           │
│  DatabaseClient                                           │
│  ├─ get(type, id) → EntityHandle       (reactive read)    │
│  ├─ entity(type, id?) → EntityState    (reactive editing) │
│  ├─ list(type, query) → ListHandle     (reactive list)    │
│  └─ create/update/delete/applyLocalPatch/uploadImage      │
│           │                                               │
│           │ comlink proxy                                 │
│           ▼                                               │
│  SharedWorker (prod) / Worker (dev)                       │
│  ┌────────────────────────────────────────────────────┐   │
│  │  DatabaseWorker                                    │   │
│  │  ├─ IndexedDB search index (postings, per entity)  │   │
│  │  ├─ IndexedDB cache (entities + sync metadata)     │   │
│  │  ├─ CRUD → fetch + index update                    │   │
│  │  └─ sync() → /api/sync → update indices + IDB      │   │
│  └────────────────────────────────────────────────────┘   │
│                         │                                 │
└─────────────────────────┼─────────────────────────────────┘
                          │ fetch
                          ▼
              ┌─────────────────────┐
              │  Server (SvelteKit) │
              │  /api/{entity}      │
              │  /api/{entity}/:id  │
              │  /api/sync          │
              └─────────────────────┘
```

All heavy work (indexing, IndexedDB reads/writes, fetch calls) runs in a Web Worker. In production, a SharedWorker is used so multiple tabs share a single writer. In dev mode, a regular Worker is used for HMR compatibility.

### Setup

```typescript
// +layout.ts (or a shared helper)
import { DatabaseClient } from '@delightstack/database/client';
import { tables } from '$lib/schema';

export const load = async ({ fetch }) => {
	const db = new DatabaseClient({
		// Same table definitions used on the server
		tables,

		// IndexedDB database name — scope per org/context
		db_name: `org-${org_id}`,

		// SvelteKit's fetch — used on SSR / pre-init so server-side calls carry
		// the request's cookies, and so SSR responses replay during hydration
		fetch,

		// Per-entity overrides (all optional)
		entities: {
			comment: { search_mode: 'server' }, // never search or sync locally
			person: { search_mode: 'client' }, // search locally even mid-backfill
			post: { cache: false }, // disable IDB cache for this entity
		},

		// Dev mode uses a regular Worker instead of a SharedWorker
		dev: import.meta.env.DEV,

		// Hooks for external integration — @delightstack/websocket supplies all
		// three (onEntityChange, onSubscribe, isLive) via ws.databaseHooks()
		hooks: ws.databaseHooks(),
	});

	await db.init(); // no-op on the server; SSR reads fall back to `fetch`
	return { db };
};
```

### Reading: three reactive handles

Rule of thumb: **reading → `get`, editing → `entity`, lists/search → `list`.** All three share the same cache and invalidation, so any mutation through the client refreshes every reader of the same data.

| Use                              | API                                     | Handle        |
| -------------------------------- | --------------------------------------- | ------------- |
| Display a single entity          | `db.get(type, id)`                      | `EntityHandle` |
| Edit a single entity (forms)     | `db.entity(type, id?)`                  | `EntityState` |
| Lists, search, live results      | `db.list(type, query?)`                 | `ListHandle`  |

Each handle works two ways: **reactive** (read its properties in a template or `$derived` — the first read starts a live subscription that tears down when nothing reads it anymore) and **awaited** (`await handle.load()` for a one-shot result, which also works on SSR).

### `db.get` — EntityHandle

Cached per `type:id`, so every call site shares one instance.

```svelte
<script lang="ts">
	import { page } from '$app/state';
	const { data } = $props();
	const { db } = $derived(data);

	const person = $derived(db.get('person', page.params.person_id));
</script>

{#if person.status === 'loading'}
	<p>Loading…</p>
{:else if person.value}
	<h1>{person.value.name}</h1>
{/if}
```

| Property / Method | Type                                  | Description                                                       |
| ----------------- | ------------------------------------- | ----------------------------------------------------------------- |
| `value`           | `Database.Entity<T> \| undefined`     | Live entity data; `undefined` until loaded / when not found. Replaced (never mutated) on updates. |
| `status`          | `HandleStatus`                        | `'loading' \| 'refreshing' \| 'ready' \| 'error'`                 |
| `error`           | `unknown`                             | Last fetch error; cleared on the next successful load             |
| `load(options?)`  | `Promise<Entity \| undefined>`        | Awaited form. Reactive when called inside `$derived`/`$effect` — `$derived(await db.get(type, id).load())` re-runs on changes. `{ force_refresh: true }` bypasses the IDB cache. |
| `refresh()`       | `Promise<Entity \| undefined>`        | Force a re-fetch, bypassing the IDB cache                         |

**SSR:** call `.load()` in a `+page.ts` load. With the SvelteKit `fetch` passed to the client config, the SSR response is serialized into the page payload and replayed during hydration — one request total:

```typescript
// +page.ts
export const load: PageLoad = async ({ params, parent }) => {
	const { db } = await parent();
	const post = await db.get('post', params.post_id).load();
	return { post };
};
```

Mutations through `db.create/update/delete`, websocket pushes (via `hooks.onSubscribe`), and background refreshes all re-run reactive readers of the same `type:id` automatically.

### `db.entity` — EntityState (editing)

The edit-form wrapper: a draft `value` you can bind to, the last confirmed `server_value`, dirty tracking, and save/reset/delete. Cached per `type:id` on the client.

```svelte
<script lang="ts">
	const person = $derived(db.entity('person', person_id));
</script>

<input bind:value={person.value.name} />

{#if person.has_changes}
	<button onclick={() => person.save()}>Save</button>
	<button onclick={() => person.reset()}>Discard</button>
{/if}
{#if person.saving}<p>Saving…</p>{/if}
```

**Reactive properties:**

| Property       | Type                            | Description                                       |
| -------------- | ------------------------------- | ------------------------------------------------- |
| `value`        | `Database.Entity<T>`            | Current local state (editable, bind-friendly)     |
| `server_value` | `Database.Entity<T> \| null`    | Last confirmed server state                       |
| `has_changes`  | `boolean`                       | Whether local differs from server                 |
| `saving`       | `boolean`                       | Whether a save is in progress                     |
| `loading`      | `boolean`                       | Whether entity is being fetched                   |
| `loaded`       | `boolean`                       | Whether entity has been fetched at least once     |
| `status`       | `HandleStatus`                  | Combined lifecycle state                          |
| `error`        | `unknown`                       | Last error from load/save/delete                  |
| `id`           | `string \| number \| undefined` | Entity ID (set after first save for new entities) |
| `form`         | `T['form']`                     | The table's form helpers (`form.field.*` spreadable props, `form.schema`) |
| `created_at` / `updated_at` | `number \| undefined` | Auto-managed timestamps (epoch ms)              |

**Methods:**

| Method                             | Description                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `save(changes?)`                   | Save to server. Creates if no ID, updates otherwise. Concurrent saves are queued, never dropped.            |
| `load({ force_refresh? })`         | Fetch fresh from server; resolves with the entity. Called automatically on first reactive access.           |
| `delete()`                         | Delete from server. Clears local state and removes from cache.                                              |
| `reset()`                          | Discard local changes, revert to `server_value`.                                                            |
| `toJSON()`                         | Clean snapshot of the current value.                                                                        |

**SSR pattern — preload in `+page.ts`, read in the component.** The instance is cached on the client, so awaiting `.load()` in the load function populates the same wrapper the component reads later:

```typescript
// +page.ts
export const load: PageLoad = async ({ params, parent }) => {
	const { db } = await parent();
	const person = db.entity('person', params.person_id);
	await person.load();
	if (!person.loaded) error(404, 'Person not found');
	return {};
};
```

```svelte
<!-- +page.svelte -->
<script lang="ts">
	import { page } from '$app/state';
	const person = $derived(db.entity('person', page.params.person_id));
</script>
```

Server-side, the load uses the `fetch` passed to `DatabaseClient` (carrying auth cookies); on hydration the load re-runs but reuses the SSR'd response via SvelteKit's fetch cache. After hydration, `load()` reads through the worker's IDB cache instead — zero network for client-side navigation (the flip is automatic).

**New-entity pattern:** omit the id — `db.entity('person')` gives a blank draft whose `save()` creates on the server and attaches the returned id. Pass `initial_data` as the third argument to seed the draft (with an id, it's treated as authoritative server state and skips the load).

### `db.list` — ListHandle

The one list API: a live search that re-runs whenever the underlying index changes, and a one-shot query via `.load()`.

```svelte
<script lang="ts">
	const posts = db.list('post', { limit: 50 });
</script>

<Input bind:value={posts.query.term} placeholder="Search posts…" />

{#if posts.status === 'loading'}
	<p>Searching…</p>
{:else}
	<p>{posts.count} results ({posts.mode} mode)</p>
	{#each posts.items as post (post.id)}
		<p>{post.title}</p>
	{/each}
	{#if posts.has_more}
		<button onclick={() => posts.loadMore()}>Load more</button>
	{/if}
{/if}
```

**Reactive properties:**

| Property      | Type                         | Description                                                |
| ------------- | ---------------------------- | ---------------------------------------------------------- |
| `hits`        | `SearchHit<T>[]`             | Hits with `id`, `document` (sparse), and `score`           |
| `items`       | `Database.SearchEntity<T>[]` | Convenience — just the sparse documents, in hit order      |
| `count`       | `number`                     | Total matching count                                       |
| `has_more`    | `boolean`                    | Whether rows exist beyond the current window               |
| `status`      | `HandleStatus`               | `'loading'` (nothing yet) · `'refreshing'` (re-query in flight, previous results stay visible) · `'ready'` · `'error'` |
| `error`       | `unknown`                    | Set while `status === 'error'`; last-known-good results stay visible |
| `mode`        | `'client' \| 'server'`       | Which side answered the current results                    |
| `query`       | `Database.SearchQuery<T>`    | The live query — mutate fields (`posts.query.term = 'x'`) or bind to them; re-queries automatically (debounced) |

**Methods:**

| Method           | Description                                                                    |
| ---------------- | ------------------------------------------------------------------------------ |
| `load()`         | Run the current query once and resolve with a `SearchResult` (`hits`, `items`, `count`, `mode`). Never starts a subscription; works on SSR via the configured `fetch`. |
| `loadMore(n?)`   | Grow the result window by `n` rows (default 100). The live subscription keeps the whole window updated — paging is a growing window, not detached pages. |
| `refresh()`      | Manually re-execute the query.                                                 |
| `destroy()`      | Force teardown. Normally not needed — auto-cleans when the last reader stops.  |

Query defaults: `term: ''`, `limit: 100`, `order: [{ field: 'updated_at', direction: 'DESC' }]` — the recency order is dropped automatically for relevance queries (a `term` or `vector`) so score ranking wins. The query accepts every field from the [search DSL](#search--list), plus the client-only `source`.

Two forms of the query argument:

```typescript
// Static object — handles for identical queries are cached and shared
const posts = db.list('post', { term: 'hello', limit: 20 });

// Function form — reactive: re-derives the query from other reactive state.
// One handle per call site (never shared).
const results = $derived(db.list('place', () => ({ term, limit: 20 })));
```

> **Sparse results.** Search documents only contain fields declared `searchable` (typed `Database.SearchEntity<T>`, not `Database.Entity<T>`), and synced documents never include vector fields. When you need the full entity, use `db.get(type, hit.id)` — or query with `sparse: false`, which routes to the server automatically (only the server has the full rows; combining it with `source: 'client'` is an error, same as `vector`).

### Writes

```typescript
// Create / update / delete — optimistically update the local index + IDB cache,
// then persist via the auto-generated /api routes
const person = await db.create('person', { name: 'Alice', email: 'a@b.com' });
const updated = await db.update('person', person.id, { name: 'Alice B.' });
await db.delete('person', person.id);

// Patch the LOCAL search index only — no server write. Use when the
// authoritative write goes through a custom endpoint whose websocket echo
// replaces this overlay. Returns false when the entity runs in server mode.
await db.applyLocalPatch('post', post_id, { title: 'Draft title' });

// Upload an image (POST multipart to /api/image; pairs with @delightstack/images)
const record = await db.uploadImage(file, {
	caption: 'Sunset',
	onProgress: (fraction) => console.log(`${Math.round(fraction * 100)}%`),
});
```

All writes bump the entity's reactive version, so every `get`/`entity`/`list` reader of the same data updates automatically.

### Lifecycle

```typescript
await db.init(); // load IDB, connect worker, start background sync (SSR no-op)
await db.setScope(`org-${new_org_id}`); // switch scope — clears caches, re-inits
await db.signOut(); // wipe ALL local data (IDB cache + search index) — see below
await db.destroy(); // disconnect from the worker, clear subscriptions
```

**Sign-out.** `db.signOut()` deletes the scope's entire IndexedDB database —
cached entities, sync cursors, and the local search index — so nothing
searchable remains on disk after the user signs out (shared computers). It is
flash-free by design: the client freezes first (no handle updates, no
subscriber notifications, currently displayed data stays put), then wipes, so
you can `await db.signOut()` and navigate without any list visibly emptying.
Peer tabs are wiped silently over the same channel. After sign-out the client
is inert (`db.status` is `'signed_out'`); a fresh `init()` on the next sign-in
brings it back.

**Reactive state on DatabaseClient:**

| Property  | Type             | Description                                                                                           |
| --------- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| `status`  | `DatabaseStatus` | Lifecycle: `'idle'` (SSR / before `init()`) → `'initializing'` → `'ready'` → `'signed_out'`           |
| `syncing` | `boolean`        | Whether the initial background sync is in progress (the client is already usable while it runs)       |
| `synced`  | `boolean`        | Whether the initial sync has completed (local search answers from a fully mirrored index)             |

### Query routing

Where a query (`db.list`) is answered is decided **per query**, in this order:

1. **Any query carrying `vector`** (including hybrid) goes to the server. Embeddings never reach the client — `source: 'client'` combined with `vector` is rejected, at compile time and at runtime.
2. **A per-query `source` wins.** `source: 'server'` forces the server; `source: 'client'` forces the local index even mid-backfill (a partial-corpus answer by choice). The default, `'auto'`, falls through to the next rule.
3. **Otherwise, coverage decides.** Entities are indexed into IndexedDB as they sync. Once an entity type's synced window covers the whole table, its queries are answered locally — instant and offline-capable. Until the backfill completes, they go to the server, which has the full corpus and therefore the correct relevance statistics.

Every result reports which side answered via `mode`. Identical results are guaranteed only when the two corpora match — client and server run the same engine core, so a fully-synced local index gives byte-identical results.

Per-entity defaults:

```typescript
entities: {
  comment: { search_mode: 'server' },  // never search or sync locally
  person: { search_mode: 'client' },   // search locally even mid-backfill
}
```

`source: 'client'` on a `search_mode: 'server'` entity is an error — that entity never syncs, so no local index exists to answer from.

**Huge tables: the sync ceiling.** A table can be too large to be worth mirroring at all. `max_synced_docs` (default **50 000**, global or per-entity, `false` disables) caps the backfill: when the server reports more rows than the ceiling, the backfill is deferred — sync sends cheap count-only probes instead of downloading pages — and the entity's queries answer from the server, exactly as if the window were still filling. The decision is re-probed on every sync run, so raising the ceiling or the table shrinking resumes the backfill automatically. A table that already finished backfilling keeps syncing incrementally however large it grows: the ceiling prevents the big download, it never evicts a finished index. Entities explicitly forced `search_mode: 'client'` ignore the default and global ceilings; only their own `max_synced_docs` caps them.

```typescript
const db = new DatabaseClient({
	tables,
	db_name,
	fetch,
	max_synced_docs: 20_000, // global ceiling (default 50 000)
	entities: {
		note: { max_synced_docs: false }, // worth mirroring at any size
		person: { search_mode: 'client', max_synced_docs: 100_000 },
	},
});
```

### Error handling

Errors from the worker are reconstructed as `DelightError` instances on the main thread:

```typescript
import { DelightError } from '@delightstack/utilities';

try {
	await db.create('person', data);
} catch (error) {
	if (DelightError.is(error)) {
		console.log(error.status); // HTTP status code
		console.log(error.message); // Error message
		console.log(error.detail); // Technical detail (if any)
	}
}
```

### Without SvelteKit

The client package requires **Svelte 5** for its reactive state. It does not depend on SvelteKit specifically — any Svelte 5 app with a bundler supporting Web Workers works; the SvelteKit-specific parts (`fetch` replay, load-function SSR) simply don't apply.

The server-side code works without Svelte entirely:

- **Schema definitions** (`Database.table()`) are framework-agnostic TypeScript.
- **`DatabaseServer`** is a Cloudflare Durable Object class — use it with Hono, itty-router, plain Workers, anything on Cloudflare.
- **`createDatabaseHandle()`** is SvelteKit-specific (it returns a SvelteKit `Handle`). For other frameworks, call `DatabaseServer` methods directly from your route handlers, and serve a `POST /api/sync` endpoint yourself if you want client sync.

## Design Decisions

**Why a hand-written search engine (not SQLite FTS5, not a library)?**
FTS5 cannot run in the browser, so a client and a server query would rank differently — and the whole point is that a caller can choose either per query. An in-memory library (this package used Orama through 1.1) has no incremental persistence: the entire index has to be serialized after writes, which grew to 10+ seconds per save on a production corpus, and it has to be held in the Durable Object's memory. The engine here shares one pure core (tokenizer, BM25, filter/sort semantics) between a SQLite postings backend on the server and an IndexedDB one on the client, so the same query over the same documents gives byte-identical results, index writes are O(changed document), and cold start costs nothing.

**Why a `json` catch-all column?**
SQLite doesn't support nested objects or arrays natively. Rather than flattening deeply nested schemas into dozens of columns, non-scalar fields are serialized into a single `json` TEXT column. Root-level scalars still get their own columns for indexing and WHERE clauses.

**Why synchronous CRUD?**
Cloudflare Durable Object SQLite operations are synchronous by design. This simplifies the API — no `await` needed for `create()`, `get()`, `update()`, `delete()`.

**Why in-house validation instead of zod?**
The schema builder already knows every constraint — compiling them into a second schema library added a dependency, a parallel type surface, and subtle mismatches (zod silently dropped a `.min()` when a format replaced the base schema). The in-house `FieldValidator` reads constraints live off the field definition, throws consistent `DelightError`s, and costs zero dependencies. `.check(fn)` covers everything a `refine` used to.

**Why cursor-based pagination on the server, a growing window on the client?**
Offset pagination degrades on large tables. The server hands out keyset cursors with constant cost at any depth. The client's live lists instead grow their window (`loadMore()`), because a live subscription keeping N detached pages consistent is much harder than keeping one window consistent.

## Exports

### `@delightstack/database` (main — schema + types only)

The root entry never drags server code into a client or worker bundle: the SvelteKit handler lives in `/server`, the DO class value in `/worker`.

| Export                                        | Description                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `Database`                                    | Namespace: `table()`, `Entity<T>`, `SearchEntity<T>`, `SearchQuery<T>`, `Table`, … |
| `DatabaseServer` *(type only)*                | The DO class **type** — the value must be imported from `/worker`           |
| `DatabaseStub` *(type)*                       | Typed async RPC projection of `DatabaseServer` — cast a DO stub to it once (see [Typed stubs](#typed-stubs-databasestub)) |
| `DatabaseBroadcast`, `DatabaseClientHooks`, `DatabaseEntityChange` *(types)* | The database ↔ websocket contract — `@delightstack/websocket` implements these |
| `encodeSearchQuery`, `decodeSearchQuery`      | Symmetric query ⇄ URLSearchParams codec                                     |
| `normalizeWhere`                              | Normalizes where-clause shorthands into operator objects                    |
| `SearchQueryInput`, `ValidSearchQuery`        | Loose (non-generic) query type + the vector/source compile-time guard       |
| `FieldValidator`, `FieldGenerator` *(type)*   | The in-house validator class and the field builder type                     |
| Search core types *(types)*                   | `SearchQuery`, `SearchQueryResults`, `WhereCondition`, `FacetDefinition`, `FacetResult`, `SearchHit`, `SearchableType`, `GeoPoint`, … |

### `@delightstack/database/server`

| Export                                        | Description                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `createDatabaseHandle`                        | SvelteKit Handle factory for auto-generated CRUD + sync routes              |
| `DatabaseHandleOptions`, `DatabaseRouteHooks` | Types for the handler config and per-entity hooks                           |
| `prepareSql`, `SqlTaggedTemplate`, `SqlPreparedQuery`, `SqlQueryFn` | Safe SQL tagged-template API — canonical home is `@delightstack/utilities`; re-exported here for compatibility |
| `DatabaseServer`, `DatabaseStub`, sync/transaction types *(types)* | Same type-only exports as the root entry             |

### `@delightstack/database/worker`

| Export           | Description                                                                    |
| ---------------- | ------------------------------------------------------------------------------ |
| `DatabaseServer` | The Durable Object class (value). Imports `cloudflare:workers` — only import this from your Worker entry point. |

### `@delightstack/database/client` (Svelte 5 only)

| Export                 | Description                                                            |
| ---------------------- | ---------------------------------------------------------------------- |
| `DatabaseClient`       | Main client class — handles, CRUD, sync, routing, lifecycle            |
| `EntityHandle`         | Reactive single-entity read handle (returned by `db.get`)              |
| `EntityState`          | Reactive per-entity edit wrapper (returned by `db.entity`)             |
| `ListHandle`           | Reactive list/search handle (returned by `db.list`)                    |
| `DatabaseClientConfig` | Type for the `DatabaseClient` constructor config                       |
| `SearchHit`            | Type for a single search result hit                                    |
| `SearchResult`         | Type for a one-shot `.load()` result (`hits`, `items`, `count`, `mode`) |
| `ListQueryInit`        | Type for the `db.list` query argument (object or reactive function)    |
| `HandleStatus`         | `'loading' \| 'refreshing' \| 'ready' \| 'error'`                      |
| `SearchQueryInput`, `ValidSearchQuery`, `encodeSearchQuery`, `decodeSearchQuery` | Query codec re-exports         |
| `WorkerSearchResult`   | Type for raw search results from the worker                            |

### `@delightstack/database/schema`

| Export           | Description                                                     |
| ---------------- | --------------------------------------------------------------- |
| `Database`       | The schema namespace (same as the main entry's)                 |
| `FieldValidator` | The in-house per-field validator                                |
| `FieldGenerator` | *(type)* The field builder type                                 |
