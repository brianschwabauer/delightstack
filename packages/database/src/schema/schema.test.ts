import { describe, it, expect, assertType } from 'vitest';
import { Database } from './schema';

// ── Type-level tests ─────────────────────────────────────────────────────────
// These verify that Database.Entity<> produces the correct TypeScript type

const PERSON = Database.table('person', (schema) => ({ name: schema.string() }));
type Person = Database.Entity<typeof PERSON>;

// Auto-id: 'id' should be present when no primary key is defined
assertType<Person>(
	{} as {
		readonly id: string;
		name: string;
		readonly created_at: number;
		readonly updated_at: number;
	},
);

const POST = Database.table('post', (schema) => ({
	slug: schema.primaryKey(),
	title: schema.string(),
}));
type Post = Database.Entity<typeof POST>;

// Explicit PK: 'slug' should be present, no extra 'id'
assertType<Post>(
	{} as {
		readonly slug: string;
		title: string;
		readonly created_at: number;
		readonly updated_at: number;
	},
);

// Derived fields should NOT appear in Entity type
const PERSON_WITH_DERIVED = Database.table('person_derived', (schema) => ({
	first_name: schema.string().searchable(),
	last_name: schema.string().searchable(),
	name: schema
		.string()
		.derived((data) => `${data.first_name} ${data.last_name}`)
		.sortable(),
}));
type PersonWithDerived = Database.Entity<typeof PERSON_WITH_DERIVED>;

// Entity should have first_name, last_name, auto-id, timestamps — but NOT name
assertType<PersonWithDerived>(
	{} as {
		readonly id: string;
		first_name: string;
		last_name: string;
		readonly created_at: number;
		readonly updated_at: number;
	},
);

