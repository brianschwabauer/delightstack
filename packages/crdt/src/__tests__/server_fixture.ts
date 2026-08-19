/**
 * Shared setup for the Durable Object suites.
 *
 * `vi.mock('cloudflare:workers', …)` cannot live here — vitest hoists it to the
 * top of the *file that calls it* — so each suite declares the mock and this
 * module supplies everything else.
 */

import { CrdtDocumentServer } from '../server/document.server.js';
import type { CrdtConfig, R2BucketLike } from '../types.js';
import { createDurableObjectState, type HarnessState } from './do_harness.js';
import { configureRichText, Peer } from './peer.js';

/** A document server wired to real SQLite, plus the state so a test can inspect it. */
export interface Fixture {
	server: CrdtDocumentServer;
	state: HarnessState;
	close(): void;
}

export function createServer(config: CrdtConfig = {}, id = 'doc-1'): Fixture {
	const state = createDurableObjectState(id);
	const server = new CrdtDocumentServer(state.ctx, {}, config);
	return { server, state, close: () => state.close() };
}

/**
 * A client of one document server.
 *
 * Mirrors what the real client does: edit locally, export the delta from the
 * last acknowledged version, hand it over with a fresh `op_id`.
 */
export class Client {
	readonly peer: Peer;
	private counter = 0;

	constructor(
		readonly key: string,
		peer_id: `${number}`,
	) {
		this.peer = new Peer(key, peer_id);
		configureRichText(this.peer.doc);
	}

	get doc() {
		return this.peer.doc;
	}

	nextOpId(): string {
		this.counter += 1;
		return `${this.key}-op-${this.counter}`;
	}

	/** Push everything committed since the last push. Returns the `op_id` used, if any. */
	push(server: CrdtDocumentServer, actor = `user:${this.key}`): string | null {
		const blob = this.peer.capture();
		if (!blob) return null;
		const op_id = this.nextOpId();
		server.applyUpdate(op_id, actor, blob);
		return op_id;
	}
}

/** An in-memory stand-in for an R2 bucket. */
export class MemoryBucket implements R2BucketLike {
	readonly objects = new Map<string, Uint8Array>();

	async get(key: string) {
		const value = this.objects.get(key);
		if (!value) return null;
		return {
			arrayBuffer: async () =>
				value.buffer.slice(
					value.byteOffset,
					value.byteOffset + value.byteLength,
				) as ArrayBuffer,
		};
	}

	async put(key: string, value: ArrayBuffer | Uint8Array) {
		this.objects.set(
			key,
			value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value),
		);
		return undefined;
	}

	async delete(key: string) {
		this.objects.delete(key);
		return undefined;
	}
}
