# @delightstack/database

Type-safe database layer for Cloudflare Durable Objects with built-in full-text search, schema validation, and automatic migrations.

## Features

- **Declarative schema** — Define tables with a fluent TypeScript API. Field types, constraints, and validators are inferred at compile time.
- **Full-text & vector search** — Built-in [Orama](https://orama.com) integration. Mark fields as `.searchable()` and query them with fuzzy text, vector embeddings, or hybrid search.
- **Automatic migrations** — New columns are added automatically when you update your schema. No migration files to manage.
- **Zod validation** — Every `create()` and `update()` call validates data against the schema at runtime. String formats (`.email()`, `.url()`, `.datetime()`), number ranges (`.min()`, `.max()`), and custom constraints are enforced.
- **Transactions** — Batch multiple create/update/delete/exec operations into a single atomic transaction.
- **Incremental sync** — `sync()` returns only the changes since a given timestamp, enabling efficient client-side search index mirroring.
- **Form generation** — Schema definitions automatically produce HTML form field attributes (type, required, min, max, pattern, placeholder, label).
- **Declarative API routes** — Define entity routes with lifecycle hooks instead of writing repetitive CRUD boilerplate. Plug into SvelteKit's `handle` via `createDatabaseHandle()`.
- **Two server classes** — `DatabaseServer` for schema-driven CRUD with search, `SqlServer` for raw SQL when you need full control.
- **Reactive client (Svelte 5)** — `DatabaseClient` gives you reactive entity state, live search, IndexedDB caching, and optimistic updates — all running off-thread in a SharedWorker.

## Architecture

```
  ┌─────────────────────────────────────────────────────┐
  │               Cloudflare Durable Object             │
  │                                                     │
  │  ┌────────────┐   ┌──────────┐   ┌───────────────┐  │
  │  │   Schema   │──>│  SQLite  │   │  Orama Index  │  │
  │  │ Definition │   │ (storage)│   │  (in-memory)  │  │
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

**Schema → SQLite + Orama:** Each table definition produces both a SQLite table (for persistent storage) and an Orama in-memory index (for search). The `DatabaseServer` keeps them in sync automatically.

**Single-writer model:** Durable Objects guarantee a single instance handles all writes, eliminating race conditions. SQLite transactions provide atomicity within that instance.

**JSON catch-all column:** Root-level scalar fields (string, number, boolean, enum, foreign key) get their own SQLite columns. Nested types (object, array) are serialized into a single `json` TEXT column and transparently deserialized on read.

## Quickstart

### 1. Define your schema

```typescript
import { Database } from '@delightstack/database';

const usersTable = Database.table('user', (schema) => ({
	id: schema.primaryKey(),
	email: schema.string().email().unique().searchable(),
	name: schema.string().min(1).max(100).searchable(),
	role: schema.enum(['admin', 'user', 'guest']).searchable(),
	bio: schema.string().optional(),
	avatar_url: schema.string().url().optional(),
	created_at: schema.string().datetime(),
	updated_at: schema.string().datetime(),
}));

const postsTable = Database.table('post', (schema) => ({
	id: schema.primaryKey(),
	title: schema.string().searchable(),
	body: schema.string().searchable(),
	author_id: schema.foreignKey({
		type: 'string',
		table: 'user',
		column: 'id',
		on_delete: 'CASCADE',
	}),
	tags: schema.array(schema.string()).searchable().optional(),
	published: schema.boolean().default(false),
	created_at: schema.string().datetime(),
	updated_at: schema.string().datetime(),
}));
```

### 2. Create your Durable Object

```typescript
import { DatabaseServer } from '@delightstack/database';

const tables = { user: usersTable, post: postsTable };

export class MyDatabase extends DatabaseServer<typeof tables> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(tables, () => env.WEBSOCKET, ctx, env);
	}
}
```

On first instantiation, `DatabaseServer` automatically creates the SQLite tables, indexes, and search indexes. On subsequent runs, it detects schema changes and adds new columns. It does not automatically delete old tables.

### 3. Use the API

```typescript
// Create
const user = db.create('user', {
	email: 'alice@example.com',
	name: 'Alice',
	role: 'admin',
});
// user.id is auto-generated, created_at/updated_at are set automatically

// Read
const alice = db.get('user', user.id);

// Read with foreign key expansion
const post = db.get('post', postId, ['author_id']);
// post.expanded.author_id → full user record

// Update (deep partial merge)
db.update('user', user.id, { name: 'Alice B.' });

// Delete
db.delete('user', user.id);

// Search
const results = db.list('user', {
	term: 'alice',
	where: { role: 'admin' },
	limit: 20,
});

// Raw SQL
const rows = db.exec(`SELECT * FROM user WHERE role = ?`, 'admin');

