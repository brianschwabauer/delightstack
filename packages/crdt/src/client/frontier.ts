/**
 * Client-side encoding for the opaque {@link Frontier} string.
 *
 * A byte-for-byte mirror of `src/server/frontier.ts`. The two cannot be one
 * module because they differ in a single import — `loro.client.js` versus
 * `loro.server.js` — and that import is the whole point of the split: a shared
 * helper would drag a wasm build into whichever environment it was not meant
 * for. Twenty duplicated lines is the cheaper mistake.
 */

import { decodeFrontiers, encodeFrontiers, type Frontiers } from '../loro.client.js';
import type { Frontier } from '../types.js';

/** Bytes → base64. */
export function toBase64(bytes: Uint8Array): string {
	let binary = '';
	// Chunked so a large snapshot cannot blow the argument limit of `apply`.
	const CHUNK = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
	}
	return btoa(binary);
}

/** base64 → bytes. */
export function fromBase64(text: string): Uint8Array {
	const binary = atob(text);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

/** Canonical string form of a Loro frontier. */
export function encodeFrontier(frontiers: Frontiers): Frontier {
	return toBase64(encodeFrontiers(frontiers));
}

/** Inverse of {@link encodeFrontier}. */
export function decodeFrontier(frontier: Frontier): Frontiers {
	return decodeFrontiers(fromBase64(frontier));
}

/** The frontier of an empty document. */
export const EMPTY_FRONTIER: Frontier = encodeFrontier([]);
