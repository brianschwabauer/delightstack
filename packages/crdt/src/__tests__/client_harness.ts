/**
 * A loopback network for the client suite.
 *
 * The client is tested against the **real** `CrdtDocumentServer` over real
 * SQLite rather than against a stub, because the two halves only agree about
 * things that are easy to get wrong: which sync kind a version vector deserves,
 * whether a repeat `op_id` is a no-op, and — the one that matters — whether a
 * compacted server can still bootstrap a client that dirtied itself first. A
 * stub server would answer all three the way the client's author expected.
 *
 * `connected` is a property of the transport, so a test can partition one
 * client mid-edit and heal it later without touching either half.
 */

import { CrdtDocumentServer } from '../server/document.server.js';
import type { LoroDoc } from '../loro.server.js';
import type {
	CrdtInboundMessage,
	CrdtOutboundMessage,
	CrdtTransport,
} from '../client/index.js';
import { createDurableObjectState, type HarnessState } from './do_harness.js';

/** `CrdtDocumentServer.doc` is protected — a test needs to read the result. */
class TestDocumentServer extends CrdtDocumentServer {
	get document(): LoroDoc {
		return this.doc;
	}
}

/** One document server plus the state so a test can inspect its SQLite. */
export interface ServedDoc {
	server: TestDocumentServer;
	state: HarnessState;
	/** `op_id`s in the order `applyUpdate` saw them, duplicates included. */
	received: string[];
}

export class LoopbackNetwork {
	readonly docs = new Map<string, ServedDoc>();
	readonly transports = new Set<LoopbackTransport>();
	/** Set false to make the server stop acking, so blobs stay unacked. */
	ack_enabled = true;

	doc(node_id: string): ServedDoc {
		let served = this.docs.get(node_id);
		if (!served) {
			const state = createDurableObjectState(node_id);
			served = {
				server: new TestDocumentServer(state.ctx, {}, {}),
				state,
				received: [],
			};
			this.docs.set(node_id, served);
		}
		return served;
	}

	transport(peer_key: string): LoopbackTransport {
		const transport = new LoopbackTransport(this, peer_key);
		this.transports.add(transport);
		return transport;
	}

	/** Route one client message. Called by the transport when it is connected. */
	handle(from: LoopbackTransport, message: CrdtOutboundMessage): void {
		if (message.type === 'unsubscribe') return;
		const served = this.doc(message.node_id);

		if (message.type === 'subscribe') {
			const result = served.server.syncFor(from.peer_key, message.peer_version);
			from.deliver({
				type: 'sync',
				node_id: message.node_id,
				kind: result.kind,
				payload: result.payload,
				frontier: result.frontier,
			});
			return;
		}

		served.received.push(message.op_id);
		const applied = served.server.applyUpdate(message.op_id, message.actor, message.blob);
		if (this.ack_enabled) {
			from.deliver({
				type: 'ack',
				node_id: message.node_id,
				op_id: message.op_id,
				frontier: applied.frontier,
				duplicate: !applied.applied,
			});
		}
		if (!applied.applied) return;
		for (const other of this.transports) {
			if (other === from || !other.connected) continue;
			other.deliver({ type: 'broadcast', node_id: message.node_id, blob: message.blob });
		}
	}

	close(): void {
		for (const served of this.docs.values()) served.state.close();
	}
}

export class LoopbackTransport implements CrdtTransport {
	connected = true;
	readonly sent: CrdtOutboundMessage[] = [];

	#network: LoopbackNetwork;
	#message_handlers = new Set<(message: CrdtInboundMessage) => void>();
	#connection_handlers = new Set<(connected: boolean) => void>();

	constructor(
		network: LoopbackNetwork,
		readonly peer_key: string,
	) {
		this.#network = network;
	}

	send(message: CrdtOutboundMessage): void {
		this.sent.push(message);
		if (!this.connected) return;
		// Deferred by a macrotask, like a real round trip. A synchronous (or even
		// microtask) reply would land inside `await open()` and leave the
		// bootstrap gate already cleared, which is precisely the thing under test.
		setTimeout(() => {
			if (!this.connected) return;
			try {
				this.#network.handle(this, message);
			} catch (cause) {
				// A real Durable Object answers a bad frame with an error message; it
				// does not take the connection down.
				const error = cause as { code?: string; message?: string };
				this.deliver({
					type: 'error',
					code: error.code ?? 'server_error',
					message: error.message ?? 'server error',
				});
			}
		}, 0);
	}

	onMessage(handler: (message: CrdtInboundMessage) => void): () => void {
		this.#message_handlers.add(handler);
		return () => this.#message_handlers.delete(handler);
	}

	onConnectionChange(handler: (connected: boolean) => void): () => void {
		this.#connection_handlers.add(handler);
		return () => this.#connection_handlers.delete(handler);
	}

	deliver(message: CrdtInboundMessage): void {
		for (const handler of this.#message_handlers) handler(message);
	}

	setConnected(connected: boolean): void {
		if (this.connected === connected) return;
		this.connected = connected;
		for (const handler of this.#connection_handlers) handler(connected);
	}
}

/** Let queued microtasks and zero-delay timers run. */
export function tick(ms = 0): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until `predicate` holds, or fail after `timeout_ms`.
 *
 * Prefer this over `tick(n)` whenever the assertion that follows depends on
 * asynchronous work having *finished* — a debounce firing, a round trip
 * landing, an ack arriving. A fixed sleep encodes an assumption about how fast
 * the machine is, and CI runners here measure 5-8x slower than a development
 * machine, so a 10ms sleep that is generous locally is a coin flip there.
 *
 * `tick(n)` is still the right tool for *sequencing* — deliberately letting a
 * debounce window close between two writes — because there the delay is the
 * behaviour under test rather than a guess about scheduling.
 */
export async function waitFor(
	predicate: () => boolean | Promise<boolean>,
	{
		timeout_ms = 5_000,
		label = 'condition',
	}: { timeout_ms?: number; label?: string } = {},
): Promise<void> {
	const deadline = Date.now() + timeout_ms;
	while (!(await predicate())) {
		if (Date.now() > deadline)
			throw new Error(`Timed out after ${timeout_ms}ms waiting for ${label}`);
		await tick(1);
	}
}
