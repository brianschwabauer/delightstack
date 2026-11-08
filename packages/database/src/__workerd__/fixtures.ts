/**
 * Schema and helpers shared by the workerd suite.
 *
 * The tables are modelled on a real app's hottest ones (a deal, its people and
 * its documents): a mix of searchable strings, enums, foreign keys, a large
 * nested object, a history table and an `ON DELETE CASCADE` child, so cost and
 * behaviour numbers measured here resemble production rather than a toy.
 */

import { Database } from '../schema/schema.js';

export const dealTable = Database.table('deal', (s) => ({
	address: s.string().searchable(),
	city: s.string().indexable().searchable(),
	state: s.string().indexable().searchable(),
	postal_code: s.string().indexable(),
	kind: s.enum(['purchase', 'listing', 'lease']),
	status: s.enum(['draft', 'active', 'closed']),
	price_cents: s.number().optional(),
	notes: s.string().optional(),
	private: s.boolean().optional(),
	tags: s.array(s.string()).optional(),
}), { indexes: [{ columns: ['status'] }] });

export const personTable = Database.table('person', (s) => ({
	name: s.string().searchable(),
	email: s.string().email().searchable().optional(),
	phone: s.string().searchable().optional(),
}));

export const participantTable = Database.table('participant', (s) => ({
	deal_id: s.foreignKey({
		type: 'string',
		table: 'deal',
		column: 'id',
		on_delete: 'CASCADE',
	}),
	person_id: s
		.foreignKey({ type: 'string', table: 'person', column: 'id', on_delete: 'SET NULL' })
		.optional(),
	name: s.string().searchable(),
	role: s.enum(['buyer', 'seller', 'agent']),
}));

export const documentTable = Database.table(
	'document',
	(s) => ({
		deal_id: s.foreignKey({
			type: 'string',
			table: 'deal',
			column: 'id',
			on_delete: 'CASCADE',
		}),
		name: s.string().searchable(),
		status: s.enum(['draft', 'sent', 'executed']),
		field_values: s.string().default('{}'),
		field_schema: s
			.array(
				s.object({
					id: s.string(),
					type: s.string(),
					page: s.number(),
					x: s.number(),
					y: s.number(),
					label: s.string().optional(),
				}),
			)
			.optional(),
		page_count: s.number().optional(),
	}),
	{ history: true },
);

export const TABLES = {
	deal: dealTable,
	person: personTable,
	participant: participantTable,
	document: documentTable,
};

/** A realistic 200-field layout (~20 KB of JSON). */
export function fieldSchema(count = 200) {
	return Array.from({ length: count }, (_, i) => ({
		id: `field_${i.toString().padStart(4, '0')}`,
		type: i % 5 === 0 ? 'signature' : 'text',
		page: Math.floor(i / 20) + 1,
		x: 72 + (i % 4) * 120,
		y: 100 + (i % 20) * 30,
		label: `Field label number ${i}`,
	}));
}

export interface Cost {
	written: number;
	read: number;
	statements: number;
}

/**
 * Sums the billed `rowsWritten` / `rowsRead` of every statement `fn` runs.
 *
 * Wraps `ctx.storage.sql.exec` for the duration of the call. Counters are read
 * after the run, so a cursor the code only partly consumed reports what it
 * consumed — the same thing Cloudflare bills.
 */
export function measure(ctx: DurableObjectState, fn: () => void): Cost {
	const sql = ctx.storage.sql as unknown as {
		exec: (...args: unknown[]) => SqlStorageCursor<Record<string, SqlStorageValue>>;
	};
	const original = sql.exec;
	const cursors: SqlStorageCursor<Record<string, SqlStorageValue>>[] = [];
	sql.exec = (...args: unknown[]) => {
		const cursor = original.apply(ctx.storage.sql, args as never);
		cursors.push(cursor);
		return cursor;
	};
	try {
		fn();
	} finally {
		sql.exec = original;
	}
	let written = 0;
	let read = 0;
	for (const cursor of cursors) {
		written += cursor.rowsWritten;
		read += cursor.rowsRead;
	}
	return { written, read, statements: cursors.length };
}
