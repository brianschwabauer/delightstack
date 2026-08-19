// @vitest-environment node
/**
 * One test per invariant in `04-crdt-and-history.md`.
 *
 * These are the properties the rest of the system is allowed to assume. Each is
 * a thing that, when it breaks, breaks silently and loses somebody's writing —
 * which is exactly why they are stated as invariants rather than left implicit
 * in the implementation.
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
import { applyRandomEdit, makeRandom, projectMarkdown } from './peer.js';
import { Client, createServer, MemoryBucket, type Fixture } from './server_fixture.js';

/** Project a version blob the way a consumer would: import it, then serialize. */
function markdownOf(blob: Uint8Array): string {
	const doc = new LoroDoc();
	doc.import(blob);
	return projectMarkdown(doc);
}

describe('invariant 1 — updates converge whatever order they arrive in', () => {
	it('two clients through one server end up identical to it', () => {
		const { server, close } = createServer();
		const a = new Client('a', '101');
		const b = new Client('b', '102');
		a.peer.appendBlock('the lamp was out');
		a.push(server);

		// b bootstraps from the server, then both edit concurrently.
		b.doc.import(server.syncFor('b', null).payload);
		b.peer.capture();
		a.peer.textAt(0)?.insert(0, 'A');
		b.peer.textAt(0)?.insert(0, 'B');
		a.push(server);
		b.push(server);

		// Each pulls what it is missing, in the opposite order.
		a.doc.import(server.syncFor('a', a.doc.oplogVersion().encode()).payload);
		b.doc.import(server.syncFor('b', b.doc.oplogVersion().encode()).payload);

		expect(projectMarkdown(a.doc)).toBe(projectMarkdown(b.doc));
		// …and the server agrees with both of them.
		expect(markdownOf(server.syncFor('c', null).payload)).toBe(projectMarkdown(a.doc));
		close();
	});
});

describe('invariant 2 — projection is deterministic and idempotent', () => {
	it('runs once per frontier and produces byte-identical output', async () => {
		const seen: { frontier: string; markdown: string }[] = [];
		const { server, close } = createServer({
			project: (doc, frontier) => {
				seen.push({ frontier, markdown: projectMarkdown(doc) });
			},
		});
		const a = new Client('a', '101');
		a.peer.appendBlock('the lamp was out');
		a.push(server);

		expect(await server.runProjection()).toBe(true);
		// Same frontier — nothing to do, and nothing downstream is touched.
		expect(await server.runProjection()).toBe(false);
		expect(seen).toHaveLength(1);

		// Forcing a re-run at the same frontier must produce the same bytes.
		expect(await server.runProjection({ force: true })).toBe(true);
		expect(seen[1].markdown).toBe(seen[0].markdown);
		expect(seen[1].frontier).toBe(seen[0].frontier);

		a.peer.textAt(0)?.insert(0, 'more ');
		a.push(server);
		expect(await server.runProjection()).toBe(true);
		expect(seen).toHaveLength(3);
		close();
	});
});

