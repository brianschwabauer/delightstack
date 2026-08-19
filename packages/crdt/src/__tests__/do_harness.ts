/**
 * A `DurableObjectState` façade over `node:sqlite`.
 *
 * ## Why a real database
 *
 * `CrdtDocumentServer` is mostly a set of claims about SQL: "a repeat `op_id`
 * appends nothing", "the checkpoint snapshot is written before the delete",
 * "the compaction rolls back when it would grow". A mock that records SQL
 * strings can assert that the statements were *issued*; only a real engine can
 * say whether they were *right*. `node:sqlite` is built into Node, so this
 * costs no dependency.
 *
 * `packages/database` has an equivalent harness for its own tests. It is
 * deliberately not shared: it is not exported API, and a test helper that two
 * packages depend on becomes a third thing to keep compatible.
 *
 * `transactionSync` is implemented with **SAVEPOINT** rather than `BEGIN`, so
 * nesting works — compaction runs inside one and calls helpers that may open
 * their own.
 */

import { DatabaseSync } from 'node:sqlite';

/** The cursor shape the server consumes: `toArray` and `one`. */
export interface HarnessCursor<Row = Record<string, unknown>> {
	toArray(): Row[];
	one(): Row;
	[Symbol.iterator](): Iterator<Row>;
}

export interface HarnessState {
	/** Pass this as a Durable Object's `ctx`. */
	ctx: DurableObjectState;
	db: DatabaseSync;
	/** Every statement executed, in order. */
	log: { sql: string; params: unknown[] }[];
	close(): void;
}

/** Rough statement count — enough to route multi-statement DDL to `exec`. */
function countStatements(query: string): number {
	return query.split(';').filter((part) => part.trim().length > 0).length;
}

/** Create an in-memory Durable Object state backed by real SQLite. */
export function createDurableObjectState(id = 'crdt-test-do'): HarnessState {
	const db = new DatabaseSync(':memory:');
	db.exec('PRAGMA foreign_keys = OFF;');
	const log: { sql: string; params: unknown[] }[] = [];
	let depth = 0;

	function cursor(rows: Record<string, unknown>[]): HarnessCursor {
		return {
			toArray: () => rows,
			one: () => {
				if (rows.length !== 1)
					throw new Error(`Expected exactly one row, got ${rows.length}`);
				return rows[0];
			},
			[Symbol.iterator]: () => rows[Symbol.iterator](),
		};
	}

	const storage = {
		sql: {
			exec(query: string, ...bindings: unknown[]): HarnessCursor {
				log.push({ sql: query, params: bindings });
				if (bindings.length === 0 && countStatements(query) > 1) {
					db.exec(query);
					return cursor([]);
				}
				const statement = db.prepare(query);
				// `node:sqlite` rejects `undefined` and has no boolean binding.
				const params = bindings.map((value) => {
					if (value === undefined) return null;
					if (typeof value === 'boolean') return value ? 1 : 0;
					return value;
				});
				const rows = statement.all(...(params as never[])) as unknown as Record<
					string,
					unknown
				>[];
				// Null-prototype objects break spreads and vitest matchers.
				for (const row of rows) Object.setPrototypeOf(row, Object.prototype);
				return cursor(rows);
			},
		},
		transactionSync<T>(callback: () => T): T {
			const name = `crdt_${depth++}`;
			db.exec(`SAVEPOINT ${name};`);
			try {
				const value = callback();
				db.exec(`RELEASE ${name};`);
				return value;
			} catch (error) {
				db.exec(`ROLLBACK TO ${name};`);
				db.exec(`RELEASE ${name};`);
				throw error;
			} finally {
				depth--;
			}
		},
	};

	const ctx = {
		id: { toString: () => id },
		storage,
		waitUntil: () => {},
		blockConcurrencyWhile: <T>(fn: () => Promise<T>) => fn(),
		abort: () => {},
	} as unknown as DurableObjectState;

	return { ctx, db, log, close: () => db.close() };
}