// Tagged template (prevents SQL injection)
const rows = db.exec((sql) => {
	const role = 'admin';
	return sql`SELECT * FROM user WHERE role = ${role}`;
});
```

## Schema Reference

### Field Types

| Type            | Constructor                     | SQLite Column         | Notes                                                                          |
| --------------- | ------------------------------- | --------------------- | ------------------------------------------------------------------------------ |
| **Primary Key** | `schema.primaryKey()`           | `TEXT PRIMARY KEY`    | Auto-generated string ID. Use `{ type: 'number' }` for auto-increment integer. |
| **String**      | `schema.string()`               | `TEXT`                | Supports format validators, length constraints, regex patterns.                |
| **Number**      | `schema.number()`               | `NUMERIC`             | Use `.int()` for `INTEGER`. Supports min/max, positive/negative.               |
| **Boolean**     | `schema.boolean()`              | `BOOLEAN`             | Stored as 0/1 in SQLite.                                                       |
| **Enum**        | `schema.enum(['a', 'b'])`       | `TEXT`                | Constrained to the provided values.                                            |
| **Foreign Key** | `schema.foreignKey({...})`      | `TEXT REFERENCES ...` | Typed reference to another table with cascade options.                         |
| **Object**      | `schema.object({...})`          | `TEXT` (JSON)         | Nested fields. Stored as JSON string.                                          |
| **Array**       | `schema.array(schema.string())` | `TEXT` (JSON)         | Typed array. Stored as JSON string.                                            |
| **Geopoint**    | `schema.geopoint()`             | `TEXT` (JSON)         | `{ lat, lon }`. Always searchable for geospatial queries.                      |
| **Vector**      | `schema.vector(768)`            | `TEXT` (JSON)         | Fixed-dimension embedding. Always searchable for vector search.                |

### Modifiers

All field types support a subset of these modifiers:

```typescript
schema
	.string()
	.optional() // Nullable (stored as NULL)
	.readonly() // Immutable after creation
	.default('foo') // Default value (or a function: () => value)
	.searchable() // Indexed in Orama for full-text search
	.sortable() // Sortable in search results (implies searchable)
	.indexable() // SQLite B-tree index for fast WHERE queries
	.unique() // UNIQUE constraint in SQLite
	.label('Name') // UI label for form generation
	.placeholder('Enter name'); // UI placeholder
```

### String Formats

Mutually exclusive — pick one:

```typescript
schema.string().email(); // RFC email
schema.string().url(); // Valid URL
schema.string().uuid(); // UUID v4/v5
schema.string().datetime(); // ISO 8601 datetime
schema.string().date(); // YYYY-MM-DD
schema.string().time(); // HH:MM[:SS]
schema.string().ipv4(); // IPv4 address
schema.string().ipv6(); // IPv6 address
schema.string().base64(); // Base64 string
schema.string().color(); // Hex color (#RGB or #RRGGBB)
schema.string().password(); // Masked input (UI hint)
schema.string().phone(); // Phone number (UI hint)
```

### String Validators

```typescript
schema
	.string()
	.min(1) // Minimum length
	.max(255) // Maximum length
	.length(10) // Exact length
	.regex(/^[A-Z]+$/) // Regex pattern
	.includes('foo') // Must contain substring
	.startsWith('http') // Must start with prefix
	.endsWith('.com') // Must end with suffix
	.trim() // Trim whitespace
	.lowercase() // Convert to lowercase
	.uppercase() // Convert to uppercase
	.nonempty() // Must not be empty
	.textarea(); // Renders as textarea in forms
```

### Number Validators

```typescript
schema
	.number()
	.int() // Must be integer (INTEGER column)
	.positive() // > 0
	.negative() // < 0
	.nonnegative() // >= 0
	.min(0) // >= value
	.max(100) // <= value
	.gt(0) // > value (exclusive)
	.lt(100) // < value (exclusive)
	.multipleOf(5) // Must be divisible by value
	.step(0.01) // Step size for input controls
	.safe() // Within safe integer range
	.finite(); // Must be finite
```

### Foreign Keys

```typescript
schema.foreignKey({
	type: 'string', // Type of the referenced column
	table: 'user', // Referenced table name
	column: 'id', // Referenced column name
	on_delete: 'CASCADE', // CASCADE | SET NULL | RESTRICT | NO ACTION | SET DEFAULT
	on_update: 'CASCADE', // Same options
});
```

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
const usersTable = Database.table('user', (schema) => ({
	id: schema.primaryKey(),
	name: schema.string(),
	age: schema.number().int().optional(),
	role: schema.enum(['admin', 'user'] as const),
}));

// Infer the entity type
type User = Database.Entity<typeof usersTable>;
// {
//   readonly id: string;
//   name: string;
//   age?: number | null;
//   role: 'admin' | 'user';
// }
```

Optional fields become `T | undefined | null`. Readonly fields (like `id`) get the `readonly` modifier. Enum values are narrowed to their literal union type.

## DatabaseServer API

### Constructor

```typescript
class DatabaseServer<Config, Meta> extends DurableObject {
	constructor(
		config: Config, // Record of table definitions
		ws: () => WebSocketDO, // Lazy WebSocket DO for broadcasting
		ctx: DurableObjectState, // Durable Object context
		env: Env, // Environment bindings
	);
}
```

### CRUD

| Method     | Signature                         | Notes                                                                                |
| ---------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| **create** | `create(type, data) → Entity`     | Auto-generates ID and timestamps. Validates with Zod. Updates search index.          |
| **get**    | `get(type, id, expand?) → Entity` | Throws `DelightError` (404) if not found. `expand` populates foreign key references. |
| **update** | `update(type, id, data) → Entity` | Deep partial merge. Validates merged result. Updates search index.                   |
| **delete** | `delete(type, id) → void`         | Removes from SQLite and search index. Tracks deletion for sync.                      |