describe('Schema: Database.table()', () => {
	it('should create a table with basic fields', () => {
		const table = Database.table('posts', (schema) => ({
			id: schema.primaryKey(),
			title: schema.string(),
			body: schema.string().textarea(),
			views: schema.number().int(),
			published: schema.boolean(),
		}));

		expect(table.name).toBe('posts');
		expect(table.config.primary_key).toBe('id');
		expect(table.config.primary_key_type).toBe('string');
		expect(table.config.table_definition).toHaveProperty('id');
		expect(table.config.table_definition).toHaveProperty('title');
		expect(table.config.table_definition).toHaveProperty('body');
		expect(table.config.table_definition).toHaveProperty('views');
		expect(table.config.table_definition).toHaveProperty('published');
	});

	it('should detect searchable fields', () => {
		const table = Database.table('items', (schema) => ({
			id: schema.primaryKey(),
			name: schema.string().searchable(),
			count: schema.number(),
		}));

		expect(table.config.searchable_fields).toContain('id');
		expect(table.config.searchable_fields).toContain('name');
		expect(table.config.searchable_fields).not.toContain('count');
	});

	it('should detect sortable fields', () => {
		const table = Database.table('items', (schema) => ({
			id: schema.primaryKey(),
			name: schema.string().sortable(),
			count: schema.number(),
		}));

		expect(table.config.sortable_fields).toContain('name');
		expect(table.config.sortable_fields).not.toContain('count');
	});

	it('should handle nested object searchable fields with dot notation', () => {
		const table = Database.table('profiles', (schema) => ({
			id: schema.primaryKey(),
			name: schema.string().searchable(),
			address: schema.object({
				city: schema.string().searchable(),
				zip: schema.string(),
			}),
		}));

		expect(table.config.searchable_fields).toContain('id');
		expect(table.config.searchable_fields).toContain('name');
		expect(table.config.searchable_fields).toContain('address.city');
		expect(table.config.searchable_fields).not.toContain('address.zip');
	});

	it('should set getDocumentIndexId using the primary key field', () => {
		const table = Database.table('items', (schema) => ({
			id: schema.primaryKey(),
			name: schema.string(),
		}));

		const getId = table.config.orama.components.getDocumentIndexId;
		expect(getId({ id: 'abc', name: 'test' })).toBe('abc');
	});

	it('should set getDocumentIndexId for a custom primary key name', () => {
		const table = Database.table('items', (schema) => ({
			slug: schema.primaryKey(),
			name: schema.string(),
		}));

		expect(table.config.primary_key).toBe('slug');
		const getId = table.config.orama.components.getDocumentIndexId;
		expect(getId({ slug: 'my-item', name: 'test' })).toBe('my-item');
	});

	it('should convert numeric primary keys to string in getDocumentIndexId', () => {
		const table = Database.table('items', (schema) => ({
			item_id: schema.primaryKey({ type: 'number' }),
			name: schema.string(),
		}));

		expect(table.config.primary_key).toBe('item_id');
		const getId = table.config.orama.components.getDocumentIndexId;
		expect(getId({ item_id: 42, name: 'test' })).toBe('42');
	});

	it('should auto-inject id primary key when none is defined', () => {
		const table = Database.table('people', (schema) => ({
			name: schema.string(),
		}));

		expect(table.config.primary_key).toBe('id');
		expect(table.config.primary_key_type).toBe('string');
		expect(table.config.table_definition).toHaveProperty('id', 'TEXT PRIMARY KEY');
		expect(table.config.searchable_fields).toContain('id');
	});

	it('should not auto-inject id when a primary key is explicitly defined', () => {
		const table = Database.table('items', (schema) => ({
			slug: schema.primaryKey(),
			name: schema.string(),
		}));

		expect(table.config.primary_key).toBe('slug');
		// Should not have a separate 'id' field
		expect(table.config.table_definition).not.toHaveProperty('id');
	});

	it('should auto-add created_at and updated_at to table definition', () => {
		const table = Database.table('items', (schema) => ({
			id: schema.primaryKey(),
			name: schema.string(),
		}));

		expect(table.config.table_definition).toHaveProperty(
			'created_at',
			'INTEGER NOT NULL',
		);
		expect(table.config.table_definition).toHaveProperty(
			'updated_at',
			'INTEGER NOT NULL',
		);
	});

	it('should add updated_at to orama schema as a number', () => {
		const table = Database.table('items', (schema) => ({
			id: schema.primaryKey(),
			name: schema.string(),
		}));

		expect(table.config.orama.schema).toHaveProperty('updated_at', 'number');
		expect(table.config.orama.schema).toHaveProperty('created_at', 'number');
	});

	it('should make updated_at sortable for sync/change detection', () => {
		const table = Database.table('items', (schema) => ({
			id: schema.primaryKey(),
			name: schema.string(),
		}));

		expect(table.config.sortable_fields).toContain('updated_at');
		expect(table.config.orama.sort.enabled).toBe(true);
	});

	it('should throw if created_at is used as a field name', () => {
		expect(() => {
			Database.table('bad', (schema) => ({
				id: schema.primaryKey(),
				created_at: schema.string(),
			}));
		}).toThrow('created_at');
	});

	it('should throw if updated_at is used as a field name', () => {
		expect(() => {
			Database.table('bad', (schema) => ({
				id: schema.primaryKey(),
				updated_at: schema.string(),
			}));
		}).toThrow('updated_at');
	});
});

