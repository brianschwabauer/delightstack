// Public surface of @delightstack/presence.
//
// The root entry stays free of optional peer deps (@delightstack/websocket,
// @delightstack/auth): it re-exports the framework-agnostic core, the Svelte
// client helpers, and the shared types. The batteries-included adapters live in
// the `./adapters` entry, and the server module in `./server`, so importing the
// root never pulls in a transport/auth implementation you may have swapped out.

export * from './types';
export * from './core';
export * from './client';
