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
- **Two server classes** — `DatabaseServer` for schema-driven CRUD with search, `SqlServer` for raw SQL when you need full control.

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

| Method     | Signature                         | Notes                                                                             |
| ---------- | --------------------------------- | --------------------------------------------------------------------------------- |
| **create** | `create(type, data) → Entity`     | Auto-generates ID and timestamps. Validates with Zod. Updates search index.       |
| **get**    | `get(type, id, expand?) → Entity` | Throws `{ status: 404 }` if not found. `expand` populates foreign key references. |
| **update** | `update(type, id, data) → Entity` | Deep partial merge. Validates merged result. Updates search index.                |
| **delete** | `delete(type, id) → void`         | Removes from SQLite and search index. Tracks deletion for sync.                   |

All CRUD methods are **synchronous** (SQLite in Durable Objects is synchronous).

`create()` strips `id`, `created_at`, and `updated_at` from input data — these are auto-managed.

`update()` auto-sets `updated_at` to the current time.

### Search & List

```typescript
db.list('user', {
  // Full-text search
  term: 'alice',

  // Vector search
  vector: { value: [0.1, 0.2, ...], property: 'embeddings' },
  mode: 'vector',  // 'fulltext' | 'vector' | 'hybrid'

  // Filters (Orama WHERE syntax)
  where: {
    role: 'admin',                    // Exact match
    age: { gte: 18, lt: 65 },        // Range
    tags: { containsAll: ['a', 'b'] } // Array contains
  },

  // Sorting
  order: [
    { key: 'created_at', direction: 'DESC' },
  ],

  // Pagination
  limit: 20,
  cursor: previousResult.cursor,  // Cursor-based pagination

  // Response shape
  sparse: false,  // true = only searchable fields, false = full entities from SQLite
  properties: ['id', 'name', 'email'],  // Subset of fields to return
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

## Project Structure

```
packages/database/
  index.ts                    # Package entry — re-exports everything
  schema/
    schema.ts                 # Schema definition system (field types, validators, form generation)
  server/
    index.ts                  # Server entry — re-exports server classes
    db.server.ts              # DatabaseServer class (CRUD, search, sync, transactions)
    db.server.test.ts         # Tests for DatabaseServer
    sql.server.ts             # SqlServer class (raw SQL wrapper)
    sql.helper.ts             # SQL query builder utilities and types
```
