/**
 * `@delightstack/crdt` — the environment-neutral entry.
 *
 * Types only. Loro ships three incompatible builds and the right one depends on
 * where the code ends up running, so the root entry deliberately pulls in
 * **none** of them: import `@delightstack/crdt/server` inside a Durable Object
 * and `@delightstack/crdt/client` in the browser. A shared type import here
 * costs nothing at runtime and cannot resolve to the wrong wasm.
 */
export type * from './types.js';