All CRUD methods are **synchronous** (SQLite in Durable Objects is synchronous).

`create()` strips `id`, `created_at`, and `updated_at` from input data — these are auto-managed.

`update()` auto-sets `updated_at` to the current time.

### Search & List

```typescript
db.list('user', {
  // Full-text search
  term: 'alice',

  // Vector search — the search mode is derived: `vector` alone runs a vector
  // search, `term` + `vector` runs a hybrid search, `term` alone runs full text
  // `similarity` is the inclusive minimum cosine similarity (default 0.8)
  vector: { value: [0.1, 0.2, ...], field: 'embeddings', similarity: 0.8 },

  // Filters
  where: {
    role: 'admin',                     // Exact match
    age: { gte: 18, lt: 65 },          // Range
    tags: { contains_all: ['a', 'b'] }, // Array contains every value
    labels: { contains_any: ['x', 'y'] } // Array contains at least one value
  },

  // Sorting
  order: [
    { field: 'created_at', direction: 'DESC' },
  ],

  // Pagination
  limit: 20,
  cursor: previousResult.cursor,  // Cursor-based pagination

  // Response shape
  sparse: false,  // true = only searchable fields, false = full entities from SQLite
  fields: ['name', 'email'],  // Which searchable fields the term matches against
});
```

Returns:

```typescript
{
  count: number;       // Total matching results
  elapsed: number;     // Search time in ms
  cursor?: string;     // Next page cursor (base64)
  hits: Array<{
    document: Entity;  // Full or sparse entity
    score: number;     // Relevance score
  }>;
}
```

### Raw SQL

```typescript
// String + bindings
db.exec(`SELECT * FROM user WHERE role = ?`, 'admin');

// Tagged template (recommended — prevents SQL injection)
db.exec((sql) => {
	const role = 'admin';
	return sql`SELECT * FROM user WHERE role = ${role}`;
});
```

Returns `Record<string, SqlStorageValue>[]`.

### Transactions

Batch multiple operations atomically:

```typescript
const results = db.transaction([
  { create: { type: 'user', data: { name: 'Alice', ... } } },
  { create: { type: 'post', data: { title: 'Hello', ... } } },
  { update: { type: 'org', id: 'org-1', data: { user_count: 5 } } },
  { delete: { type: 'invite', id: 'inv-1' } },
  { exec: { statement: 'UPDATE stats SET count = count + 1' } },
]);
```

Maximum 5,000 operations per transaction. All operations succeed or all roll back.

### Sync

Returns changes since a given timestamp for client-side search index mirroring:

```typescript
const changes = db.sync({
	start_updated_at: lastSyncTimestamp,
	entity: {
		user: { config_version: 1 },
		post: { config_version: 1 },
	},
});

// changes.entity.user.created  → new entities (sparse)
// changes.entity.user.updated  → changed entities (sparse)
// changes.entity.user.deleted  → deleted entity IDs
// changes.entity.user.config   → new Orama schema (if version changed)
```

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
db.restore(bookmark); // Restore to specific bookmark
```

## SqlServer API

A lower-level SQL wrapper for when you need direct control without schema validation or search indexing. Used by the `@delightstack/auth` package.

```typescript
import { SqlServer } from '@delightstack/database';

const sql = new SqlServer<MySchema>(ctx.storage);

// Insert
sql.insert('user', 'user-123', { name: 'Alice', email: 'a@b.com' });
sql.insert('user', null, { ... }); // null ID → auto-increment

// Update
sql.update('user', 'user-123', { name: 'Alice B.' });

// Delete
sql.delete('user', 'user-123');

// Get one
const user = sql.get('user', 'user-123');

// List with WHERE
sql.list('user', {
  where: {
    and: [
      { key: 'role', is: '=', value: 'admin' },
      { or: [
        { key: 'age', is: '>', value: 18 },
        { key: 'status', is: 'IN', value: ['active', 'pending'] },
      ]},
    ],
  },
  order: { key: 'created_at', direction: 'DESC' },
  limit: 50,
});

// Raw SQL
sql.exec('SELECT COUNT(*) as count FROM user');
```

### When to use which

| Use case                      | Class            |
| ----------------------------- | ---------------- |
| Standard CRUD with validation | `DatabaseServer` |
| Full-text or vector search    | `DatabaseServer` |
| Schema-driven forms           | `DatabaseServer` |
| Client-side sync              | `DatabaseServer` |
| Raw SQL queries               | `SqlServer`      |
| Custom auth flows             | `SqlServer`      |
| Complex joins or aggregations | `SqlServer`      |

## Database Handler (SvelteKit)

The database handler eliminates repetitive CRUD boilerplate by letting you define entity routes declaratively with lifecycle hooks. Instead of writing `+server.ts` files for every entity, define a route and its auth guards in one place.

### Setup

```typescript
// hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';
import { createDatabaseHandle, defineRoute } from '@delightstack/database';
import { personTable, postTable } from './tables';