describe('Schema: toSparse()', () => {
	it('should extract top-level searchable fields', () => {
		const table = Database.table('items', (schema) => ({
			id: schema.primaryKey(),
			name: schema.string().searchable(),
			description: schema.string(),
		}));

		const sparse = table.toSparse({
			id: 'abc',
			name: 'Widget',
			description: 'A nice widget',
			created_at: 100,
			updated_at: 200,
		} as any);

		expect(sparse).toHaveProperty('id', 'abc');
		expect(sparse).toHaveProperty('name', 'Widget');
		expect(sparse).not.toHaveProperty('description');
	});

	it('should handle nested object searchable fields correctly', () => {
		const table = Database.table('profiles', (schema) => ({
			id: schema.primaryKey(),
			name: schema.string().searchable(),
			address: schema.object({
				city: schema.string().searchable(),
				zip: schema.string(),
			}),
		}));

		const sparse = table.toSparse({
			id: '123',
			name: 'Alice',
			address: { city: 'Portland', zip: '97201' },
			created_at: 100,
			updated_at: 200,
		} as any);

		// Top-level field should be at root
		expect(sparse).toHaveProperty('id', '123');
		expect(sparse).toHaveProperty('name', 'Alice');
		// Nested field should be under its parent
		expect(sparse).toHaveProperty('address');
		expect((sparse as any).address).toHaveProperty('city', 'Portland');
		expect((sparse as any).address).not.toHaveProperty('zip');
	});

	it('should not corrupt root when mixing nested and top-level fields', () => {
		const table = Database.table('profiles', (schema) => ({
			id: schema.primaryKey(),
			address: schema.object({
				city: schema.string().searchable(),
			}),
			name: schema.string().searchable(),
		}));

		const sparse = table.toSparse({
			id: '1',
			address: { city: 'NYC' },
			name: 'Bob',
			created_at: 100,
			updated_at: 200,
		} as any);

		// The bug was that after processing address.city, name would be
		// written to the address object instead of the root
		expect(sparse).toHaveProperty('name', 'Bob');
		expect(sparse).toHaveProperty('address');
		expect((sparse as any).address).toHaveProperty('city', 'NYC');
		// name should NOT be inside address
		expect((sparse as any).address).not.toHaveProperty('name');
	});

	it('should convert ISO string timestamps to epoch numbers', () => {
		const table = Database.table('items', (schema) => ({
			id: schema.primaryKey(),
			name: schema.string().searchable(),
		}));

		const date = new Date('2024-01-15T12:00:00.000Z');
		const sparse = table.toSparse({
			id: '1',
			name: 'test',
			created_at: date.toISOString(),
			updated_at: date.toISOString(),
		} as any);

		expect(sparse).toHaveProperty('updated_at', date.getTime());
		expect(sparse).toHaveProperty('created_at', date.getTime());
	});

	it('should pass through numeric timestamps in toSparse', () => {
		const table = Database.table('items', (schema) => ({
			id: schema.primaryKey(),
			name: schema.string().searchable(),
		}));

		const sparse = table.toSparse({
			id: '1',
			name: 'test',
			created_at: 1000,
			updated_at: 2000,
		} as any);

		expect(sparse).toHaveProperty('updated_at', 2000);
		expect(sparse).toHaveProperty('created_at', 1000);
	});
});

describe('Schema: parse()', () => {
	it('should validate required fields', () => {
		const table = Database.table('items', (schema) => ({
			id: schema.primaryKey(),
			name: schema.string(),
		}));

		// Missing required 'name' should throw
		expect(() => table.parse({} as any)).toThrow();
	});

	it('should allow optional fields to be null', () => {
		const table = Database.table('items', (schema) => ({
			id: schema.primaryKey(),
			name: schema.string(),
			description: schema.string().optional(),
		}));

		const result = table.parse({ id: 'x', name: 'test', description: null } as any);
		expect(result).toHaveProperty('name', 'test');
	});

	it('should coerce ISO string timestamps to epoch numbers in parse', () => {
		const table = Database.table('items', (schema) => ({
			id: schema.primaryKey(),
			name: schema.string(),
		}));

		const date = new Date('2024-01-15T12:00:00.000Z');
		const result = table.parse({
			id: 'x',
			name: 'test',
			created_at: date.toISOString(),
			updated_at: date.toISOString(),
		} as any);
		expect(result).toHaveProperty('created_at', date.getTime());
		expect(result).toHaveProperty('updated_at', date.getTime());
	});

	it('should pass through numeric timestamps in parse', () => {
		const table = Database.table('items', (schema) => ({
			id: schema.primaryKey(),
			name: schema.string(),
		}));

		const result = table.parse({
			id: 'x',
			name: 'test',
			created_at: 1705320000000,
			updated_at: 1705320000000,
		} as any);
		expect(result).toHaveProperty('created_at', 1705320000000);
		expect(result).toHaveProperty('updated_at', 1705320000000);
	});

	it('should parse tables with auto-injected id', () => {
		const table = Database.table('items', (schema) => ({
			name: schema.string(),
		}));

		const result = table.parse({ id: 'abc', name: 'test' } as any);
		expect(result).toHaveProperty('id', 'abc');
		expect(result).toHaveProperty('name', 'test');
	});
});

