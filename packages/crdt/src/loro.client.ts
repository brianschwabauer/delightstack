/**
 * The Loro entry point for browser builds.
 *
 * Spike finding: `loro-crdt/web` streams and compiles the wasm off the main
 * thread. The default `browser` build fetches 3.2MB with a **synchronous XHR**
 * and decodes it byte by byte on the main thread — which alone would blow the
 * boot budget every consumer of this package cares about.
 *
 * The server counterpart is `loro.server.ts`, which pins `loro-crdt/bundler`.
 */
export {
	LoroDoc,
	LoroList,
	LoroMap,
	LoroText,
	VersionVector,
	UndoManager,
} from 'loro-crdt/web';
export type { Cursor, ContainerID, LoroEventBatch, Frontiers, PeerID } from 'loro-crdt';
