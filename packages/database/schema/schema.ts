import { z } from 'zod';

export const primaryKey = z.string().register(z.globalRegistry, {
	description:
		'Primary key for the table, typically a UUID or similar unique identifier.',
	example: '123e4567-e89b-12d3-a456-426614174000',
	_delightstack: {
		type: 'primaryKey',
	},
});

// TODO: Maybe support standard schema?

type DBOptions = {
	searchable?: boolean;
	indexable?: boolean;
	unique?: boolean;
	primary?: boolean;
	foreignKey?: {
		table: string;
		column: string;
	};
};

const db_fields = {
	primaryKey,
	object: (schema: z.ZodObject<any>) =>
		z.object(schema).register(z.globalRegistry, {
			description: 'Object schema for the table.',
		}),
	array: (schema: z.ZodType<any>) =>
		z.array(schema).register(z.globalRegistry, {
			description: 'Array schema for the table.',
		}),
	string: (options?: DBOptions) =>
		z.string().register(z.globalRegistry, {
			description: 'String schema for the table.',
		}),
	number: () =>
		z.number().register(z.globalRegistry, {
			description: 'Number schema for the table.',
		}),
	boolean: () =>
		z.boolean().register(z.globalRegistry, {
			description: 'Boolean schema for the table.',
		}),
};
export function table(callback: (fields: typeof db_fields) => ZodObjectDefinition<any>) {
	return z.object(callback(db_fields));
}

export const Person = table((db) => ({
	id: db.primaryKey,
	name: db.string({ indexable: true }).min(1).max(255),
}));
type Person = z.infer<typeof Person>;
/**
 * Example usage for svelte component
 * <Input {...Person.meta().form} bind:value={value.name} />
 */

// ------------------------ OR --------------------

function field(options?: DBOptions) {
	// Use standard schema here instead
	const value = {
		type: 'string',
		db_type: 'string',
		orama_type: 'string',
		...options,
	};
	return {
		string: () => z.string().register(z.globalRegistry, value),
		number: () => z.number().register(z.globalRegistry, value),
	};
}
export const CONFIG2 = {
	id: field({ primary: true }).string(),
	name: field({ indexable: true }).string().min(1).max(255),
};

// ------------------------ OR --------------------

// Use standard schema here instead
function dbField(options?: DBOptions & { validator: () => z.ZodType<any> }) {
	const value = {
		type: 'string',
		db_type: 'string',
		orama_type: 'string',
		...options,
	};
}
export const CONFIG3 = {
	id: dbField({ primary: true, validator: z.string() }),
	name: dbField({ indexable: true, validator: z.string().min(1).max(255) }),
};