describe('Schema: EnumFieldGenerator', () => {
	it('should throw on empty enum options', () => {
		expect(() => {
			Database.table('bad', (schema) => ({
				id: schema.primaryKey(),
				status: schema.enum([]),
			}));
		}).toThrow('schema.enum() requires at least one option');
	});

	it('should validate enum values', () => {
		const table = Database.table('items', (schema) => ({
			id: schema.primaryKey(),
			status: schema.enum(['active', 'inactive']),
		}));

		// Valid enum value
		const result = table.parse({ id: 'x', status: 'active' } as any);
		expect(result).toHaveProperty('status', 'active');

		// Invalid enum value should throw
		expect(() => table.parse({ id: 'x', status: 'bad_value' } as any)).toThrow();
	});
});

describe('Schema: BooleanFieldGenerator', () => {
	it('should mark readonly in Zod schema', () => {
		const table = Database.table('items', (schema) => ({
			id: schema.primaryKey(),
			locked: schema.boolean().readonly(),
		}));

		// readonly fields should reject updates
		expect(table._['locked']._['readonly']).toBe(true);
	});
});

describe('Schema: VectorFieldGenerator', () => {
	it('should set dimensions and schema', () => {
		const table = Database.table('items', (schema) => ({
			id: schema.primaryKey(),
			embedding: schema.vector(128),
		}));

		expect(table._['embedding']._['dimensions']).toBe(128);
		expect(table._['embedding']._['schema']).toBeDefined();
	});

	it('should update schema when size() is called', () => {
		const table = Database.table('items', (schema) => ({
			id: schema.primaryKey(),
			embedding: schema.vector(64).size(128),
		}));

		expect(table._['embedding']._['dimensions']).toBe(128);
	});

	it('should allow optional vectors', () => {
		const table = Database.table('items', (schema) => ({
			id: schema.primaryKey(),
			embedding: schema.vector(128).optional(),
		}));

		expect(table._['embedding']._['optional']).toBe(true);
		expect(table._['embedding']._['schema']).toBeDefined();
	});
});

describe('Schema: GeopointFieldGenerator', () => {
	it('should create a geopoint with lat/lon schema', () => {
		const table = Database.table('places', (schema) => ({
			id: schema.primaryKey(),
			location: schema.geopoint(),
		}));

		expect(table._['location']._['type']).toBe('geopoint');
		expect(table._['location']._['searchable']).toBe(true);
	});

	it('should allow optional geopoints with schema update', () => {
		const table = Database.table('places', (schema) => ({
			id: schema.primaryKey(),
			location: schema.geopoint().optional(),
		}));

		expect(table._['location']._['optional']).toBe(true);
		// Schema should allow null/undefined after optional()
		const schema = table._['location']._['schema'];
		expect(schema).toBeDefined();
	});
});

describe('Schema: ObjectFieldGenerator', () => {
	it('should create nested object schema', () => {
		const table = Database.table('items', (schema) => ({
			id: schema.primaryKey(),
			meta: schema.object({
				color: schema.string(),
				count: schema.number(),
			}),
		}));

		expect(table._['meta']._['type']).toBe('object');
		expect(table._['meta']._['properties']).toBeDefined();
	});

	it('should allow optional objects', () => {
		const table = Database.table('items', (schema) => ({
			id: schema.primaryKey(),
			meta: schema.object({ tag: schema.string() }).optional(),
		}));

		expect(table._['meta']._['optional']).toBe(true);
	});
});

describe('Schema: ArrayFieldGenerator', () => {
	it('should create array schema', () => {
		const table = Database.table('items', (schema) => ({
			id: schema.primaryKey(),
			tags: schema.array(schema.string()),
		}));

		expect(table._['tags']._['type']).toBe('array');
	});

	it('should allow optional arrays', () => {
		const table = Database.table('items', (schema) => ({
			id: schema.primaryKey(),
			tags: schema.array(schema.string()).optional(),
		}));

		expect(table._['tags']._['optional']).toBe(true);
	});
});

