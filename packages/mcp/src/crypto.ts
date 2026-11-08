/**
 * Web Crypto only — no `node:` imports, so every export here runs unchanged in
 * workerd, in a browser, and under Node's global `crypto`.
 *
 * `@delightstack/utilities` has `generateID`, and it is the wrong tool for
 * everything in this file: it draws from `Math.random()`, which is fine for a
 * database key and is not fine for an authorization code, a refresh token, or
 * a session id. Everything below draws from `crypto.getRandomValues`.
 */

const BASE64URL_ALPHABET =
	'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Base64url with no padding, per RFC 4648 §5. */
export function base64UrlEncode(bytes: Uint8Array): string {
	let out = '';
	for (let i = 0; i < bytes.length; i += 3) {
		const b0 = bytes[i];
		const b1 = bytes[i + 1];
		const b2 = bytes[i + 2];
		out += BASE64URL_ALPHABET[b0 >> 2];
		out += BASE64URL_ALPHABET[((b0 & 0b11) << 4) | ((b1 ?? 0) >> 4)];
		if (b1 === undefined) break;
		out += BASE64URL_ALPHABET[((b1 & 0b1111) << 2) | ((b2 ?? 0) >> 6)];
		if (b2 === undefined) break;
		out += BASE64URL_ALPHABET[b2 & 0b111111];
	}
	return out;
}

/** A cryptographically random base64url string of `bytes` entropy. */
export function randomToken(bytes = 32): string {
	const buffer = new Uint8Array(bytes);
	crypto.getRandomValues(buffer);
	return base64UrlEncode(buffer);
}

/** SHA-256 of a UTF-8 string, base64url encoded — the PKCE `S256` transform. */
export async function sha256Base64Url(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Compares two strings without leaking where they first differ.
 *
 * Length is not secret here (every secret this compares is fixed-length by
 * construction), so an early return on a length mismatch is fine; what must
 * not vary is the time taken by two same-length values.
 */
export function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/**
 * Hashes a bearer/refresh token for storage.
 *
 * Stores are assumed to be as readable as the database they live in, so what is
 * written down is a digest: a leaked row then yields nothing that can be
 * replayed. A single SHA-256 is the right cost — unlike a password, the input
 * is 256 bits of our own entropy, so there is no dictionary to run.
 */
export function hashToken(token: string): Promise<string> {
	return sha256Base64Url(token);
}
