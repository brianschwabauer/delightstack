import { describe, it, expect, assertType } from 'vitest';
import { Database } from './schema';

// ── Type-level tests ─────────────────────────────────────────────────────────
// These verify that Database.Entity<> produces the correct TypeScript type

const PERSON = Database.table('person', (schema) => ({ name: schema.string() }));
type Person = Database.Entity<typeof PERSON>;

// Auto-id: 'id' should be present when no primary key is defined
assertType<Person>({} as { readonly id: string; name: string; readonly created_at: number; readonly updated_at: number });

const POST = Database.table('post', (schema) => ({
	slug: schema.primaryKey(),
	title: schema.string(),
}));
type Post = Database.Entity<typeof POST>;

// Explicit PK: 'slug' should be present, no extra 'id'
assertType<Post>({} as { readonly slug: string; title: string; readonly created_at: number; readonly updated_at: number });

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

		expect(table.config.table_definition).toHaveProperty('created_at', 'INTEGER NOT NULL');
		expect(table.config.table_definition).toHaveProperty('updated_at', 'INTEGER NOT NULL');
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
