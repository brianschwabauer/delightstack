/**
 * The peer model the convergence harness drives.
 *
 * A deliberately small stand-in for the real document: a root movable list of
 * blocks, each block a map with a permanent `id`, a `type` and a `LoroText`.
 * That is enough to exercise everything rich-text CRDTs actually get wrong —
 * concurrent typing at one offset, a block being deleted while someone types
 * in it, a block moved while its text changes, marks that outlive their range —
 * without dragging ProseMirror into a test whose subject is merge semantics.
 *
 * Everything here is seeded. A failing scenario is a seed, and a seed is a
 * one-line regression test.
 */

import {
	LoroDoc,
	LoroMap,
	LoroText,
	VersionVector,
	type LoroMovableList,
} from '../loro.server.js';

/* -------------------------------------------------------------------------- */
/* Seeded RNG                                                                 */
/* -------------------------------------------------------------------------- */

/** mulberry32 — 32 bits of state, uniform enough, and identical everywhere. */
export function createRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface Random {
	next(): number;
	int(max: number): number;
	pick<T>(items: readonly T[]): T;
	chance(probability: number): boolean;
	word(): string;
}

const WORDS = [
	'lamp',
	'tide',
	'harbour',
	'ledger',
	'moth',
	'signal',
	'quiet',
	'iron',
	'letter',
	'winter',
];

export function makeRandom(seed: number): Random {
	const next = createRandom(seed);
	return {
		next,
		int: (max) => (max <= 0 ? 0 : Math.floor(next() * max)),
		pick: (items) => items[Math.floor(next() * items.length) % items.length],
		chance: (probability) => next() < probability,
		word: () => WORDS[Math.floor(next() * WORDS.length) % WORDS.length],
	};
}

/* -------------------------------------------------------------------------- */
/* Document shape                                                             */
/* -------------------------------------------------------------------------- */