const personRoute = defineRoute({
	entity: 'person', // route defaults to '/api/person'
	table: personTable,
	hooks: {
		beforeCreate: ({ event }) => {
			if (!event.locals.user) throw DelightError.unauthorized('Authentication required');
		},
		beforeUpdate: ({ existing, event }) => {
			if (existing.creator_id !== event.locals.user?.id) {
				throw DelightError.forbidden('Not authorized');
			}
		},
		beforeDelete: ({ existing, event }) => {
			if (existing.creator_id !== event.locals.user?.id) {
				throw DelightError.forbidden('Not authorized');
			}
		},
	},
});

const postRoute = defineRoute({
	entity: 'post', // route defaults to '/api/post'
	table: postTable,
});

const databaseHandle = createDatabaseHandle({
	getDatabase: (event) => event.locals.db,
	routes: [personRoute, postRoute],
});

export const handle = sequence(authHandle, appHandle, databaseHandle);
```

This replaces all the `+server.ts` files you would otherwise need for `/api/person`, `/api/person/[id]`, `/api/post`, and `/api/post/[id]`.

### Route Mapping

For each registered route (e.g. `/api/person`), the handler maps HTTP methods to CRUD operations:

| Method   | Path              | Operation  | DB Call                         |
| -------- | ----------------- | ---------- | ------------------------------- |
| `GET`    | `/api/person`     | **list**   | `db.list('person', query)`      |
| `POST`   | `/api/person`     | **create** | `db.create('person', data)`     |
| `GET`    | `/api/person/:id` | **get**    | `db.get('person', id)`          |
| `PATCH`  | `/api/person/:id` | **update** | `db.update('person', id, data)` |
| `DELETE` | `/api/person/:id` | **delete** | `db.delete('person', id)`       |

Any other method returns `405 Method Not Allowed`. URLs that don't match any route are passed through to SvelteKit's normal routing via `resolve(event)`.

### Lifecycle Hooks

All hooks receive an `event` property (the SvelteKit `RequestEvent`), giving you access to `event.locals`, `event.url`, `event.params`, etc.

**Before hooks** — throw to reject the operation. Optionally return modified data.

| Hook           | Context Properties                | Notes                                                                                              |
| -------------- | --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `beforeCreate` | `data`, `event`                   | `data` is parsed via `table.parse()`. Return an object to override.                                |
| `beforeUpdate` | `id`, `data`, `existing`, `event` | `existing` is pre-fetched from DB. `data` is the raw partial update. Return an object to override. |
| `beforeDelete` | `id`, `existing`, `event`         | `existing` is pre-fetched from DB.                                                                 |
| `beforeGet`    | `id`, `event`                     | Lightweight guard — entity is not pre-fetched.                                                     |
| `beforeList`   | `query`, `event`                  | `query` is decoded from URL search params. Return an object to override.                           |

**After hooks** — for side effects (logging, notifications, cache invalidation).

| Hook          | Context Properties | Notes                                     |
| ------------- | ------------------ | ----------------------------------------- |
| `afterCreate` | `data`, `event`    | `data` is the created entity from the DB. |
| `afterUpdate` | `data`, `event`    | `data` is the updated entity from the DB. |
| `afterDelete` | `id`, `event`      | Entity has been deleted.                  |

### Type Safety

`defineRoute()` is generic — the table type flows into all hook contexts:

```typescript
const personRoute = defineRoute({
	entity: 'person',
	table: personTable,
	hooks: {
		beforeUpdate: ({ existing, data, event }) => {
			// 'existing' is typed as Database.Entity<typeof personTable>
			// TypeScript knows about existing.creator_id, existing.name, etc.
			console.log(existing.name);
		},
	},
});
```

### List Query Parameters

`GET` requests to collection routes decode URL search params into a search query:

| Param    | Example                           | Description                                              |
| -------- | --------------------------------- | -------------------------------------------------------- |
| `limit`  | `?limit=20`                       | Max results to return                                    |
| `offset` | `?offset=40`                      | Skip N results                                           |
| `cursor` | `?cursor=abc123`                  | Cursor-based pagination token                            |
| `term`   | `?term=alice`                     | Full-text search term                                    |
| `order`  | `?order=name:ASC,created_at:DESC` | Comma-separated `field:direction` pairs                  |
| `where`  | `?where={"role":"admin"}`         | JSON-encoded Orama WHERE clause                          |
| `sparse` | `?sparse=false`                   | `false` for full entities, `true` for search fields only |

### Modifying Data in Hooks

Before hooks can optionally return modified data. If void is returned, the original data is used:

```typescript
beforeCreate: ({ data, event }) => {
  // Inject creator_id from the session
  return { ...data, creator_id: event.locals.user.id };
},

beforeList: ({ query, event }) => {
  // Restrict results to the current user's data
  return { ...query, where: { creator_id: event.locals.user.id } };
},
```

### Error Handling

All errors are normalized through `DelightError.from()` and returned as JSON responses:

```json
{ "message": "Not authorized", "status": 403 }
```

If `getDatabase()` returns `undefined` (e.g. no org selected), the handler returns a 500 error.

See the [Error Handling](#error-handling-1) section below for the full `DelightError` API.

## Form Generation

The schema automatically produces form field attributes:

```typescript
const table = Database.table('user', (schema) => ({
	id: schema.primaryKey(),
	email: schema.string().email().label('Email Address').placeholder('you@example.com'),
	name: schema.string().min(1).max(100).label('Full Name'),
	age: schema.number().int().min(0).max(150).optional(),
	role: schema.enum(['admin', 'user', 'guest']).label('Role'),
}));