describe('invariant 3 — every checkpoint stays checkoutable forever', () => {
	/**
	 * The real thing, not a gesture: ~10,000 edits with 50 checkpoints scattered
	 * through them, compaction run to completion, then all 50 checked out and
	 * compared against what the document actually said at the time.
	 *
	 * This is the invariant that makes "restore any checkpoint" a promise rather
	 * than a hope, and it is the one that compaction is most able to break —
	 * which is why compaction materialises each checkpoint's snapshot *before*
	 * it deletes a single blob.
	 */
	it('10k edits, 50 checkpoints, compacted, all still readable', async () => {
		const { server, close } = createServer({ compact_threshold_bytes: 100_000 });
		const client = new Client('a', '101');
		client.peer.appendBlock('the lamp was out when she arrived');
		client.push(server);

		const random = makeRandom(20260818);
		const expected: { frontier: string; markdown: string }[] = [];
		const EDITS = 10_000;
		const CHECKPOINT_EVERY = EDITS / 50;

		for (let index = 1; index <= EDITS; index++) {
			applyRandomEdit(client.peer, random);
			client.push(server);
			if (index % CHECKPOINT_EVERY === 0) {
				const checkpoint = server.checkpoint({
					kind: 'auto_daily',
					label: `checkpoint ${expected.length + 1}`,
					actor: 'user:a',
				});
				expected.push({
					frontier: checkpoint.frontier,
					markdown: projectMarkdown(client.doc),
				});
			}
		}
		expect(expected).toHaveLength(50);

		const before = server.storageStats();
		// Not every random edit is a real change (joining the last block, moving
		// a lone block), so the log is shorter than the script.
		const logged = server.listUpdates().length;
		expect(logged).toBeGreaterThan(2000);
		// `force`, because at this shape compaction genuinely does not shrink:
		// 50 snapshots of a large document cost more than the 10,000 small op
		// blobs they replace. That is invariant 7 doing its job (the unforced
		// run below declines), and it is a real fact about checkpoint density
		// rather than a bug — see the README's retention section.
		expect((await server.compact()).skipped_reason).toBe('would_not_shrink');
		const result = await server.compact({ force: true });
		expect(result.skipped, result.skipped_reason).toBe(false);
		expect(result.updates_discarded).toBe(logged);
		expect(server.listUpdates()).toHaveLength(0);
		expect(server.storageStats().update_bytes).toBe(0);
		expect(before.update_bytes).toBeGreaterThan(0);

		// The whole point: all fifty are still exactly what they were.
		for (const point of expected) {
			expect(markdownOf(await server.getVersion(point.frontier))).toBe(point.markdown);
		}
		close();
	});

	it('a non-checkpoint version whose blobs were discarded is reported, not approximated', async () => {
		const { server, close } = createServer({ compact_threshold_bytes: 1 });
		const client = new Client('a', '101');
		client.peer.appendBlock('one');
		client.push(server);
		const mid = server.frontier;
		client.peer.textAt(0)?.insert(0, 'two ');
		client.push(server);
		server.checkpoint({ kind: 'manual', label: 'keep me', actor: 'user:a' });

		await server.compact({ force: true });
		await expect(server.getVersion(mid)).rejects.toMatchObject({
			code: 'frontier_unreachable',
			status: 410,
		});
		close();
	});
});

describe('invariant 4 — restore never removes history', () => {
	it('writes forward and leaves every earlier op in place', async () => {
		const { server, close } = createServer();
		const client = new Client('a', '101');
		client.peer.appendBlock('first line');
		client.push(server);
		const checkpoint = server.checkpoint({
			kind: 'manual',
			label: 'before',
			actor: 'user:a',
		});
		const before_markdown = projectMarkdown(client.doc);

		client.peer.textAt(0)?.insert(10, ' and a second clause');
		client.push(server);
		const ops_before_restore = server.listUpdates().length;
		expect(markdownOf(await server.getVersion(server.frontier))).not.toBe(
			before_markdown,
		);

		const restore_checkpoint = server.restore(checkpoint.frontier, 'user:a');

		expect(server.listUpdates().length).toBeGreaterThan(ops_before_restore);
		// Every op that existed still exists — history only grew.
		expect(server.listUpdates({ to: ops_before_restore })).toHaveLength(
			ops_before_restore,
		);
		expect(restore_checkpoint.kind).toBe('restore');
		// The document now says what it said at the checkpoint…
		expect(markdownOf(await server.getVersion(server.frontier))).toBe(before_markdown);
		// …and the earlier checkpoint is still there.
		expect(server.listCheckpoints().map((point) => point.id)).toContain(checkpoint.id);
		close();
	});

	it('restoring a restore is just another restore', async () => {
		const { server, close } = createServer();
		const client = new Client('a', '101');
		client.peer.appendBlock('alpha');
		client.push(server);
		const original = server.frontier;
		const original_markdown = markdownOf(await server.getVersion(original));

		client.peer.textAt(0)?.insert(5, ' beta');
		client.push(server);
		const with_beta = server.frontier;

		server.restore(original, 'user:a');
		expect(markdownOf(await server.getVersion(server.frontier))).toBe(original_markdown);

		server.restore(with_beta, 'user:a');
		expect(markdownOf(await server.getVersion(server.frontier))).toContain('beta');
		close();
	});
});

describe('invariant 5 — a duplicate op_id is a no-op', () => {
	it('does not apply twice and does not append a second row', () => {
		const { server, close } = createServer();
		const client = new Client('a', '101');
		client.peer.appendBlock('once');
		const blob = client.peer.capture() as Uint8Array;

		const first = server.applyUpdate('op-1', 'user:a', blob);
		const second = server.applyUpdate('op-1', 'user:a', blob);
		const third = server.applyUpdate('op-1', 'user:a', blob);

		expect(first.applied).toBe(true);
		expect(second.applied).toBe(false);
		expect(third.applied).toBe(false);
		expect(second.seq).toBe(first.seq);
		expect(second.frontier).toBe(first.frontier);
		expect(server.listUpdates()).toHaveLength(1);
		// The row carries the Loro peer that produced it, read from the blob's
		// own header — an out-of-order update never moves the frontier, so the
		// frontier cannot be used to identify its author.
		expect(server.listUpdates()[0].peer_id).toBe(client.doc.peerIdStr);
		close();
	});

	it('rejects an update with no op_id rather than logging an undedupable row', () => {
		const { server, close } = createServer();
		const client = new Client('a', '101');
		client.peer.appendBlock('once');
		const blob = client.peer.capture() as Uint8Array;
		expect(() => server.applyUpdate('', 'user:a', blob)).toThrowError(/op_id/);
		close();
	});
});

