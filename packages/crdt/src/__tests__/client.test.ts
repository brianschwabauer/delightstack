// @vitest-environment node
/**
 * The client half, against the real document server.
 *
 * ## How OPFS is tested — and what that does not cover
 *
 * OPFS does not exist in Node, and neither `happy-dom` nor `jsdom` implements
 * `navigator.storage.getDirectory()`, let alone `createSyncAccessHandle()`. The
 * options were a hand-written fake filesystem or a fake *store*. A fake
 * filesystem would have been the more impressive-looking choice and would have
 * tested the fake: the OPFS calls this package makes are three
 * (`getDirectoryHandle`, `createWritable`, `createSyncAccessHandle`), and a
 * reimplementation of them proves nothing about how Chrome behaves.
 *
 * So the split is: `MemoryCrdtStorage` stands behind the same `CrdtStorage`
 * interface and stores **the same framed bytes** the OPFS backend writes, which
 * puts the parts that carry real risk — record framing, ack tombstones, log
 * replay across a simulated reload, snapshot folding with unacked blobs
 * re-appended, and the quota sweeper's refusal to drop unacked work — under
 * test for real. `decodePendingLog` is tested directly, including a truncated
 * tail.
 *
 * Not covered, and stated so nobody assumes otherwise:
 *
 * - that `createSyncAccessHandle().write()` really is synchronous in a browser;
 * - the main-thread `createWritable({ keepExistingData: true })` positional
 *   append path;
 * - the exclusive-handle contention between two workers on one origin;
 * - OPFS quota errors and eviction by the browser itself.
 *
 * Those need a browser, and per the project's testing rules that verification
 * is done by driving the real app, not by an e2e suite.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
	DurableObject: class {
		readonly ctx: DurableObjectState;
		readonly env: unknown;
		constructor(ctx: DurableObjectState, env: unknown) {
			this.ctx = ctx;
			this.env = env;
		}
	},
}));

import { LoroDoc } from '../loro.server.js';
import {
	CrdtClient,
	MemoryCrdtStorage,
	decodePendingLog,
	encodeAckRecord,
	encodeUpdateRecord,
	type CrdtHandle,
} from '../client/index.js';
import { LoopbackNetwork, tick, waitFor, type LoopbackTransport } from './client_harness.js';

const NODE_ID = 'node-1';

/** Read the document's text the same way both halves would. */
function textOf(doc: { getText(id: string): { toString(): string } }): string {
	return doc.getText('content').toString();
}

function write(handle: CrdtHandle, at: number, value: string): void {
	handle.transact((doc) => doc.getText('content').insert(at, value));
}

describe('pending log framing', () => {
	it('replays updates in order and applies ack tombstones', () => {
		const log = [
			encodeUpdateRecord({
				op_id: 'a',
				actor: 'user:x',
				local: true,
				blob: new Uint8Array([1]),
			}),
			encodeUpdateRecord({
				op_id: null,
				actor: null,
				local: false,
				blob: new Uint8Array([2, 3]),
			}),
			encodeUpdateRecord({
				op_id: 'b',
				actor: 'user:x',
				local: true,
				blob: new Uint8Array([4]),
			}),
			encodeAckRecord('a'),
		];
		const bytes = new Uint8Array(log.reduce((n, chunk) => n + chunk.length, 0));
		let offset = 0;
		for (const chunk of log) {
			bytes.set(chunk, offset);
			offset += chunk.length;
		}

		const records = decodePendingLog(bytes);
		expect(records.map((record) => record.op_id)).toEqual(['a', null, 'b']);
		expect(records.map((record) => record.local)).toEqual([false, false, true]);
		expect([...records[1].blob]).toEqual([2, 3]);
	});

	it('drops a truncated tail rather than failing to open', () => {
		const good = encodeUpdateRecord({
			op_id: 'a',
			actor: 'user:x',
			local: true,
			blob: new Uint8Array([1, 2, 3]),
		});
		const partial = encodeUpdateRecord({
			op_id: 'b',
			actor: 'user:x',
			local: true,
			blob: new Uint8Array([4, 5, 6]),
		}).subarray(0, 7);
		const bytes = new Uint8Array(good.length + partial.length);
		bytes.set(good, 0);
		bytes.set(partial, good.length);

		expect(decodePendingLog(bytes).map((record) => record.op_id)).toEqual(['a']);
	});
});

