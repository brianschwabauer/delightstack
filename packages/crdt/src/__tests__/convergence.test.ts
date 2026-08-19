// @vitest-environment node
/**
 * The convergence harness — the most important test in the package.
 *
 * Merge bugs do not throw. They produce a document that is *plausible* and
 * quietly different on one device, and nobody notices until a paragraph is
 * gone. Reading the code cannot find them; only running many randomized,
 * reproducible scenarios can.
 *
 * ## Scenario shape
 *
 * N peers (2–5) fork from a common base, each runs a random edit script, the
 * network partitions and heals at random points, and every update is delivered
 * to every peer in a random order **with duplicates**. Then all peers are
 * flushed to quiescence and must agree on content, markdown projection, block
 * ids and version vector.
 *
 * ## Scenario count
 *
 * 50 by default — the CI budget. Set `CRDT_SCENARIOS=500` for the nightly run.
 * Failures print their seed; a seed goes into `REGRESSION_SEEDS` below and
 * becomes a permanent case.
 */

import { describe, expect, it } from 'vitest';
import { LoroDoc, LoroMap, LoroText, VersionVector } from '../loro.server.js';
import {
	applyRandomEdit,
	blockIds,
	configureRichText,
	fingerprint,
	makeRandom,
	Peer,
	projectMarkdown,
	type Random,
} from './peer.js';

const SCENARIO_COUNT = Number(process.env.CRDT_SCENARIOS ?? 50);

/**
 * Seeds that once failed. None so far — the list exists so the next one has an
 * obvious home rather than being "fixed" by rerunning with a different seed.
 */
const REGRESSION_SEEDS: number[] = [];

/* -------------------------------------------------------------------------- */
/* Simulation                                                                 */
/* -------------------------------------------------------------------------- */

/** One update in flight, addressed to one peer. */
interface Envelope {
	to: number;
	blob: Uint8Array;
}

/** Build `count` peers that all start from the same base document. */
function spawnPeers(count: number, base_paragraphs: number, random: Random): Peer[] {
	const origin = new Peer('base', '1');
	configureRichText(origin.doc);
	for (let index = 0; index < base_paragraphs; index++) {
		origin.appendBlock(`${random.word()} ${random.word()} ${random.word()}`);
	}
	origin.doc.commit();
	const base = origin.doc.export({ mode: 'snapshot' });

	const peers: Peer[] = [];
	for (let index = 0; index < count; index++) {
		// Peer ids start at 100 so they cannot collide with the base document's.
		const peer = new Peer(`p${index}`, `${100 + index}`);
		configureRichText(peer.doc);
		peer.receive(base);
		peer.capture();
		peers.push(peer);
	}
	return peers;
}

/**
 * Run one full scenario and assert convergence.
 *
 * Delivery deliberately models a badly behaved network: every blob is queued
 * for every other peer, the queue is shuffled, ~20% of envelopes are duplicated
 * and delivered twice, and a partitioned peer's inbox is held back until it
 * reconnects. Loro's `import` must be idempotent and order-independent under
 * all of that; the harness is what proves it rather than assuming it.
 */