describe('invariant 6 — history is unaffected by renames, moves and retagging', () => {
	it('metadata writes touch neither the op log nor the frontier', () => {
		const { server, close } = createServer();
		const client = new Client('a', '101');
		client.peer.appendBlock('the lamp was out');
		client.push(server);
		const frontier = server.frontier;
		const updates = server.listUpdates();

		// A rename, a move and a retag, as this layer sees them: metadata only.
		server.setMeta('title', 'Chapter One');
		server.setMeta('parent_id', 'folder-2');
		server.setMeta('tags', JSON.stringify(['draft', 'chapter']));
		server.setMeta('title', 'Chapter One (revised)');

		expect(server.frontier).toBe(frontier);
		expect(server.listUpdates()).toEqual(updates);
		expect(server.listSessions()).toHaveLength(1);
		expect(server.meta('title')).toBe('Chapter One (revised)');
		close();
	});
});

describe('invariant 7 — compaction never increases stored bytes above the threshold', () => {
	it('rolls back a compaction that would grow a small document', async () => {
		// A handful of tiny ops, each with a checkpoint on it. Every checkpoint
		// is a mandatory snapshot, and a snapshot of even a trivial document
		// costs more than the few op blobs it stands in for — the spike measured
		// a 9-op document growing 871B → 1188B this way. Invariant 7 is only
		// true above the threshold; below it, compaction has to decline.
		const { server, close } = createServer({ compact_threshold_bytes: 0 });
		const client = new Client('a', '101');
		client.peer.appendBlock('tiny');
		client.push(server);
		for (let index = 0; index < 4; index++) {
			client.peer.textAt(0)?.insert(0, 'x');
			client.push(server);
			server.checkpoint({ kind: 'manual', label: `small ${index}`, actor: 'user:a' });
		}

		const before = server.storageStats();
		const result = await server.compact();
		expect(result.skipped).toBe(true);
		expect(result.skipped_reason).toBe('would_not_shrink');
		// Rolled back completely: nothing written, nothing deleted.
		expect(server.storageStats()).toEqual(before);
		expect(server.listUpdates()).toHaveLength(5);
		close();
	});

	it('shrinks a document whose log has outgrown its state', async () => {
		const { server, close } = createServer({ compact_threshold_bytes: 20_000 });
		const client = new Client('a', '101');
		client.peer.appendBlock('the lamp was out');
		client.push(server);
		const random = makeRandom(7);
		for (let index = 0; index < 1500; index++) {
			applyRandomEdit(client.peer, random);
			client.push(server);
		}
		server.checkpoint({ kind: 'manual', label: 'mid', actor: 'user:a' });

		const before = server.storageStats();
		const result = await server.compact();
		expect(result.skipped, result.skipped_reason).toBe(false);
		expect(result.bytes_after).toBeLessThan(before.total_bytes);
		expect(result.bytes_after).toBe(server.storageStats().total_bytes);
		close();
	});

	it('does nothing below the threshold', async () => {
		const { server, close } = createServer();
		const client = new Client('a', '101');
		client.peer.appendBlock('small');
		client.push(server);
		const result = await server.compact();
		expect(result.skipped).toBe(true);
		expect(result.skipped_reason).toBe('below_threshold');
		close();
	});

	it('keeps every blob when retention is forever', async () => {
		const { server, close } = createServer({
			compact_threshold_bytes: 0,
			retention: () => 'forever',
		});
		const client = new Client('a', '101');
		client.peer.appendBlock('kept');
		client.push(server);
		const result = await server.compact();
		expect(result.skipped_reason).toBe('retention_forever');
		expect(server.listUpdates()).toHaveLength(1);
		close();
	});
});