describe('Schema: derived() modifier', () => {
	it('should NOT include derived fields in table_definition', () => {
		const table = Database.table('person_d1', (schema) => ({
			id: schema.primaryKey(),
			first_name: schema.string(),
			last_name: schema.string(),
			name: schema.string().derived((data) => `${data.first_name} ${data.last_name}`),
		}));

		expect(table.config.table_definition).toHaveProperty('id');
		expect(table.config.table_definition).toHaveProperty('first_name');
		expect(table.config.table_definition).toHaveProperty('last_name');
		expect(table.config.table_definition).not.toHaveProperty('name');
	});

	it('should automatically include derived fields in searchable_fields', () => {
		const table = Database.table('person_d2', (schema) => ({
			id: schema.primaryKey(),
			first_name: schema.string(),
			name: schema.string().derived((data) => data.first_name),
		}));

		expect(table.config.searchable_fields).toContain('name');
	});

	it('should include derived fields in sortable_fields when marked sortable', () => {
		const table = Database.table('person_d3', (schema) => ({
			id: schema.primaryKey(),
			first_name: schema.string(),
			name: schema
				.string()
				.derived((data) => data.first_name)
				.sortable(),
		}));

		expect(table.config.sortable_fields).toContain('name');
	});

	it('should include derived fields in orama schema', () => {
		const table = Database.table('person_d4', (schema) => ({
			id: schema.primaryKey(),
			first_name: schema.string(),
			name: schema.string().derived((data) => data.first_name),
		}));

		expect(table.config.orama.schema).toHaveProperty('name', 'string');
	});

	it('should NOT include derived fields in parse output', () => {
		const table = Database.table('person_d5', (schema) => ({
			id: schema.primaryKey(),
			first_name: schema.string(),
			name: schema.string().derived((data) => data.first_name),
		}));

		const result = table.parse({ id: 'x', first_name: 'Alice' } as any);
		expect(result).toHaveProperty('first_name', 'Alice');
		expect(result).not.toHaveProperty('name');
	});

	it('should compute string derived values in toSparse', () => {
		const table = Database.table('person_d6', (schema) => ({
			id: schema.primaryKey(),
			first_name: schema.string().searchable(),
			last_name: schema.string().searchable(),
			name: schema.string().derived((data) => `${data.first_name} ${data.last_name}`),
		}));

		const sparse = table.toSparse({
			id: '1',
			first_name: 'Alice',
			last_name: 'Smith',
			created_at: 100,
			updated_at: 200,
		} as any);

		expect(sparse).toHaveProperty('name', 'Alice Smith');
		expect(sparse).toHaveProperty('first_name', 'Alice');
		expect(sparse).toHaveProperty('last_name', 'Smith');
	});

	it('should compute number derived values in toSparse', () => {
		const table = Database.table('stats_d', (schema) => ({
			id: schema.primaryKey(),
			width: schema.number().searchable(),
			height: schema.number().searchable(),
			area: schema.number().derived((data) => data.width * data.height),
		}));

		const sparse = table.toSparse({
			id: '1',
			width: 10,
			height: 20,
			created_at: 100,
			updated_at: 200,
		} as any);

		expect(sparse).toHaveProperty('area', 200);
	});

	it('should compute boolean derived values in toSparse', () => {
		const table = Database.table('items_d', (schema) => ({
			id: schema.primaryKey(),
			age: schema.number().searchable(),
			is_adult: schema.boolean().derived((data) => data.age >= 18),
		}));

		const sparse = table.toSparse({
			id: '1',
			age: 25,
			created_at: 100,
			updated_at: 200,
		} as any);

		expect(sparse).toHaveProperty('is_adult', true);
	});

	it('should compute enum derived values in toSparse', () => {
		const table = Database.table('items_de', (schema) => ({
			id: schema.primaryKey(),
			score: schema.number().searchable(),
			grade: schema.enum(['A', 'B', 'C', 'F']).derived((data) => {
				if (data.score >= 90) return 'A';
				if (data.score >= 80) return 'B';
				if (data.score >= 70) return 'C';
				return 'F';
			}),
		}));

		const sparse = table.toSparse({
			id: '1',
			score: 95,
			created_at: 100,
			updated_at: 200,
		} as any);

		expect(sparse).toHaveProperty('grade', 'A');
	});

	it('should NOT include derived fields in form field props', () => {
		const table = Database.table('person_d7', (schema) => ({
			id: schema.primaryKey(),
			first_name: schema.string(),
			name: schema.string().derived((data) => data.first_name),
		}));

		expect(table.form.field).not.toHaveProperty('name');
		expect(table.form.field).toHaveProperty('first_name');
	});

	it('should silently handle errors in derived functions during toSparse', () => {
		const table = Database.table('person_d9', (schema) => ({
			id: schema.primaryKey(),
			first_name: schema.string().searchable(),
			bad_field: schema.string().derived(() => {
				throw new Error('oops');
			}),
		}));

		const sparse = table.toSparse({
			id: '1',
			first_name: 'Alice',
			created_at: 100,
			updated_at: 200,
		} as any);

		expect(sparse).toHaveProperty('first_name', 'Alice');
		expect(sparse).not.toHaveProperty('bad_field');
	});

	it('should set derived flag on field metadata', () => {
		const table = Database.table('person_d10', (schema) => ({
			id: schema.primaryKey(),
			first_name: schema.string(),
			name: schema.string().derived((data) => data.first_name),
		}));

		expect((table._['name']._ as any)['derived']).toBe(true);
		expect((table._['first_name']._ as any)['derived']).toBeUndefined();
	});
});

