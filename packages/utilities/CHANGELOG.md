# @delightstack/utilities

## 1.2.0

### Minor Changes

- a3e0a38: Add `generateSortKey(before, after)` for fractional indexing, and a `length` option to
  `generateTimestampID()`.

  `generateSortKey` returns a plain string that sorts strictly between its two neighbors under
  ordinary string comparison, so an ordered list can be reordered by writing one row instead of
  renumbering every row after it. `generateSortKey()` gives the first key, `generateSortKey(key)`
  appends, `generateSortKey(null, key)` prepends, and `generateSortKey(a, b)` inserts between. Keys
  are a base62 integer part with a self-delimiting magnitude marker plus an optional base62 fraction,
  so appends and prepends stay short (10,000 of either stay at 4 characters) and only repeated
  insertion at the same position grows them. Invalid or out-of-order input throws a `DelightError`.

  `generateTimestampID({ length })` shortens or lengthens the ID (default 20, unchanged). The first 8
  characters remain the base62 timestamp so IDs of different lengths still sort chronologically
  against each other; the remainder is random. A length below 10, or a non-integer, throws a
  `DelightError`.

## 1.1.0

### Minor Changes

- d86752e: v2 simplification: one reactive handle API, zod removed, and a much smaller surface.

  **Client — three reactive handles replace five overlapping read APIs.** `db.get(type, id)` returns a cached reactive `EntityHandle` (`.value`, `.status`, `await .load()`), `db.entity(type, id)` stays the editing wrapper (now with `.load()` returning the entity and a `status` getter), and `db.list(type, query)` returns a reactive `ListHandle` — the merger of the old `db.list` and `db.watch` — with live `results`/`docs`/`count`/`has_more`/`mode`, a live `query`, `loadMore()`, and one-shot `await .load()` that also works on SSR. Removed: `db.watch` (`DatabaseWatch`), `db.read` (`EntityReader`), `EntityState.from`, `markHydrated`, the worker RPCs `getSearchMode`/`isSynced` (every result now carries `mode: 'client' | 'server'` — the live routing decision, per result), and `SearchResult.elapsed`. `WatchStatus` is renamed `HandleStatus`. The old `$derived(await db.get(id))` pattern becomes `db.get(id).value` or `$derived(await db.get(id).load())`.

  **Schema — zod is gone.** Validation is in-house and dependency-free; `parse()` behavior is unchanged except failures now throw `DelightError` (status 400, `issues` attached) and format checks compose with `min`/`max` (zod silently dropped a `min` when a format replaced the base schema). The zod-passthrough builder methods (`endsWith`, `transform`, `refine`, `gte`/`lte`, `prefault`, `multipleOf`, …) are deleted — `.check(fn)` is the custom-validation escape hatch and `.step(n)` sets the form step. `table()` now takes 2 generic parameters instead of 12, `Database.Table` is the one table type (`Database.AnyTable` remains as a deprecated alias), and `config.table_definition` is a plain `Record<string, string>`.

  **Server.** `createDatabaseHandle` supports only the `tables` + `hooks` mode (`tables` is required); `defineRoute` and the `routes` array are removed, and the sync endpoint is POST-only. `DatabaseSyncRequest` drops the top-level `start_updated_at`/`end_updated_at`/`limit` — ranges and limits are per-entity in the `entity` map (still one request for any number of entity types; `config_version` is now optional). The batch array overload of `DatabaseServer.get()` is removed, as are the never-read `event.user_id` fields on transaction operations. `SqlServer` moved into `@delightstack/auth` (it was auth-private in practice); `@delightstack/database` keeps `prepareSql`/`SqlTaggedTemplate`.

  **Websocket.** `EntityChangedMessage.user_id` is removed and `entityChanged` is now `(action, entity_type, id, data?, sparse?)` — the `user_id` slot was never populated.

  Internals: the search subsystem's three engines now share `core/pipeline.ts`/`core/dictionary.ts`/`core/schema_fields.ts` (golden vectors unchanged — behavior is frozen), and roughly 5,600 net lines were deleted across the packages.

  **DX round (same release).**

  - **Root entry is schema + types only.** `@delightstack/database` no longer re-exports `/server` — import `createDatabaseHandle` from `@delightstack/database/server`. The unused `./schema` export is removed. A schema-only import can no longer drag the SvelteKit handler into a worker/client bundle.
  - **`prepareSql`/`SqlTaggedTemplate`/`SqlPreparedQuery`/`SqlQueryFn` moved to `@delightstack/utilities`** (re-exported from `@delightstack/database/server` for compatibility). `@delightstack/auth` now depends only on utilities — not on the database package.
  - New **`DatabaseStub<Config>`** type: the async RPC projection of `DatabaseServer`, so a Durable Object stub can be cast once at the boundary (`event.locals.db`) and stay fully typed everywhere — no more hand-written `unknown`-typed RPC interfaces in `app.d.ts`.
  - New **alarm registry**: `DatabaseServer.registerAlarm(name, fn)` + a base `alarm()` that runs every registered handler with per-handler error isolation. `imageProcessing()` and `aiProcessing()` self-register, so subclasses no longer hand-write an `alarm()` fan-out. New `DatabaseServer.instanceName(ctx)` (static) and `this.instance_name` recover the `idFromName()` key without casting `ctx.id`.
  - **Typed database ↔ websocket contract.** `DatabaseBroadcast`, `DatabaseClientHooks`, and `DatabaseEntityChange` are exported from the database root; `WebsocketServer` `implements DatabaseBroadcast` and `WebsocketClient.databaseHooks()` returns `Required<DatabaseClientHooks>` (websocket gains a type-only dependency on database; `EntityChangeEvent` is now an alias of `DatabaseEntityChange`). Drift between the packages is now a compile error.
  - **`foreignKey` accepts the referenced table object** (`table: organizationTable`) as well as its name string — a typo'd reference becomes a compile error.
  - `@delightstack/ai`: the `ws` option is now the minimal `AiBroadcastChannel` (`broadcast()` only), satisfied by a `WebsocketServer` DO stub directly — no more `as unknown as WebsocketServer` at the call site. The AI tables also stop declaring `created_at`/`updated_at` (auto-managed epoch-ms numbers in v2; the old datetime-string declarations threw at table-definition time).

  **Follow-up round (same release).** `ListHandle.results`/`docs` renamed to `hits`/`items` (`SearchResult.docs` → `items`; hit objects keep `{ id, score, document }`). `createDatabaseHandle`'s `sync` option now defaults to `true`. `and`/`or`/`not`/`$derived` are reserved field names (compile-time + runtime errors — they collide with the where-clause grammar and the internal derived-values store). `sparse: false` routes client queries to the server automatically, and `source: 'client'` combined with it is an error like `vector`. Validation gained a coercion stage shared by `parse()` and the form standard schema (previously the form path was strict where `table.parse` was liberal): `Date` → epoch ms for `number()` fields (including `created_at`/`updated_at`) or ISO text for `.date()`/`.time()`/`.datetime()` fields, `URL` → `.href` for `.url()` fields, whole numeric strings → numbers, `'true'`/`'on'`/`'false'`-style tokens → booleans, typed arrays → plain `vector()` arrays, and `{ latitude, longitude }` → `{ lat, lon }` geopoints — ambiguous conversions (JSON strings, ISO text into plain number fields) are deliberately not attempted, and unformatted string fields still reject `Date`s. Several builder methods returned as in-house implementations: `startsWith`/`endsWith`/`includes`, the transforms `trim`/`toLowerCase`/`toUpperCase`/`normalize` (run before validators, in declaration order), and exclusive bounds `gt`/`lt`; `.step(n)` now validates divisibility (decimal-safe) in addition to setting the form step attribute. New `db.signOut()` wipes all locally persisted data (IndexedDB entity cache, sync cursors, and search index) with freeze-then-wipe semantics — no UI repaints between the call and the app's navigation — `init()` after sign-out restores a working client. `DatabaseClient`'s lifecycle booleans are consolidated into **`db.status`** (`'idle' | 'initializing' | 'ready' | 'signed_out'`) — `initialized`, `hydrated`, and `signed_out` are removed (`hydrated` is now internal); the `syncing`/`synced` booleans remain.

## 1.0.1

### Patch Changes

- 0c92f48: Type-level fixes so consumer apps typecheck cleanly: the database schema's `Table` constraint no longer degenerates into an impossible `table_definition` union when a field generator's shape is `any`, and `StringFieldInputType` now matches the runtime (`tel` / `datetime-local` instead of `phone` / `datetime`); stripe's `PlanDefinition.entitlements` accepts `readonly string[]`; the images and ai request handles and utilities' `createDevHandle` are now generic over the event so they compose with SvelteKit's `Handle` without casts; the editor package no longer emits an `Editor` component export shadowed by the `Editor` class type (which made the component import type-only for consumers).

## 1.0.0

### Major Changes

- 8420739: First stable release (1.0.0). The DelightStack packages now version together at a coordinated, stable 1.0. This bump declares the public API of each package stable; individual packages may not have changed since their previous release.