describe('offline durability', () => {
	let network: LoopbackNetwork;

	beforeEach(() => {
		network = new LoopbackNetwork();
		return () => network.close();
	});

	it('an edit made offline survives a reload', async () => {
		const storage = new MemoryCrdtStorage();
		const transport = network.transport('device-a');
		transport.connected = false;

		const first = new CrdtClient({
			transport,
			storage,
			actor: 'user:a',
			bootstrap_timeout_ms: 5,
		});
		const handle = await first.open(NODE_ID);
		await handle.ready();
		write(handle, 0, 'offline work');
		expect(first.pending_count).toBe(1);
		expect(first.sync_state).toBe('offline');
		await first.flush();

		// A hard reload: a brand-new client over the same bytes on disk, still
		// with no network, so nothing can be acked out from under the assertion.
		const reload_transport = network.transport('device-a');
		reload_transport.connected = false;
		const second = new CrdtClient({
			transport: reload_transport,
			storage,
			actor: 'user:a',
			bootstrap_timeout_ms: 5,
		});
		const reopened = await second.open(NODE_ID);
		await reopened.ready();
		expect(textOf(reopened.doc)).toBe('offline work');
		// The op_id survived too, which is what makes the resend possible.
		expect(reopened.pending_count).toBe(1);
	});

	it('a folded snapshot keeps unacked blobs resendable', async () => {
		const storage = new MemoryCrdtStorage();
		const transport = network.transport('device-a');
		transport.connected = false;

		const client = new CrdtClient({
			transport,
			storage,
			actor: 'user:a',
			bootstrap_timeout_ms: 5,
			snapshot_every: 2,
		});
		const handle = await client.open(NODE_ID);
		await handle.ready();
		write(handle, 0, 'one ');
		write(handle, 4, 'two ');
		write(handle, 8, 'three');
		await client.flush();

		const reload_transport = network.transport('device-a');
		reload_transport.connected = false;
		const reloaded = new CrdtClient({
			transport: reload_transport,
			storage,
			actor: 'user:a',
			bootstrap_timeout_ms: 5,
		});
		const reopened = await reloaded.open(NODE_ID);
		await reopened.ready();
		expect(textOf(reopened.doc)).toBe('one two three');
		expect(reopened.pending_count).toBe(3);
	});
});

