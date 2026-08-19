/**
 * The Loro entry point for server (workerd) builds.
 *
 * Spike finding: the bare `loro-crdt` specifier resolves to a different build
 * per environment, and two of them fail. In workerd the default browser build
 * **throws at module scope**, so the server must import `loro-crdt/bundler`
 * explicitly. Every server-side module imports Loro from here rather than from
 * `loro-crdt` directly, so there is exactly one place to get this wrong.
 *
 * The client counterpart is `loro.client.ts`, which pins `loro-crdt/web`.
 *
 * Under Vitest this specifier is aliased to `loro-crdt/nodejs` (see
 * `vite.config.ts`): the bundler build's wasm arrives through an ESM wasm
 * import that Node has no loader for. Same wasm-bindgen output, different
 * loader — the semantics under test are the shipped ones.
 */
export {
	LoroDoc,
	LoroList,
	LoroMovableList,
	LoroMap,
	LoroText,
	VersionVector,
	UndoManager,
	encodeFrontiers,
	decodeFrontiers,
	decodeImportBlobMeta,
} from 'loro-crdt/bundler';
export type {
	Cursor,
	ContainerID,
	LoroEventBatch,
	Frontiers,
	PeerID,
	ImportStatus,
} from 'loro-crdt';
