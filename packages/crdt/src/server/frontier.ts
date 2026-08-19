/**
 * Encoding for the opaque {@link Frontier} string.
 *
 * A Loro `Frontiers` is an array of `{ peer, counter }` pairs. Consumers store
 * one in a text column, put it in a JSON body and compare two for equality, so
 * the package hands out a *string* and never a structure — that way there is
 * one canonical form and no chance of two encodings of the same point failing
 * an `===`. Loro's own `encodeFrontiers` produces the canonical byte form
 * (sorted, deduplicated), and base64 makes it column- and JSON-safe.
 */

import { decodeFrontiers, encodeFrontiers, type Frontiers } from '../loro.server.js';
import type { Frontier } from '../types.js';

/** Bytes → base64. Present in workerd and in Node ≥16; no dependency needed. */
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
	for (let index = 0; index < binary.length; index++)
		bytes[index] = binary.charCodeAt(index);
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

/** The frontier of an empty document — the one value that is not from a doc. */
export const EMPTY_FRONTIER: Frontier = encodeFrontier([]);