describe('the bootstrap gate', () => {
	let network: LoopbackNetwork;

	beforeEach(() => {
		network = new LoopbackNetwork();
		return () => network.close();
	});

	/**
	 * The failure the gate exists to prevent, demonstrated against the real
	 * server. Read this one before changing anything in `open()`.
	 */
	it('a client that writes before its first sync can never be bootstrapped', async () => {
		const served = network.doc(NODE_ID);
		// Give the server a document with real history, then compact it, so its
		// retained history starts above zero — an ordinary long-lived document.
		const author = new LoroDoc();
		for (let index = 0; index < 40; index++) {
			author
				.getText('content')
				.insert(author.getText('content').length, `line ${index}\n`);
			author.commit();
			served.server.applyUpdate(
				`op-${index}`,
				'user:author',
				author.export({ mode: 'snapshot' }),
			);
		}
		served.server.checkpoint({ kind: 'manual', label: 'v1', actor: 'user:author' });
		await served.server.compact({ force: true });

		// The trap: an editor mounted before the first sync writes one operation
		// into an empty document.
		const dirty = new LoroDoc();
		dirty.getText('content').insert(0, '');
		dirty.getMap('meta').set('schema_version', 1);
		dirty.commit();

		const result = served.server.syncFor('naive-device', dirty.oplogVersion().encode());
		// The server can see what the client cannot: this peer is behind the
		// shallow start and nothing can merge in either direction.
		expect(result.kind).toBe('reset');

		// And if the client had imported it anyway, nothing would have thrown.
		dirty.import(result.payload);
		expect(textOf(dirty)).not.toContain('line 0');

		// A client that stayed empty is the always-works special case.
		const clean = new LoroDoc();
		clean.import(served.server.syncFor('clean-device', null).payload);
		expect(textOf(clean)).toContain('line 39');
	});

	it('refuses transact() until ready(), then opens with the server content', async () => {
		const served = network.doc(NODE_ID);
		const author = new LoroDoc();
		author.getText('content').insert(0, 'server text');
		author.commit();
		served.server.applyUpdate('op-1', 'user:author', author.export({ mode: 'snapshot' }));
		await served.server.compact({ force: true });

		const client = new CrdtClient({
			transport: network.transport('device-a'),
			storage: new MemoryCrdtStorage(),
			actor: 'user:a',
		});
		const handle = await client.open(NODE_ID);

		// The gate has teeth. Documenting the ordering was not enough for the spike.
		expect(handle.loading).toBe(true);
		expect(() => write(handle, 0, 'x')).toThrowError(/still opening/);

		await handle.ready();
		expect(handle.loading).toBe(false);
		expect(textOf(handle.doc)).toBe('server text');

		// And now editing on top of a compacted server works.
		write(handle, textOf(handle.doc).length, ' + local');
		await waitFor(() => client.pending_count === 0, { label: 'the edit to be acked' });
	});

	it('opens offline after the bootstrap timeout, and stays writable', async () => {
		const transport = network.transport('device-a');
		transport.connected = false;
		const client = new CrdtClient({
			transport,
			storage: new MemoryCrdtStorage(),
			actor: 'user:a',
			bootstrap_timeout_ms: 20,
		});
		const handle = await client.open(NODE_ID);
		expect(handle.loading).toBe(true);
		await handle.ready();
		expect(handle.loading).toBe(false);
		write(handle, 0, 'first run, no network');
		expect(textOf(handle.doc)).toBe('first run, no network');
	});

	it('local content clears the gate without waiting for the server', async () => {
		const storage = new MemoryCrdtStorage();
		const offline = network.transport('device-a');
		offline.connected = false;
		const first = new CrdtClient({
			transport: offline,
			storage,
			actor: 'user:a',
			bootstrap_timeout_ms: 5,
		});
		const handle = await first.open(NODE_ID);
		await handle.ready();
		write(handle, 0, 'local');
		await first.flush();

		// A reload with a bootstrap timeout long enough to fail the test if the
		// gate waited for it.
		const second = new CrdtClient({
			transport: network.transport('device-a'),
			storage,
			actor: 'user:a',
			bootstrap_timeout_ms: 60_000,
		});
		const reopened = await second.open(NODE_ID);
		expect(reopened.loading).toBe(false);
	});
});