// table.form.field.email
// {
//   name: 'email',
//   type: 'email',
//   required: true,
//   label: 'Email Address',
//   placeholder: 'you@example.com',
// }

// table.form.field.role
// {
//   name: 'role',
//   type: 'text',
//   required: true,
//   label: 'Role',
//   options: ['admin', 'user', 'guest'],
// }
```

Spread these directly onto HTML input elements or use them to drive form component libraries.

## Client (Svelte 5)

The client package provides a reactive, type-safe API client for the browser. It uses the same table definitions as the server — single source of truth — and gives you local search via Orama, IndexedDB caching, optimistic updates, and automatic fallback to server-side search when entity counts exceed a threshold.

> **Svelte 5 required.** The client uses Svelte 5 runes (`$state`, `$derived`, `$effect`) and is not compatible with other frameworks. The server and schema packages have no framework dependency.

### How it works

```
┌─ Browser Main Thread ─────────────────────────────────────┐
│                                                           │
│  DatabaseClient                                           │
│  ├─ entity(type, id) → EntityState     (reactive wrapper) │
│  ├─ create/update/delete(type, ...)    (optimistic CRUD)  │
│  ├─ search(type, query) → DatabaseSearch (live results)   │
│  └─ list(type, query) → Promise        (one-shot fetch)   │
│           │                                               │
│           │ comlink proxy                                 │
│           ▼                                               │
│  SharedWorker (prod) / Worker (dev)                       │
│  ┌────────────────────────────────────────────────────┐   │
│  │  DatabaseWorker                                    │   │
│  │  ├─ Orama search indices (per entity, in-memory)   │   │
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

All heavy work (Orama indexing, IndexedDB reads/writes, fetch calls) runs in a Web Worker. In production, a SharedWorker is used so multiple tabs share a single index. In dev mode, a regular Worker is used for HMR compatibility.

### Setup

```typescript
import { DatabaseClient } from '@delightstack/database/client';
import { personTable, postTable, commentTable } from './tables';

const db = new DatabaseClient({
	// Same table definitions used on the server
	tables: { person: personTable, post: postTable, comment: commentTable },

	// IndexedDB database name — scope per org/context
	db_name: `org-${org_id}`,

	// Per-entity overrides (all optional)
	entities: {
		comment: { search_mode: 'server' }, // never try client-side search
		person: { threshold: 10_000 }, // custom threshold (default 5000)
		post: { cache: false }, // disable IDB cache for this entity
	},

	// Dev mode uses regular Worker instead of SharedWorker
	dev: import.meta.env.DEV,

	// Hooks for external integration (e.g. websocket)
	hooks: {
		onEntityChange: (event) => {
			/* { type, entity_type, id, data } */
		},
		onSubscribe: (callback) => {
			return websocket.on('entity:*', callback);
		},
	},
});

await db.init();
```

### CRUD

All CRUD methods are type-safe — the entity type flows through from your table definitions.

```typescript
// Create
const person = await db.create('person', { name: 'Alice', email: 'a@b.com' });

// Get (returns from IDB cache with background refresh)
const alice = await db.get('person', person.id);

// Update (optimistically updates local search index)
const updated = await db.update('person', person.id, { name: 'Alice B.' });

// Delete (optimistically removes from local search index)
await db.delete('person', person.id);
```

`db.get` is also **reactive when called inside `$derived` / `$effect`**. After a mutation through `db.update` / `db.delete` / `db.create` — or a push via the `onSubscribe` hook — any reactive expression that read the same `type:id` re-runs automatically:

```svelte
<script lang="ts">
	import { page } from '$app/state';

	let person = $derived(await db.get('person', page.params.person_id));

	async function rename(next: string) {
		await db.update('person', page.params.person_id, { name: next });
		// `person` re-evaluates — no invalidate() call needed.
	}
</script>
```