// FK-derived fields should NOT appear in Entity type
const BOOK_WITH_FK_DERIVED = Database.table('book_fk', (schema) => ({
	title: schema.string().searchable(),
	author_id: schema.foreignKey({ type: 'string', table: 'authors', column: 'id' }),
	author_name: schema
		.string()
		.derived(['author_id'], (data, refs) => refs.author_id?.name ?? 'Unknown'),
}));
type BookWithFkDerived = Database.Entity<typeof BOOK_WITH_FK_DERIVED>;

// Entity should have title, author_id, auto-id, timestamps — but NOT author_name
assertType<BookWithFkDerived>(
	{} as {
		readonly id: string;
		title: string;
		author_id: string;
		readonly created_at: number;
		readonly updated_at: number;
	},
);

describe('Schema: FK-derived fields', () => {
	it('should store derived_foreign_keys metadata on the field', () => {
		const table = Database.table('book_fk1', (schema) => ({
			title: schema.string(),
			author_id: schema.foreignKey({ type: 'string', table: 'authors', column: 'id' }),
			author_name: schema
				.string()
				.derived(['author_id'], (data, refs) => refs.author_id?.name ?? 'Unknown'),
		}));

		expect((table._['author_name']._ as any)['derived']).toBe(true);
		expect((table._['author_name']._ as any)['derived_foreign_keys']).toEqual([
			'author_id',
		]);
	});

	it('should automatically include FK-derived fields in searchable_fields', () => {
		const table = Database.table('book_fk2', (schema) => ({
			title: schema.string(),
			author_id: schema.foreignKey({ type: 'string', table: 'authors', column: 'id' }),
			author_name: schema
				.string()
				.derived(['author_id'], (data, refs) => refs.author_id?.name ?? 'Unknown'),
		}));

		expect(table.config.searchable_fields).toContain('author_name');
	});

	it('should include FK-derived fields in orama schema', () => {
		const table = Database.table('book_fk3', (schema) => ({
			title: schema.string(),
			author_id: schema.foreignKey({ type: 'string', table: 'authors', column: 'id' }),
			author_name: schema
				.string()
				.derived(['author_id'], (data, refs) => refs.author_id?.name ?? 'Unknown'),
		}));

		expect(table.config.orama.schema).toHaveProperty('author_name', 'string');
	});

	it('should NOT include FK-derived fields in table_definition', () => {
		const table = Database.table('book_fk4', (schema) => ({
			title: schema.string(),
			author_id: schema.foreignKey({ type: 'string', table: 'authors', column: 'id' }),
			author_name: schema
				.string()
				.derived(['author_id'], (data, refs) => refs.author_id?.name ?? 'Unknown'),
		}));

		expect(table.config.table_definition).not.toHaveProperty('author_name');
		expect(table.config.table_definition).toHaveProperty('title');
		expect(table.config.table_definition).toHaveProperty('author_id');
	});

	it('should store derived_fields config with FK dependencies', () => {
		const table = Database.table('book_fk5', (schema) => ({
			title: schema.string(),
			author_id: schema.foreignKey({ type: 'string', table: 'authors', column: 'id' }),
			author_name: schema
				.string()
				.derived(['author_id'], (data, refs) => refs.author_id?.name ?? 'Unknown'),
		}));

		expect(table.config.derived_fields).toEqual({
			author_name: { foreign_keys: ['author_id'] },
		});
	});

	it('should NOT compute FK-derived fields in toSparse', () => {
		const table = Database.table('book_fk6', (schema) => ({
			title: schema.string().searchable(),
			author_id: schema.foreignKey({ type: 'string', table: 'authors', column: 'id' }),
			author_name: schema
				.string()
				.derived(['author_id'], (data, refs) => refs.author_id?.name ?? 'Unknown'),
		}));

		const sparse = table.toSparse({
			id: '1',
			title: 'Test Book',
			author_id: 'author-1',
			created_at: 100,
			updated_at: 200,
		} as any);

		// FK-derived field should NOT be computed by toSparse (db.server handles it)
		expect(sparse).not.toHaveProperty('author_name');
		expect(sparse).toHaveProperty('title', 'Test Book');
	});

	it('should still compute same-table derived fields in toSparse', () => {
		const table = Database.table('book_fk7', (schema) => ({
			title: schema.string().searchable(),
			author_id: schema.foreignKey({ type: 'string', table: 'authors', column: 'id' }),
			title_upper: schema.string().derived((data) => data.title.toUpperCase()),
			author_name: schema
				.string()
				.derived(['author_id'], (data, refs) => refs.author_id?.name ?? 'Unknown'),
		}));

		const sparse = table.toSparse({
			id: '1',
			title: 'Test Book',
			author_id: 'author-1',
			created_at: 100,
			updated_at: 200,
		} as any);

		expect(sparse).toHaveProperty('title_upper', 'TEST BOOK');
		expect(sparse).not.toHaveProperty('author_name');
	});

	it('should NOT include FK-derived fields in form field props', () => {
		const table = Database.table('book_fk8', (schema) => ({
			title: schema.string(),
			author_id: schema.foreignKey({ type: 'string', table: 'authors', column: 'id' }),
			author_name: schema
				.string()
				.derived(['author_id'], (data, refs) => refs.author_id?.name ?? 'Unknown'),
		}));

		expect(table.form.field).not.toHaveProperty('author_name');
		expect(table.form.field).toHaveProperty('title');
	});

	it('should throw if FK dep references a non-FK field', () => {
		expect(() =>
			Database.table('book_fk9', (schema) => ({
				title: schema.string(),
				author_name: schema
					.string()
					.derived(['title'], (data, refs) => refs.title?.name ?? 'Unknown'),
			})),
		).toThrow(/not a foreign key field/);
	});

	it('should support multiple FK dependencies', () => {
		const table = Database.table('review_fk', (schema) => ({
			book_id: schema.foreignKey({ type: 'string', table: 'books', column: 'id' }),
			reviewer_id: schema.foreignKey({ type: 'string', table: 'users', column: 'id' }),
			summary: schema
				.string()
				.derived(
					['book_id', 'reviewer_id'],
					(data, refs) => `${refs.reviewer_id?.name} reviewed ${refs.book_id?.title}`,
				),
		}));

		expect(table.config.derived_fields).toEqual({
			summary: { foreign_keys: ['book_id', 'reviewer_id'] },
		});
		expect((table._['summary']._ as any)['derived_foreign_keys']).toEqual([
			'book_id',
			'reviewer_id',
		]);
	});

	it('should support number FK-derived fields', () => {
		const table = Database.table('item_fk', (schema) => ({
			category_id: schema.foreignKey({
				type: 'string',
				table: 'categories',
				column: 'id',
			}),
			category_priority: schema
				.number()
				.derived(['category_id'], (data, refs) => refs.category_id?.priority ?? 0),
		}));

		expect((table._['category_priority']._ as any)['derived']).toBe(true);
		expect(table.config.orama.schema).toHaveProperty('category_priority', 'number');
	});
});

