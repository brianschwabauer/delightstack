/**
 * One page's reads over RPC: N `exec` calls vs one `execMany`.
 *
 * Twelve reads is what a deal page in the app this package was measured
 * against issues on every navigation. In production each `exec` is a
 * Worker → Durable Object round trip (a network hop when the two run in
 * different locations) and a billed DO request; `execMany` is one of each.
 * The timings printed here are in-process (no network), so they only show
 * the per-call overhead; the hop count is the real saving.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import type { ExecStatement } from '../server/sql.database.js';
import type { TestDatabase } from './worker.js';

it('serves a page of reads in one round trip', async () => {
	const name = `rpc-${crypto.randomUUID()}`;
	const stub = env.DB.get(env.DB.idFromName(name));
	const deal_id = await runInDurableObject(stub, (db: TestDatabase) => {
		const deal = db.create('deal', {
			address: '1 Main Street',
			city: 'Wichita',
			state: 'KS',
			postal_code: '67202',
			kind: 'purchase',
			status: 'active',
		});
		for (let i = 0; i < 6; i++) {
			db.create('participant', { deal_id: deal.id, name: `Person ${i}`, role: 'buyer' });
			db.create('document', {
				deal_id: deal.id,
				name: `Doc ${i}`,
				status: 'draft',
				field_values: '{}',
			});
		}
		return deal.id;
	});
	const statements: ExecStatement[] = Array.from({ length: 12 }, (_, i) =>
		i % 3 === 0
			? ['SELECT * FROM deal WHERE id = ?', deal_id]
			: i % 3 === 1
				? [
						'SELECT id, name, role FROM participant WHERE deal_id = ? ORDER BY created_at',
						deal_id,
					]
				: [
						'SELECT id, name, status FROM document WHERE deal_id = ? ORDER BY created_at',
						deal_id,
					],
	);
	const time = async (fn: () => Promise<unknown>) => {
		await fn(); // warm
		const runs = 30;
		const start = performance.now();
		for (let i = 0; i < runs; i++) await fn();
		return (performance.now() - start) / runs;
	};
	const sequential = await time(async () => {
		for (const [sql, ...bindings] of statements) await stub.exec(sql, ...bindings);
	});
	const parallel = await time(() =>
		Promise.all(statements.map(([sql, ...bindings]) => stub.exec(sql, ...bindings))),
	);
	const batched = await time(() => stub.execMany(statements));
	const one = await stub.execMany(statements);
	const each = await Promise.all(
		statements.map(([sql, ...bindings]) => stub.exec(sql, ...bindings)),
	);
	expect(JSON.parse(JSON.stringify(one))).toEqual(JSON.parse(JSON.stringify(each)));
	console.log(
		`12 reads: sequential exec ${sequential.toFixed(2)} ms (12 round trips) · ` +
			`parallel exec ${parallel.toFixed(2)} ms (12 round trips) · ` +
			`execMany ${batched.toFixed(2)} ms (1 round trip)`,
	);
});