function runScenario(seed: number): void {
	const random = makeRandom(seed);
	const peer_count = 2 + random.int(4);
	const peers = spawnPeers(peer_count, 1 + random.int(3), random);
	const rounds = 8 + random.int(25);

	let queue: Envelope[] = [];
	const partitioned = new Set<number>();

	const broadcast = (from: number, blob: Uint8Array): void => {
		for (let to = 0; to < peers.length; to++) {
			if (to === from) continue;
			queue.push({ to, blob });
			// Duplicate delivery: the same bytes arriving twice must be a no-op.
			if (random.chance(0.2)) queue.push({ to, blob });
		}
	};

	for (let round = 0; round < rounds; round++) {
		// Partition / heal.
		if (random.chance(0.25)) {
			const index = random.int(peers.length);
			if (partitioned.has(index)) partitioned.delete(index);
			else if (partitioned.size < peers.length - 1) partitioned.add(index);
		}

		for (let index = 0; index < peers.length; index++) {
			const edits = 1 + random.int(4);
			for (let edit = 0; edit < edits; edit++) applyRandomEdit(peers[index], random);
			const blob = peers[index].capture();
			if (blob) broadcast(index, blob);
		}

		// Deliver a random prefix of the queue, out of order, skipping partitions.
		shuffle(queue, random);
		const deliverable: Envelope[] = [];
		const held: Envelope[] = [];
		for (const envelope of queue) {
			(partitioned.has(envelope.to) ? held : deliverable).push(envelope);
		}
		const cut = random.int(deliverable.length + 1);
		for (let index = 0; index < cut; index++) {
			peers[deliverable[index].to].receive(deliverable[index].blob);
		}
		queue = [...deliverable.slice(cut), ...held];
	}

	// Heal everything and run delivery to quiescence.
	partitioned.clear();
	for (let pass = 0; pass < peers.length + 2; pass++) {
		for (let index = 0; index < peers.length; index++) {
			const blob = peers[index].capture();
			if (blob) broadcast(index, blob);
		}
		shuffle(queue, random);
		for (const envelope of queue) peers[envelope.to].receive(envelope.blob);
		// Redeliver once: an out-of-causal-order blob may have been parked as
		// pending, and the peer that produced its dependency may not have
		// broadcast yet.
		queue = [];
	}
	// Final full mesh exchange, so nothing is left pending anywhere.
	for (let pass = 0; pass < 2; pass++) {
		for (let from = 0; from < peers.length; from++) {
			const blob = peers[from].doc.export({ mode: 'snapshot' });
			for (let to = 0; to < peers.length; to++) if (to !== from) peers[to].receive(blob);
		}
	}

	const expected = fingerprint(peers[0].doc);
	for (const peer of peers) {
		expect(fingerprint(peer.doc), `seed ${seed}: peer ${peer.id} diverged`).toBe(
			expected,
		);
		expect(
			peers[0].doc.oplogVersion().compare(peer.doc.oplogVersion()),
			`seed ${seed}: peer ${peer.id} is at a different version`,
		).toBe(0);
		const ids = blockIds(peer.doc);
		expect(new Set(ids).size, `seed ${seed}: duplicate block id on ${peer.id}`).toBe(
			ids.length,
		);
	}
}

function shuffle<T>(items: T[], random: Random): void {
	for (let index = items.length - 1; index > 0; index--) {
		const swap = random.int(index + 1);
		[items[index], items[swap]] = [items[swap], items[index]];
	}
}

/* -------------------------------------------------------------------------- */
/* Randomized suite                                                           */
/* -------------------------------------------------------------------------- */

describe('convergence', () => {
	it(`converges across ${SCENARIO_COUNT} randomized scenarios`, () => {
		for (let index = 0; index < SCENARIO_COUNT; index++)
			runScenario(0x5eed + index * 7919);
	});

	it.each(REGRESSION_SEEDS)('converges for regression seed %i', (seed) => {
		runScenario(seed);
	});
});

/* -------------------------------------------------------------------------- */
/* The known-hard cases, stated explicitly                                    */
/* -------------------------------------------------------------------------- */