describe('reconnect', () => {
	let network: LoopbackNetwork;

	beforeEach(() => {
		network = new LoopbackNetwork();
		return () => network.close();
	});

	it('resends unacked blobs in order, and duplicates are a no-op', async () => {
		const served = network.doc(NODE_ID);
		network.ack_enabled = false; // the ack never arrives, so nothing is dropped
		const transport = network.transport('device-a');
		const client = new CrdtClient({
			transport,
			storage: new MemoryCrdtStorage(),
			actor: 'user:a',
			bootstrap_timeout_ms: 5,
			send_debounce_ms: 0,
		});
		const handle = await client.open(NODE_ID);
		await handle.ready();

		// A tick between each write so the debounce window closes and the three
		// commits stay three separate blobs — this test is about resend order,
		// and the coalescing path has its own test below.
		write(handle, 0, 'a');
		await tick(30);
		write(handle, 1, 'b');
		await tick(30);
		write(handle, 2, 'c');
		await tick(30);

		const first_pass = [...served.received];
		expect(first_pass).toHaveLength(3);
		expect(client.pending_count).toBe(3);
		const rows_before = served.server.listUpdates({}).length;

		transport.setConnected(false);
		expect(client.sync_state).toBe('offline');
		transport.setConnected(true);
		await tick(30);

		// Same op_ids, same order — the server's dedupe only works if the client
		// does not re-mint them on a resend.
		const resent = served.received.slice(first_pass.length);
		expect(resent).toEqual(first_pass);
		expect(served.server.listUpdates({}).length).toBe(rows_before);
		expect(textOf(served.server.document)).toBe('abc');
	});

	it('coalesces an offline burst into one update on reconnect', async () => {
		const served = network.doc(NODE_ID);
		const transport = network.transport('device-a');
		transport.connected = false;
		const client = new CrdtClient({
			transport,
			storage: new MemoryCrdtStorage(),
			actor: 'user:a',
			bootstrap_timeout_ms: 5,
			send_debounce_ms: 0,
		});
		const handle = await client.open(NODE_ID);
		await handle.ready();
		for (const [index, letter] of [...'offline'].entries()) write(handle, index, letter);
		expect(client.pending_count).toBe(7);

		transport.setConnected(true);
		await tick(20);

		// One blob, not seven — the seven commits were re-exported from the version
		// vector the first one started at. It may be *delivered* twice (the
		// debounce timer and the post-handshake resend can race), but it carries
		// one `op_id`, so the server applies it once.
		expect(new Set(served.received).size).toBe(1);
		expect(served.server.listUpdates({})).toHaveLength(1);
		expect(textOf(served.server.document)).toBe('offline');
		expect(client.pending_count).toBe(0);
		expect(client.sync_state).toBe('synced');
	});

	it('merges two devices that both edited while partitioned', async () => {
		const storage_a = new MemoryCrdtStorage();
		const storage_b = new MemoryCrdtStorage();
		const transport_a = network.transport('device-a');
		const transport_b = network.transport('device-b');
		const client_a = new CrdtClient({
			transport: transport_a,
			storage: storage_a,
			actor: 'user:a',
			bootstrap_timeout_ms: 5,
			send_debounce_ms: 0,
		});
		const client_b = new CrdtClient({
			transport: transport_b,
			storage: storage_b,
			actor: 'user:b',
			bootstrap_timeout_ms: 5,
			send_debounce_ms: 0,
		});
		const handle_a = await client_a.open(NODE_ID);
		const handle_b = await client_b.open(NODE_ID);
		await handle_a.ready();
		await handle_b.ready();

		transport_a.setConnected(false);
		transport_b.setConnected(false);
		write(handle_a, 0, 'AAA');
		write(handle_b, 0, 'BBB');
		expect(textOf(handle_a.doc)).not.toBe(textOf(handle_b.doc));

		transport_a.setConnected(true);
		await tick(10);
		transport_b.setConnected(true);
		await tick(10);
		// B's reconnect pushed its ops; A needs one more exchange to hear them.
		transport_a.setConnected(false);
		transport_a.setConnected(true);
		await tick(10);

		expect(textOf(handle_a.doc)).toBe(textOf(handle_b.doc));
		expect(textOf(handle_a.doc)).toContain('AAA');
		expect(textOf(handle_a.doc)).toContain('BBB');
	});
});

describe('eviction and quota', () => {
	let network: LoopbackNetwork;

	beforeEach(() => {
		network = new LoopbackNetwork();
		return () => network.close();
	});

	it('evict() writes a snapshot, drops the instance, and open() restores it', async () => {
		const storage = new MemoryCrdtStorage();
		const client = new CrdtClient({
			transport: network.transport('device-a'),
			storage,
			actor: 'user:a',
			bootstrap_timeout_ms: 5,
			send_debounce_ms: 0,
		});
		const handle = await client.open(NODE_ID);
		await handle.ready();
		write(handle, 0, 'evict me');
		await waitFor(() => client.pending_count === 0, { label: 'the edit to be acked' });

		client.close(NODE_ID);
		await client.evict(NODE_ID);
		expect(client.listOpen()).toEqual([]);
		expect(storage.docs.get(NODE_ID)?.snapshot).toBeTruthy();
		expect(storage.docs.get(NODE_ID)?.log).toHaveLength(0);

		const reopened = await client.open(NODE_ID);
		await reopened.ready();
		expect(textOf(reopened.doc)).toBe('evict me');
		expect(reopened).not.toBe(handle);
	});

	it('a document with unacked commits is not idle-evicted', async () => {
		network.ack_enabled = false;
		const client = new CrdtClient({
			transport: network.transport('device-a'),
			storage: new MemoryCrdtStorage(),
			actor: 'user:a',
			bootstrap_timeout_ms: 5,
			send_debounce_ms: 0,
			idle_evict_ms: 5,
		});
		const handle = await client.open(NODE_ID);
		await handle.ready();
		write(handle, 0, 'unacked');
		await tick(10);

		client.close(NODE_ID);
		await waitFor(() => client.listOpen().length === 1, { label: 'the idle sweep to settle' });
		expect(client.listOpen()).toEqual([NODE_ID]);
	});

	it('quota eviction drops LRU bodies but never unacked work', async () => {
		const storage = new MemoryCrdtStorage();
		const transport = network.transport('device-a');
		const client = new CrdtClient({
			transport,
			storage,
			actor: 'user:a',
			bootstrap_timeout_ms: 5,
			send_debounce_ms: 0,
		});

		// `cold` is acked and then evicted — an ordinary LRU candidate.
		const cold = await client.open('cold');
		await cold.ready();
		write(cold, 0, 'cold body');
		await tick(10);
		client.close('cold');
		await client.evict('cold');

		// `unacked` holds work the server has never seen.
		network.ack_enabled = false;
		const unacked = await client.open('unacked');
		await unacked.ready();
		write(unacked, 0, 'unacked body');
		await tick(10);
		transport.setConnected(false);
		client.close('unacked');
		await client.evict('unacked');

		expect((await storage.list()).map((meta) => meta.node_id).sort()).toEqual([
			'cold',
			'unacked',
		]);
		expect((await storage.list()).find((meta) => meta.node_id === 'unacked')?.has_unacked).toBe(
			true,
		);

		// A quota small enough that everything is over it. The sweeper still
		// refuses to touch the document holding unsynced work.
		const squeezed = new CrdtClient({
			transport: network.transport('device-b'),
			storage,
			actor: 'user:a',
			quota_bytes: 32,
		});
		await squeezed.enforceQuota();

		expect((await storage.list()).map((meta) => meta.node_id)).toEqual(['unacked']);
	});

	it('a resident document is never dropped for quota', async () => {
		const storage = new MemoryCrdtStorage();
		const transport = network.transport('device-a');
		transport.connected = false;
		const client = new CrdtClient({
			transport,
			storage,
			actor: 'user:a',
			bootstrap_timeout_ms: 5,
			quota_bytes: 1,
		});
		const handle = await client.open(NODE_ID);
		await handle.ready();
		write(handle, 0, 'resident');
		await client.enforceQuota();
		expect(textOf(handle.doc)).toBe('resident');
		expect(client.listOpen()).toEqual([NODE_ID]);
	});
});

