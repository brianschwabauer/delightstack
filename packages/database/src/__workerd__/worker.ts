/**
 * The test worker for the workerd suite (vitest.workers.config.ts).
 *
 * `TestDatabase` is a plain `DatabaseServer` over the fixture schema. Tests
 * that need a different schema on the same storage (a redeploy with a changed
 * schema, a migration) construct another `DatabaseServer` over the instance's
 * `ctx` inside `runInDurableObject`.
 */

import { DurableObject } from 'cloudflare:workers';
import { DatabaseServer } from '../server/db.server.js';
import { TABLES } from './fixtures.js';

export class TestDatabase extends DatabaseServer<typeof TABLES> {
	constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
		super(TABLES, () => undefined, ctx, { ...env, DEV: true } as never);
	}

	/** The DO's state, for tests that build a second server over it. */
	get state(): DurableObjectState {
		return this.ctx;
	}
}

/**
 * An empty SQLite Durable Object: tests that boot their own schema (or
 * several versions of one) over its storage.
 */
export class BareDatabase extends DurableObject {
	get state(): DurableObjectState {
		return this.ctx;
	}

	/** Servers built over this storage arm alarms; tests drive them directly. */
	async alarm(): Promise<void> {}
}

export default {
	fetch(): Response {
		return new Response('database workerd suite');
	},
};