describe('known-hard merges', () => {
	function pair(): [Peer, Peer] {
		const a = new Peer('pa', '101');
		const b = new Peer('pb', '102');
		configureRichText(a.doc);
		configureRichText(b.doc);
		a.appendBlock('the lamp was out');
		a.appendBlock('she lit it anyway');
		a.doc.commit();
		b.receive(a.doc.export({ mode: 'snapshot' }));
		a.capture();
		b.capture();
		return [a, b];
	}

	function exchange(a: Peer, b: Peer): void {
		const from_a = a.capture();
		const from_b = b.capture();
		if (from_a) b.receive(from_a);
		if (from_b) a.receive(from_b);
	}

	it('two peers typing at the same offset converge', () => {
		const [a, b] = pair();
		for (let index = 0; index < 20; index++) {
			a.textAt(0)?.insert(0, 'A');
			b.textAt(0)?.insert(0, 'B');
			a.doc.commit();
			b.doc.commit();
		}
		exchange(a, b);
		expect(fingerprint(a.doc)).toBe(fingerprint(b.doc));
		// Nothing is lost: 20 of each character survive.
		const text = a.textAt(0)?.toString() ?? '';
		expect(text.split('A').length - 1).toBe(20);
		expect(text.split('B').length - 1).toBe(20);
	});

	it('deleting a block another peer is editing converges', () => {
		const [a, b] = pair();
		b.textAt(1)?.insert(0, 'still typing here — ');
		b.doc.commit();
		a.blocks.delete(1, 1);
		a.doc.commit();
		exchange(a, b);
		expect(fingerprint(a.doc)).toBe(fingerprint(b.doc));
		// The delete wins over the concurrent edit — the point is that both
		// peers agree, not which side wins.
		expect(a.block_count).toBe(b.block_count);
	});

	it('a peer offline for 1,000 operations reconnects cleanly', () => {
		const [a, b] = pair();
		const random = makeRandom(4242);
		for (let index = 0; index < 1000; index++) applyRandomEdit(a, random);
		b.textAt(0)?.insert(0, 'meanwhile ');
		b.doc.commit();
		exchange(a, b);
		expect(fingerprint(a.doc)).toBe(fingerprint(b.doc));
		// Both sides hold every operation — nothing was dropped for being old.
		expect(a.doc.oplogVersion().compare(b.doc.oplogVersion())).toBe(0);
	});

	it('the same update delivered twice is a no-op', () => {
		const [a, b] = pair();
		a.textAt(0)?.insert(0, 'once ');
		a.doc.commit();
		const blob = a.capture();
		expect(blob).not.toBeNull();
		b.receive(blob as Uint8Array);
		const after_first = fingerprint(b.doc);
		b.receive(blob as Uint8Array);
		b.receive(blob as Uint8Array);
		expect(fingerprint(b.doc)).toBe(after_first);
		expect(projectMarkdown(b.doc).split('once ').length - 1).toBe(1);
	});

	it('updates delivered out of causal order converge once the gap fills', () => {
		const [a, b] = pair();
		a.textAt(0)?.insert(0, 'first ');
		a.doc.commit();
		const first = a.capture() as Uint8Array;
		a.textAt(0)?.insert(0, 'second ');
		a.doc.commit();
		const second = a.capture() as Uint8Array;

		// The dependent update arrives before the one it depends on. Loro parks
		// it rather than applying or rejecting it.
		b.receive(second);
		expect(projectMarkdown(b.doc)).not.toContain('second');
		b.receive(first);
		expect(fingerprint(b.doc)).toBe(fingerprint(a.doc));
	});

	it('a compacted peer merges with an uncompacted one', () => {
		const [a, b] = pair();
		const random = makeRandom(99);
		for (let index = 0; index < 40; index++) applyRandomEdit(a, random);
		exchange(a, b);

		// "Compacted": rebuilt from a shallow snapshot, so its history before
		// the shallow start is gone.
		const shallow = a.doc.export({
			mode: 'shallow-snapshot',
			frontiers: a.doc.frontiers(),
		});
		const compacted = new LoroDoc();
		configureRichText(compacted);
		compacted.setPeerId('103');
		compacted.import(shallow);
		expect(compacted.isShallow()).toBe(true);
		expect(projectMarkdown(compacted)).toBe(projectMarkdown(a.doc));

		// The uncompacted peer is at or past the shallow start, so an
		// incremental exchange in both directions is still legal.
		const inserted = compacted
			.getMovableList('content')
			.insertContainer(0, new LoroMap());
		inserted.set('id', 'compacted-1');
		inserted.set('type', 'paragraph');
		inserted.setContainer('text', new LoroText()).insert(0, 'from the compacted peer');
		compacted.commit();

		b.textAt(0)?.insert(0, 'from-b ');
		b.doc.commit();

		const shallow_since = compacted.shallowSinceVV();
		const b_version = b.doc.oplogVersion();
		const order = shallow_since.compare(b_version);
		expect(order === -1 || order === 0).toBe(true);

		b.doc.import(compacted.export({ mode: 'update', from: b_version }));
		compacted.import(b.doc.export({ mode: 'update', from: compacted.oplogVersion() }));

		expect(projectMarkdown(compacted)).toBe(projectMarkdown(b.doc));
	});

	it('a peer behind the shallow start cannot be served incrementally — and it is detectable', () => {
		// The silent failure the server has to guard against: an import that
		// reports success and changes nothing.
		const a = new Peer('pa', '101');
		configureRichText(a.doc);
		a.appendBlock('first');
		a.doc.commit();
		const early_version = a.doc.oplogVersion();
		for (let index = 0; index < 10; index++) {
			a.textAt(0)?.insert(0, 'x');
			a.doc.commit();
		}
		const shallow = a.doc.export({
			mode: 'shallow-snapshot',
			frontiers: a.doc.frontiers(),
		});
		const compacted = new LoroDoc();
		compacted.import(shallow);

		// A peer stuck at `early_version` is before the shallow start.
		const order = compacted.shallowSinceVV().compare(early_version);
		expect(order === -1 || order === 0).toBe(false);

		// And this is what happens if the server does not check: a document with
		// one local op imports the shallow snapshot and stays exactly as it was.
		const stale = new Peer('stale', '150');
		configureRichText(stale.doc);
		stale.appendBlock('local only');
		stale.doc.commit();
		const before = projectMarkdown(stale.doc);
		const status = stale.doc.import(shallow);
		expect(status).toBeDefined();
		expect(projectMarkdown(stale.doc)).toBe(before);
	});

	it('an empty version vector still encodes to a non-zero length', () => {
		// Spike finding 5: the obvious cold-peer test never fires.
		const empty = new VersionVector(null);
		expect(empty.encode().length).toBeGreaterThan(0);
		expect(empty.length()).toBe(0);
	});
});