For richer reactive patterns see [Reactive reads](#reactive-reads) below.

### Reactive reads

Pick the primitive that matches what the page needs. All three share the same underlying cache + invalidation, so mutations through the client refresh every reader that touched the same entity.

| Use                                  | API                                      | Returns                    |
| ------------------------------------ | ---------------------------------------- | -------------------------- |
| One-shot fetch (load functions, SSR) | `db.get(type, id)`                       | `Promise<Entity>`          |
| Read-mostly page                     | `db.read(type, id)` → `EntityReader`     | sync reactive handle       |
| Edit form / dirty-tracked state      | `db.entity(type, id)` → `EntityState`    | sync reactive handle       |

- **`db.get`** — call it in a SvelteKit `load`, or inside `$derived(await …)` when you like the async-derived style. Reactive to mutations when read from a reactive context.
- **`db.read`** — construct once, read `value`/`loading`/`error` in templates. Good for detail pages that just display data. Re-fetches automatically when the id changes or a mutation lands.
- **`db.entity`** — use when the user will edit the value. Adds `has_changes`, `saving`, `reset()`, `save()` on top of what `db.read` offers.

### EntityReader (`db.read`)

Lightweight reactive wrapper for a single entity. Synchronous to construct; the first reactive read starts the underlying subscription, which tears down automatically when no one is reading anymore.

```svelte
<script>
	import { page } from '$app/state';

	// Pass a function for the id so it tracks `page.params` reactively.
	const person = db.read('person', () => page.params.person_id);
</script>

{#if person.loading && !person.value}
	Loading…
{:else if person.error}
	<Alert>{person.error.message}</Alert>
{:else if person.value}
	<h1>{person.value.name}</h1>
{/if}
```

**Reactive properties:**

| Property      | Type                      | Description                                                                        |
| ------------- | ------------------------- | ---------------------------------------------------------------------------------- |
| `value`       | `Database.Entity<T> \| undefined` | Current entity data; `undefined` before first load or if not found         |
| `loading`     | `boolean`                 | `true` during the first fetch or whenever the id changes                           |
| `loaded`      | `boolean`                 | `true` once the first fetch has resolved (even with no record)                     |
| `error`       | `unknown`                 | Last fetch error, cleared on next successful load                                  |
| `id`          | `string \| number \| undefined` | Currently tracked id (resolved from the id source)                           |
| `entity_type` | `string` (literal)        | The entity type string                                                             |

**Methods:**

| Method      | Description                                                                    |
| ----------- | ------------------------------------------------------------------------------ |
| `reload()`  | Force a refetch, bypassing the IDB cache.                                      |
| `destroy()` | Force cleanup. Normally not needed — auto-cleans on last reader disconnect.    |

### EntityState (reactive wrapper)

`EntityState` wraps a single entity with reactive state. It auto-loads from the server when first accessed in a Svelte component, tracks unsaved changes, and provides save/delete/reset methods.

```typescript
// Get a reactive wrapper (cached singleton per entity:id)
const person = db.entity('person', 'abc123');

// For creating a new entity (no ID) — save() will create on the server
const person = db.entity('person');
```

**SSR hydration — preload in `+page.ts`, read in the component.** `db.entity(type, id)` is cached on the `DatabaseClient` instance, so awaiting `.load()` inside the load function populates the same wrapper the component reads later. There's nothing to pass through `data`:

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
  const { data } = $props();
  const { db } = $derived(data);
  const person = $derived(db.entity('person', page.params.person_id));
</script>

<input bind:value={person.value.name} />
<button onclick={() => person.save()} disabled={!person.has_changes}>Save</button>
```

**How `load()` picks its read path.** The client carries a `hydrated` flag that decides between two paths inside `EntityState.load()`:

- **Pre-hydration (SSR + initial hydration / full refresh):** fetches on the main thread using the `fetch` you passed to `DatabaseClient`. On the server this is SvelteKit's scoped fetch, which records the response so the client's hydration re-run finds it in the fetch cache — one network request covers both renders. After the response lands on the client, it's pushed into the worker's IDB + Orama index via `applyExternalChange`, so subsequent navigations can read it back from cache.
- **Post-hydration (client-side navigation):** delegates to `worker.get`, which serves from the IDB cache (live-updated by websockets and by applied local mutations) — zero network for nav-heavy flows. `force_refresh: true` still bypasses IDB and hits the server.

The flag flips automatically — `init()` schedules a short macrotask (50ms) that fires after the browser finishes its initial hydration work but long before the user can interact with the page, so no wiring is required in your layouts. If you ever need to switch paths manually (for example, if a sub-route should always read from IDB right away), call `db.markHydrated()` — it cancels the pending timer and flips immediately.

**Worker-side safety-net refresh.** `worker.get` has a fallback: if the cached entry's `updated_at` is older than ~30s, it returns the cached value immediately but spawns a background fetch to freshen IDB. That's the right behavior when no push channel is in play — but for apps wired to a websocket it's redundant, because `applyExternalChange` is already keeping IDB current in real time. Wire `hooks.isLive` to your websocket client's live-state signal (`@delightstack/websocket`'s `ws.databaseHooks()` supplies it for you) and the worker will skip the refresh whenever the feed is trusted:

- currently connected → `isLive` is `true` → skip the refresh, IDB is authoritative.
- just disconnected (< 60s ago) → still `true` → brief blips don't trigger a thundering herd of refetches.
- offline longer, or never connected → `false` → the worker's stale-refresh kicks back in so apps without a push channel still converge.

If the hook isn't provided, the worker keeps the refresh-if-stale behavior (unchanged pre-1.0 default).

If you already have the entity data in hand — for example from a different load that returned the full record — you can still seed directly: `db.entity('person', id, fullPerson)` treats `initial_data` as the authoritative server state and skips the load entirely.

Use it in Svelte components — reactive properties update the UI automatically:

```svelte
<script>
	const person = db.entity('person', id);
</script>

{#if person.loading}
	<p>Loading...</p>
{:else}
	<input bind:value={person.value.name} />

	{#if person.has_changes}
		<button onclick={() => person.save()}>Save</button>
		<button onclick={() => person.reset()}>Discard</button>
	{/if}

	{#if person.saving}
		<p>Saving...</p>
	{/if}
{/if}
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
| `error`        | `unknown`                       | Last error from load/save/delete, cleared on next success |
| `id`           | `string \| number \| undefined` | Entity ID (set after first save for new entities) |
| `entity_type`  | `string` (literal)              | The entity type string                            |
| `created_at`   | `number \| undefined`           | Creation timestamp                                |
| `updated_at`   | `number \| undefined`           | Last update timestamp                             |

**Methods:**

| Method                             | Description                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `save(changes?)`                   | Save to server. Creates if no ID, updates otherwise. Pass partial changes or omit to save the full `value`. |
| `load({ force_refresh?, fetch? })` | Fetch fresh from server. Called automatically on first access.                                              |
| `delete()`                         | Delete from server. Clears local state and removes from cache.                                              |
| `reset()`                          | Discard local changes, revert to `server_value`.                                                            |
| `toJSON()`                         | Clean snapshot of the current value.                                                                        |

**Standalone usage (without DatabaseClient):**

```typescript
import { EntityState } from '@delightstack/database/client';

const person = new EntityState('person', id, {
  worker, // optional; falls back to `fetch` on SSR / pre-init
  fetch,
  primary_key: 'id',
});
```

Caching and version invalidation live on `DatabaseClient` — `new EntityState(...)` gives you a single unmanaged wrapper. Prefer `db.entity(...)` unless you have a specific reason to manage lifecycle yourself.

### DatabaseSearch (reactive search)

`DatabaseSearch` provides live search results that auto-update when the underlying Orama index changes (e.g. after a create/update/delete). When the entity count exceeds the threshold, it automatically switches to server-side search.

> **Sparse results.** Search documents only contain fields declared `searchable` in your Orama schema (typed as `Database.SearchEntity<T>`, *not* `Database.Entity<T>`). Both client and server search default to sparse — Orama client-side only has the sparse fields, and the server path defaults to `sparse: true` for efficient sync payloads. When you need the full entity, call `db.get('type', hit.id)` or `db.read('type', () => hit.id)` — those always return the full `Database.Entity<T>`.

```typescript
const search = db.search('person', { term: 'alice', limit: 20 });
```

```svelte
<script>
	const search = db.search('person', { term: '', limit: 20 });
</script>

<input bind:value={search.query.term} />

{#if search.loading}
	<p>Searching...</p>
{:else}
	<p>{search.count} results ({search.mode} mode)</p>
	{#each search.docs as person}
		<p>{person.name}</p>
	{/each}
{/if}
```

**Reactive properties:**

| Property      | Type                         | Description                                             |
| ------------- | ---------------------------- | ------------------------------------------------------- |
| `results`     | `SearchHit<T>[]`             | Array of hits with `id`, `document` (sparse), and `score` |
| `docs`        | `Database.SearchEntity<T>[]` | Convenience — just the sparse documents                 |
| `count`       | `number`                     | Total matching count                                    |
| `loading`     | `boolean`                    | Whether search is in progress                           |
| `error`       | `unknown`                    | Any error from the search                               |
| `mode`        | `'client' \| 'server'`       | Current search mode                                     |
| `query`       | `WorkerSearchQuery`          | Get/set the search query. Setting triggers a re-search. |
| `entity_type` | `string` (literal)           | The entity type string                                  |

**Methods:**

| Method      | Description                                         |
| ----------- | --------------------------------------------------- |
| `refresh()` | Manually re-execute the search.                     |
| `destroy()` | Clean up subscriptions and effects. Call when done. |

### One-shot list

For simple server queries that don't need live updates:

```typescript
const results = await db.list('person', { term: 'alice', limit: 20 });
// results.hits, results.count
```

### Lifecycle

```typescript
// Change scope (e.g. user switches org) — clears cache, re-initializes
await db.setScope(`org-${new_org_id}`);

// Cleanup — terminates worker, clears subscriptions
await db.destroy();
```

**Reactive state on DatabaseClient:**

| Property      | Type      | Description                             |
| ------------- | --------- | --------------------------------------- |
| `initialized` | `boolean` | Whether `init()` has completed          |
| `syncing`     | `boolean` | Whether the initial sync is in progress |
| `synced`      | `boolean` | Whether the initial sync has completed  |

### Search modes

Each entity type operates in one of two search modes:

- **`client`** (default) — Entities are synced to an in-memory Orama index in the worker. Searches are instant and offline-capable. When the cumulative entity count during sync exceeds the threshold (default 5000), the entity automatically switches to server mode.
- **`server`** — Searches hit the server API. No local index is maintained. Use this for large or infrequently-searched entity types.

You can force the mode per entity in the config:

```typescript
entities: {
  comment: { search_mode: 'server' },  // always server
  person: { threshold: 10_000 },        // switch at 10k instead of 5k
}
```

### Error handling

CRUD errors from the worker are reconstructed as `DelightError` instances on the main thread:

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

The client package requires **Svelte 5** for its reactive state (`$state`, `$derived`, `$effect`). It does not depend on SvelteKit specifically — you can use it in any Svelte 5 app that has a bundler supporting Web Workers (Vite, webpack, etc.).

The server-side code _does_ work without Svelte or SvelteKit:

- **Schema definitions** (`Database.table()`) are framework-agnostic. Use them in any TypeScript project.
- **DatabaseServer** and **SqlServer** are Cloudflare Durable Object classes. They work with any framework that deploys to Cloudflare Workers (Hono, itty-router, plain Workers, etc.).
- **`createDatabaseHandle()`** is SvelteKit-specific (it returns a SvelteKit `Handle`). For other frameworks, call `DatabaseServer` methods directly from your route handlers.

If you're using a non-Svelte frontend, you can still use the server package and call the REST API endpoints directly — the client package just provides convenience wrappers for the reactive patterns that Svelte enables.

## Design Decisions

**Why SQLite + Orama (not just SQLite)?**
SQLite is great for structured queries but lacks fuzzy full-text search, vector search, and faceting. Orama runs in-memory and provides sub-millisecond search with typo tolerance. The two complement each other: SQLite for persistence and complex queries, Orama for search UX.

**Why a `json` catch-all column?**
SQLite doesn't support nested objects or arrays natively. Rather than flattening deeply nested schemas into dozens of columns, object/array fields are serialized into a single `json` TEXT column. Root-level scalars still get their own columns for indexing and WHERE clauses.

**Why synchronous CRUD?**
Cloudflare Durable Object SQLite operations are synchronous by design. This simplifies the API — no `await` needed for `create()`, `get()`, `update()`, `delete()`.

**Why Zod for validation?**
Zod provides both runtime validation and TypeScript type inference from a single schema definition. The schema system compiles field definitions into Zod schemas automatically, so `create()` and `update()` validate data without manual validator code.

**Why cursor-based pagination?**
Offset-based pagination (`OFFSET 100 LIMIT 10`) degrades on large tables because the database must scan and discard rows. Cursor-based pagination uses WHERE clauses to skip directly to the next page, maintaining constant performance regardless of page depth.

## Exports

### `@delightstack/database` (server + schema)

| Export                            | Description                                                         |
| --------------------------------- | ------------------------------------------------------------------- |
| `Database`                        | Namespace containing `table()`, `Entity<T>`, and search query types |
| `DatabaseServer`                  | Main Durable Object class for schema-driven CRUD + search           |
| `SqlServer`                       | Lower-level SQL wrapper for direct database access                  |
| `prepareSql`                      | Tagged template helper for safe SQL query construction              |
| `DatabaseServerTransaction`       | Type for transaction operation arrays                               |
| `DatabaseServerTransactionResult` | Type for transaction results                                        |
| `DatabaseSyncRequest`             | Type for sync query parameters                                      |
| `DatabaseSyncResponse`            | Type for sync response data                                         |
| `SqlEntityQuery`                  | Type for SqlServer query parameters                                 |
| `SqlEntityQueryWhereClause`       | Type for SqlServer WHERE clause                                     |
| `createDatabaseHandle`            | SvelteKit Handle factory for declarative CRUD routes                |
| `defineRoute`                     | Type-safe route definition helper for `createDatabaseHandle`        |
| `DatabaseRouteConfig`             | Type for a configured entity route                                  |
| `DatabaseRouteHooks`              | Type for lifecycle hooks on an entity route                         |

### `@delightstack/database/client` (Svelte 5 only)

| Export                 | Description                                                            |
| ---------------------- | ---------------------------------------------------------------------- |
| `DatabaseClient`       | Main client class — CRUD, search, entity state, sync, lifecycle        |
| `EntityReader`         | Lightweight reactive single-entity reader (for `db.read`)              |
| `EntityState`          | Reactive per-entity wrapper with auto-load, save, and change tracking  |
| `DatabaseSearch`       | Reactive search with live results from Orama or server fallback        |
| ~~`DatabaseError`~~    | **Removed.** Use `DelightError` from `@delightstack/utilities` instead |
| `DatabaseClientConfig` | Type for `DatabaseClient` constructor config                           |
| `SearchHit`            | Type for a single search result hit                                    |
| `SearchResult`         | Type for a search result set                                           |
| `WorkerSearchQuery`    | Type for search query parameters                                       |
| `WorkerSearchResult`   | Type for search results from the worker                                |

## Project Structure

```
packages/database/
  index.ts                    # Package entry — re-exports server + schema
  schema/
    schema.ts                 # Schema definition system (field types, validators, form generation)
  server/
    index.ts                  # Server entry — re-exports server classes
    database.handler.ts       # SvelteKit Handle for declarative CRUD routes with hooks
    db.server.ts              # DatabaseServer class (CRUD, search, sync, transactions)
    db.server.test.ts         # Tests for DatabaseServer
    sql.server.ts             # SqlServer class (raw SQL wrapper)
    sql.helper.ts             # SQL query builder utilities and types
  client/
    index.ts                  # Client entry — re-exports client classes (Svelte 5)
    database.client.svelte.ts # DatabaseClient, EntityState, DatabaseSearch
    database.worker.ts        # Web Worker — Orama indices, IDB cache, fetch, sync
    database.worker.init.ts   # SharedWorker/Worker singleton factory
    database.idb.ts           # IndexedDB helper utilities
    database.error.ts         # DatabaseError for comlink worker-to-main transfer
```