describe('sync state', () => {
	let network: LoopbackNetwork;

	beforeEach(() => {
		network = new LoopbackNetwork();
		return () => network.close();
	});

	it('reports offline, syncing and synced', async () => {
		network.ack_enabled = false;
		const transport = network.transport('device-a');
		const client = new CrdtClient({
			transport,
			storage: new MemoryCrdtStorage(),
			actor: 'user:a',
			bootstrap_timeout_ms: 5,
			send_debounce_ms: 0,
		});
		const handle = await client.open(NODE_ID);
		await handle.ready();
		expect(client.sync_state).toBe('synced');

		write(handle, 0, 'x');
		expect(client.sync_state).toBe('syncing');

		transport.setConnected(false);
		expect(client.sync_state).toBe('offline');
	});

	it('a reset is surfaced, never applied silently', async () => {
		const served = network.doc(NODE_ID);
		const storage = new MemoryCrdtStorage();
		const transport = network.transport('device-a');
		transport.connected = false;

		// A device that did all its work offline, then the server compacted past it.
		const client = new CrdtClient({
			transport,
			storage,
			actor: 'user:a',
			bootstrap_timeout_ms: 5,
			send_debounce_ms: 0,
			on_reset: (info) => resets.push(info),
		});
		const resets: { node_id: string; unacked_ops: number }[] = [];
		const handle = await client.open(NODE_ID);
		await handle.ready();
		write(handle, 0, 'work the server never saw');

		const author = new LoroDoc();
		for (let index = 0; index < 20; index++) {
			author.getText('content').insert(author.getText('content').length, `x${index}`);
			author.commit();
			served.server.applyUpdate(
				`op-${index}`,
				'user:author',
				author.export({ mode: 'snapshot' }),
			);
		}
		await served.server.compact({ force: true });

		transport.setConnected(true);
		await tick(10);

		expect(resets).toEqual([{ node_id: NODE_ID, unacked_ops: 1 }]);
		expect(client.sync_state).toBe('error');
		// The local text is untouched: nothing was discarded on the user's behalf.
		expect(textOf(handle.doc)).toBe('work the server never saw');
		expect(() => write(handle, 0, 'more')).toThrowError(/too far behind/);

		// The documented recovery path.
		await client.purge(NODE_ID);
		const fresh = await client.open(NODE_ID);
		await fresh.ready();
		expect(textOf(fresh.doc)).toContain('x19');
	});
});