// ── Regression tests: storage + validation fixes ────────────────────────────

describe('non-scalar field storage', () => {
	it('stores object/array/vector/geopoint fields in the json column (no sqlite columns)', () => {
		const table = Database.table('storage_test', (schema) => ({
			name: schema.string(),
			address: schema.object({ city: schema.string() }),
			tags: schema.array(schema.string()),
			embedding: schema.vector(3),
			location: schema.geopoint(),
		}));
		expect(table.config.table_definition).toHaveProperty('name');
		expect(table.config.table_definition).not.toHaveProperty('address');
		expect(table.config.table_definition).not.toHaveProperty('tags');
		expect(table.config.table_definition).not.toHaveProperty('embedding');
		expect(table.config.table_definition).not.toHaveProperty('location');
	});
});

describe('array validation', () => {
	it('enforces length constraints declared on the array itself', () => {
		const table = Database.table('array_len', (schema) => ({
			tags: schema.array(schema.string()).min(2).max(3),
		}));
		const base = { id: 'a', created_at: 1, updated_at: 1 };
		expect(() => table.parse({ ...base, tags: ['one'] })).toThrow(/between 2 and 3/);
		expect(() => table.parse({ ...base, tags: ['1', '2', '3', '4'] })).toThrow(
			/at most 3|between 2 and 3/,
		);
		expect(() => table.parse({ ...base, tags: ['one', 'two'] })).not.toThrow();
	});

	it('does not misread item-level numeric bounds as array length constraints', () => {
		const table = Database.table('array_items', (schema) => ({
			nums: schema.array(schema.number().min(5).max(10)),
		}));
		const base = { id: 'a', created_at: 1, updated_at: 1 };
		// 2 items, each within [5, 10] — valid even though 2 < 5
		expect(() => table.parse({ ...base, nums: [7, 8] })).not.toThrow();
		// item out of range must still fail
		expect(() => table.parse({ ...base, nums: [3] })).toThrow();
	});
});