export const BLOCK_TYPES = ['paragraph', 'heading', 'quote'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

interface BlockJson {
	id?: unknown;
	type?: unknown;
	text?: unknown;
	src?: unknown;
}

/** One peer: a Loro document plus the bookkeeping a sync simulation needs. */
export class Peer {
	readonly id: string;
	readonly doc = new LoroDoc();
	/** Version vector at the last `capture()`, so updates can be exported incrementally. */
	private captured: VersionVector;
	/** Monotonic counter behind this peer's block ids — unique across peers by construction. */
	private block_counter = 0;

	constructor(id: string, peer_id: `${number}`) {
		this.id = id;
		this.doc.setPeerId(peer_id);
		this.captured = this.doc.oplogVersion();
	}

	get blocks(): LoroMovableList {
		return this.doc.getMovableList('content');
	}

	get block_count(): number {
		return this.blocks.length;
	}

	/**
	 * The update blob covering everything committed since the last capture.
	 *
	 * `subscribeLocalUpdates` would be the natural way to collect per-commit
	 * blobs, but it is **deferred** — the callback runs after the microtask
	 * queue drains, so a synchronous test would collect nothing and then
	 * everything. Exporting from a remembered version vector is deterministic
	 * and needs no scheduling at all.
	 */
	capture(): Uint8Array | null {
		this.doc.commit();
		const version = this.doc.oplogVersion();
		if (version.compare(this.captured) === 0) return null;
		const blob = this.doc.export({ mode: 'update', from: this.captured });
		this.captured = version;
		return blob.byteLength > 0 ? blob : null;
	}

	receive(blob: Uint8Array): void {
		this.doc.import(blob);
	}

	nextBlockId(): string {
		this.block_counter += 1;
		return `${this.id}-b${this.block_counter}`;
	}

	/** Seed a block so a script always has something to edit. */
	appendBlock(text: string, type: BlockType = 'paragraph'): void {
		const block = this.blocks.insertContainer(this.blocks.length, new LoroMap());
		block.set('id', this.nextBlockId());
		block.set('type', type);
		block.setContainer('text', new LoroText()).insert(0, text);
	}

	blockAt(index: number): LoroMap | null {
		const value = this.blocks.get(index);
		return value instanceof LoroMap ? value : null;
	}

	textAt(index: number): LoroText | null {
		const block = this.blockAt(index);
		if (!block) return null;
		const text = block.get('text');
		return text instanceof LoroText ? text : null;
	}
}

/* -------------------------------------------------------------------------- */
/* Projection                                                                 */
/* -------------------------------------------------------------------------- */

const PREFIX: Record<string, string> = { paragraph: '', heading: '# ', quote: '> ' };

/**
 * A minimal markdown projection.
 *
 * The convergence assertion needs *some* deterministic serialization of the
 * document; the real dialect is a different package's problem. What matters
 * here is that it reads every container, so two peers that agree on
 * `toJSON()` but disagree on text ordering cannot both pass.
 */
export function projectMarkdown(doc: LoroDoc): string {
	const blocks = doc.getMovableList('content').toJSON() as BlockJson[];
	return blocks
		.map((block) => {
			if (block.type === 'image') return `![](${String(block.src ?? '')})`;
			const prefix = PREFIX[String(block.type)] ?? '';
			return `${prefix}${String(block.text ?? '')}`;
		})
		.join('\n\n');
}

/** Every block id in document order — duplicates included, so a test can catch them. */
export function blockIds(doc: LoroDoc): string[] {
	return (doc.getMovableList('content').toJSON() as BlockJson[])
		.map((block) => String(block.id ?? ''))
		.filter((id) => id.length > 0);
}

/* -------------------------------------------------------------------------- */
/* Edit script                                                                */
/* -------------------------------------------------------------------------- */

export type EditKind =
	| 'insert_text'
	| 'delete_text'
	| 'replace_text'
	| 'same_offset_text'
	| 'split_block'
	| 'join_block'
	| 'move_block'
	| 'format'
	| 'insert_image';

export const EDIT_KINDS: readonly EditKind[] = [
	'insert_text',
	'insert_text',
	'insert_text',
	'delete_text',
	'replace_text',
	'same_offset_text',
	'split_block',
	'join_block',
	'move_block',
	'format',
	'insert_image',
];

/**
 * Apply one random edit and commit it.
 *
 * Every branch is defensive about the document's shape, because a *concurrent*
 * peer may have deleted the block this peer was about to touch — which is the
 * situation the harness exists to provoke, not an error.
 */
export function applyRandomEdit(
	peer: Peer,
	random: Random,
	kind: EditKind = random.pick(EDIT_KINDS),
): void {
	const blocks = peer.blocks;
	if (blocks.length === 0) {
		peer.appendBlock(`${random.word()} ${random.word()}`);
		peer.doc.commit();
		return;
	}
	const index = random.int(blocks.length);

	switch (kind) {
		case 'insert_text': {
			const text = peer.textAt(index);
			if (text) text.insert(random.int(text.length + 1), ` ${random.word()}`);
			break;
		}
		case 'same_offset_text': {
			// Every peer types at offset 0 of block 0 — the canonical hard case.
			const text = peer.textAt(0);
			if (text) text.insert(0, peer.id[peer.id.length - 1] ?? 'x');
			break;
		}
		case 'delete_text': {
			const text = peer.textAt(index);
			if (text && text.length > 1) {
				const start = random.int(text.length - 1);
				text.delete(start, Math.min(1 + random.int(4), text.length - start));
			}
			break;
		}
		case 'replace_text': {
			const text = peer.textAt(index);
			if (text && text.length > 2) {
				const start = random.int(text.length - 2);
				text.delete(start, 2);
				text.insert(start, random.word());
			}
			break;
		}
		case 'split_block': {
			const text = peer.textAt(index);
			if (text && text.length > 1) {
				const at = 1 + random.int(text.length - 1);
				const tail = text.toString().slice(at);
				text.delete(at, text.length - at);
				const block = blocks.insertContainer(index + 1, new LoroMap());
				block.set('id', peer.nextBlockId());
				block.set('type', 'paragraph');
				block.setContainer('text', new LoroText()).insert(0, tail);
			}
			break;
		}
		case 'join_block': {
			if (index + 1 < blocks.length) {
				const head = peer.textAt(index);
				const tail = peer.textAt(index + 1);
				if (head && tail) {
					head.insert(head.length, tail.toString());
					blocks.delete(index + 1, 1);
				}
			}
			break;
		}
		case 'move_block': {
			if (blocks.length > 1) {
				let to = random.int(blocks.length);
				if (to === index) to = (index + 1) % blocks.length;
				blocks.move(index, to);
			}
			break;
		}
		case 'format': {
			const text = peer.textAt(index);
			if (text && text.length > 1) {
				const start = random.int(text.length - 1);
				text.mark(
					{ start, end: Math.min(start + 1 + random.int(3), text.length) },
					'bold',
					true,
				);
			}
			break;
		}
		case 'insert_image': {
			const block = blocks.insertContainer(random.int(blocks.length + 1), new LoroMap());
			block.set('id', peer.nextBlockId());
			block.set('type', 'image');
			block.set('src', `assets/${random.word()}.png`);
			break;
		}
	}
	peer.doc.commit();
}

/** Rich-text marks need an expand policy configured before any `mark()` call. */
export function configureRichText(doc: LoroDoc): void {
	doc.configTextStyle({ bold: { expand: 'after' } });
}

/* -------------------------------------------------------------------------- */
/* Assertions                                                                 */
/* -------------------------------------------------------------------------- */

/** A stable fingerprint of a document's converged content. */
export function fingerprint(doc: LoroDoc): string {
	return JSON.stringify({
		json: doc.getMovableList('content').toJSON(),
		markdown: projectMarkdown(doc),
	});
}