describe('the peer floor', () => {
	let fixture: Fixture;
	beforeEach(() => {
		fixture = createServer({ compact_threshold_bytes: 0 });
	});

	it('never trims past a peer that has not caught up', async () => {
		const { server } = fixture;
		const client = new Client('a', '101');
		client.peer.appendBlock('one');
		client.push(server);
		// A second device syncs here and then goes dark.
		const stale_seq = server.head_seq;
		server.notePeer('device-b', stale_seq);

		for (let index = 0; index < 40; index++) {
			client.peer.textAt(0)?.insert(0, 'x');
			client.push(server);
		}
		server.notePeer('device-a', server.head_seq);

		expect(server.peerFloor()).toBe(stale_seq);
		const result = await server.compact({ force: true });
		expect(result.boundary_seq).toBe(stale_seq);
		expect(result.peer_floor_seq).toBe(stale_seq);
		// Everything the dark device is missing is still on disk.
		expect(server.listUpdates({ from: stale_seq })).toHaveLength(40);

		// And it can still be caught up incrementally, which is the whole point.
		const catch_up = server.syncFor('device-b', client.doc.oplogVersion().encode());
		expect(catch_up.kind).not.toBe('reset');
		fixture.close();
	});

	it('reports peer_floor when the floor leaves nothing to discard', async () => {
		const { server } = fixture;
		const client = new Client('a', '101');
		client.peer.appendBlock('one');
		client.push(server);
		server.notePeer('device-b', 0);
		const result = await server.compact({ force: true });
		expect(result.skipped).toBe(true);
		expect(result.skipped_reason).toBe('peer_floor');
		fixture.close();
	});

	it('releases a peer that has been silent past its TTL', async () => {
		const { server, close } = createServer({
			compact_threshold_bytes: 0,
			peer_floor_ttl_ms: 1,
		});
		const client = new Client('a', '101');
		client.peer.appendBlock('one');
		client.push(server);
		server.notePeer('ghost', 1);
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(server.peerFloor()).toBeNull();
		close();
	});

	it('tells a peer that fell behind the shallow start to reset', async () => {
		const { server, close } = createServer({ compact_threshold_bytes: 0 });
		const a = new Client('a', '101');
		a.peer.appendBlock('one');
		a.push(server);

		// A device that forked early and never synced again.
		const stale = new Client('stale', '150');
		stale.doc.import(server.syncFor('stale', null).payload);
		stale.peer.capture();
		const stale_version = stale.doc.oplogVersion().encode();
		server.forgetPeer('stale');

		for (let index = 0; index < 30; index++) {
			a.peer.textAt(0)?.insert(0, 'x');
			a.push(server);
		}
		const compacted = await server.compact({ force: true });
		expect(compacted.skipped).toBe(false);

		const result = server.syncFor('stale', stale_version);
		expect(result.kind).toBe('reset');
		close();
	});
});

describe('snapshots and R2 tiering', () => {
	it('reads a version back from object storage', async () => {
		const bucket = new MemoryBucket();
		const { server, close } = createServer({
			r2: () => bucket,
			inline_snapshot_max_bytes: 1,
			compact_threshold_bytes: 0,
		});
		const client = new Client('a', '101');
		client.peer.appendBlock('the lamp was out');
		client.push(server);
		const checkpoint = server.checkpoint({
			kind: 'manual',
			label: 'kept',
			actor: 'user:a',
		});
		const expected = projectMarkdown(client.doc);

		for (let index = 0; index < 30; index++) {
			client.peer.textAt(0)?.insert(0, 'x');
			client.push(server);
		}
		await server.compact({ force: true });

		expect(bucket.objects.size).toBeGreaterThan(0);
		expect(markdownOf(await server.getVersion(checkpoint.frontier))).toBe(expected);
		close();
	});
});

describe('sessions', () => {
	it('splits on actor, on a long gap and on a checkpoint', () => {
		const { server, close } = createServer({ session_gap_ms: 1 });
		const a = new Client('a', '101');
		a.peer.appendBlock('one');
		a.push(server, 'user:a');
		a.peer.textAt(0)?.insert(0, 'x');
		a.push(server, 'user:a');
		server.checkpoint({ kind: 'manual', label: 'split here', actor: 'user:a' });
		a.peer.textAt(0)?.insert(0, 'y');
		a.push(server, 'agent:claude');

		const sessions = server.listSessions({ gap_ms: 600_000 });
		expect(sessions).toHaveLength(2);
		expect(sessions[0].actor).toBe('user:a');
		expect(sessions[0].op_count).toBe(2);
		expect(sessions[1].actor).toBe('agent:claude');
		// Listing sessions never decodes a blob — every field comes from metadata.
		expect(sessions[0].byte_size).toBeGreaterThan(0);
		close();
	});
});