describe('searchable arrays', () => {
	it('includes searchable array fields in searchable_fields and toSparse output', () => {
		const table = Database.table('searchable_array', (schema) => ({
			title: schema.string().searchable(),
			tags: schema.array(schema.string()).searchable(),
		}));
		expect(table.config.searchable_fields).toContain('tags');
		expect(table.config.orama.schema).toHaveProperty('tags', 'string[]');
		const sparse = table.toSparse({
			id: 'a',
			title: 'hello',
			tags: ['x', 'y'],
			created_at: 1,
			updated_at: 1,
		} as any);
		expect((sparse as any).tags).toEqual(['x', 'y']);
	});
});

describe('field defaults', () => {
	it('applies .default() when the field is omitted', () => {
		const table = Database.table('with_default', (schema) => ({
			status: schema.string().default('active'),
			count: schema.number().default(0),
		}));
		const parsed = table.parse({ id: 'a', created_at: 1, updated_at: 1 }) as any;
		expect(parsed.status).toBe('active');
		expect(parsed.count).toBe(0);
	});

	it('applies .default() on optional fields and keeps provided values', () => {
		const table = Database.table('with_optional_default', (schema) => ({
			status: schema.string().optional().default('active'),
		}));
		expect((table.parse({ id: 'a', created_at: 1, updated_at: 1 }) as any).status).toBe(
			'active',
		);
		expect(
			(table.parse({ id: 'a', status: 'archived', created_at: 1, updated_at: 1 }) as any)
				.status,
		).toBe('archived');
	});

	it('does not apply a default for an explicit null on an optional field', () => {
		const table = Database.table('null_no_default', (schema) => ({
			status: schema.string().optional().default('active'),
		}));
		const parsed = table.parse({
			id: 'a',
			status: null,
			created_at: 1,
			updated_at: 1,
		}) as any;
		expect(parsed.status).toBeUndefined();
	});
});

describe('readonly fields', () => {
	it('collects readonly fields into config.readonly_fields', () => {
		const table = Database.table('with_readonly', (schema) => ({
			owner_id: schema.string().readonly(),
			name: schema.string(),
		}));
		expect(table.config.readonly_fields).toEqual(['owner_id']);
	});
});
