/**
 * Billed rows per operation, measured in workerd.
 *
 * Prints a table (run with `--silent=false` to see it) and asserts ceilings so
 * a regression in write amplification fails the suite instead of showing up on
 * an invoice.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { fieldSchema, measure, type Cost } from './fixtures.js';
import type { TestDatabase } from './worker.js';

function stub(name: string) {
	return env.DB.get(env.DB.idFromName(name));
}

describe('billed rows per operation', () => {
	it('stays within the measured ceilings', async () => {
		await runInDurableObject(stub(`cost-${crypto.randomUUID()}`), (db: TestDatabase) => {
			const ctx = db.state;
			const rows: [string, Cost][] = [];
			const m = (label: string, fn: () => void) => {
				const cost = measure(ctx, fn);
				rows.push([label, cost]);
				return cost;
			};
			let deal: { id: string } = { id: '' };
			let person: { id: string } = { id: '' };
			let doc: { id: string } = { id: '' };
			const costs = {
				create_deal: m('create deal', () => {
					deal = db.create('deal', {
						address: '1234 Elm Street',
						city: 'Wichita',
						state: 'KS',
						postal_code: '67202',
						kind: 'purchase',
						status: 'draft',
					});
				}),
				update_plain: m('update deal.notes (plain column)', () => {
					db.update('deal', deal.id, { notes: 'call the lender' });
				}),
				update_same: m('update deal.status to its current value', () => {
					db.update('deal', deal.id, { status: 'draft' });
				}),
				update_indexed: m('update deal.status (indexed)', () => {
					db.update('deal', deal.id, { status: 'active' });
				}),
				update_searchable: m('update deal.address (searchable)', () => {
					db.update('deal', deal.id, { address: '1236 Elm Street' });
				}),
				raw_update: m('raw UPDATE deal SET notes', () => {
					db.exec(`UPDATE deal SET notes = ? WHERE id = ?`, 'raw', deal.id);
				}),
				create_person: m('create person', () => {
					person = db.create('person', {
						name: 'Jordan Buyer',
						email: 'jordan@example.com',
						phone: '+13165551234',
					});
				}),
				create_participant: m('create participant', () => {
					db.create('participant', {
						deal_id: deal.id,
						person_id: person.id,
						name: 'Jordan Buyer',
						role: 'buyer',
					});
				}),
				create_document: m('create document (200 fields, history)', () => {
					doc = db.create('document', {
						deal_id: deal.id,
						name: 'Residential Sale Contract',
						status: 'draft',
						field_values: '{}',
						field_schema: fieldSchema(),
					});
				}),
				autosave: m('update document.field_values (autosave)', () => {
					db.update('document', doc.id, { field_values: '{"field_0001":"hello"}' });
				}),
				delete_document: m('delete document', () => {
					db.delete('document', doc.id);
				}),
				get: m('get deal', () => {
					db.get('deal', deal.id);
				}),
			};
			console.log(
				'\n' +
					rows
						.map(
							([label, cost]) =>
								`${label.padEnd(44)} written=${String(cost.written).padStart(4)} read=${String(cost.read).padStart(5)} statements=${cost.statements}`,
						)
						.join('\n'),
			);
			// Ceilings: the numbers measured when this file was last changed, so
			// the suite fails on any regression. Lower them when an optimisation
			// lands. (Before the SQL-first work: create deal 49, update plain 8,
			// autosave 10, delete document 45 written / 102 read.)
			expect(costs.update_plain.written).toBeLessThanOrEqual(3);
			expect(costs.update_same.written).toBe(0);
			expect(costs.update_indexed.written).toBeLessThanOrEqual(4);
			expect(costs.autosave.written).toBeLessThanOrEqual(8);
			expect(costs.create_deal.written).toBeLessThanOrEqual(30);
			expect(costs.create_participant.written).toBeLessThanOrEqual(15);
			expect(costs.delete_document.written).toBeLessThanOrEqual(25);
			expect(costs.delete_document.read).toBeLessThanOrEqual(45);
			// A raw write is now fully caught up (index, sync stamp, broadcast),
			// which costs a few rows on top of the row itself.
			expect(costs.raw_update.written).toBeLessThanOrEqual(7);
		});
	});
});
