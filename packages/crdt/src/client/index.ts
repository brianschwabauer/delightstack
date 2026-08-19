/**
 * `@delightstack/crdt/client` — the browser half.
 *
 * Everything here imports Loro through `../loro.client.js`, which pins
 * `loro-crdt/web`: the only published build that streams and compiles the wasm
 * off the main thread. The default `browser` build fetches 3.2MB over a
 * **synchronous XHR** and decodes it byte by byte, which alone blows the boot
 * budget. Importing `/server` into a browser bundle, or this entry into
 * workerd, is a build error waiting to happen.
 *
 * ```ts
 * import { CrdtClient } from '@delightstack/crdt/client';
 *
 * const crdt = new CrdtClient({ transport, storage: 'opfs', actor: 'user:abc' });
 * const handle = await crdt.open(node_id);
 * await handle.ready();                    // ← the bootstrap gate. Not optional.
 * handle.transact((doc) => doc.getText('content').insert(0, 'hello'));
 * ```
 */

export {
	CrdtClient,
	DEFAULT_BOOTSTRAP_TIMEOUT_MS,
	DEFAULT_IDLE_EVICT_MS,
	DEFAULT_QUOTA_BYTES,
	DEFAULT_SEND_DEBOUNCE_MS,
	DEFAULT_SNAPSHOT_EVERY,
	type CrdtClientConfig,
	type CrdtHandle,
	type CrdtResetInfo,
	type CrdtSyncState,
} from './crdt.client.svelte.js';

export type {
	CrdtInboundMessage,
	CrdtOutboundMessage,
	CrdtTransport,
} from './transport.js';

export {
	IdbCrdtStorage,
	MemoryCrdtStorage,
	decodePendingLog,
	encodeAckRecord,
	encodeUpdateRecord,
	type CrdtDocStore,
	type CrdtStorage,
	type LoadedDoc,
	type PendingRecord,
	type StoredDocMeta,
} from './storage.js';

export { OpfsCrdtStorage } from './opfs.storage.js';

export {
	EMPTY_FRONTIER,
	decodeFrontier,
	encodeFrontier,
	fromBase64,
	toBase64,
} from './frontier.js';

export type * from '../types.js';
