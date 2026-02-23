import type { Cookies } from '@sveltejs/kit';
import type { ResolvedAuthConfig } from '../server/auth.config';
import { getSecretKey } from '../server/jwt.server';

// ── Session cookie (JWT) ──────────────────────────────────────

/** Gets the session JWT from cookies */
export function getSessionCookie(
	cookies: Cookies,
	config: ResolvedAuthConfig,
): string | undefined {
	return cookies.get(config.cookies.session_name) || undefined;
}

/** Sets the session JWT cookie */
export function setSessionCookie(
	cookies: Cookies,
	config: ResolvedAuthConfig,
	jwt: string,
): void {
	cookies.set(config.cookies.session_name, jwt, {
		path: config.cookies.path,
		httpOnly: config.cookies.http_only,
		secure: config.cookies.secure,
		sameSite: config.cookies.same_site,
	});
}

/** Deletes the session JWT cookie */
export function deleteSessionCookie(
	cookies: Cookies,
	config: ResolvedAuthConfig,
): void {
	cookies.delete(config.cookies.session_name, {
		path: config.cookies.path,
	});
}

// ── Signed state cookie primitives ────────────────────────────

/** Maximum cookie value size in bytes (leaves room for name + attributes within 4KB) */
const MAX_STATE_BYTES = 3072;

/**
 * Signs a data object into a tamper-proof cookie value.
 * Format: base64url(json).base64url(hmac-sha256(payload, secret))
 */
export async function signState(
	data: Record<string, unknown>,
	secret: string,
): Promise<string> {
	const json = JSON.stringify(data);
	const payload = base64urlEncode(json);
	const key = await getSecretKey(secret);
	const signature = await crypto.subtle.sign(
		'HMAC',
		key,
		new TextEncoder().encode(payload),
	);
	const sig = base64urlEncodeBuffer(signature);
	const cookie_value = `${payload}.${sig}`;

	if (new TextEncoder().encode(cookie_value).byteLength > MAX_STATE_BYTES) {
		throw new Error(
			`Signed state cookie exceeds ${MAX_STATE_BYTES} bytes. Reduce the amount of data stored.`,
		);
	}

	return cookie_value;
}

/**
 * Verifies a signed cookie value and returns the parsed data.
 * Returns null if the value is missing, malformed, or has an invalid signature.
 */
export async function verifyState(
	cookie_value: string,
	secret: string,
): Promise<Record<string, unknown> | null> {
	const dot_index = cookie_value.lastIndexOf('.');
	if (dot_index === -1) return null;

	const payload = cookie_value.slice(0, dot_index);
	const sig = cookie_value.slice(dot_index + 1);

	let key: CryptoKey;
	try {
		key = await getSecretKey(secret);
	} catch {
		return null;
	}

	let sig_bytes: Uint8Array;
	try {
		sig_bytes = base64urlDecodeBuffer(sig);
	} catch {
		return null;
	}

	const valid = await crypto.subtle.verify(
		'HMAC',
		key,
		sig_bytes,
		new TextEncoder().encode(payload),
	);
	if (!valid) return null;

	try {
		const json = base64urlDecode(payload);
		const parsed = JSON.parse(json);
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			return null;
		}
		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}

// ── Preferences cookie (global user preferences) ─────────────

/** Reads and verifies the user preferences cookie. Returns empty object if missing/invalid. */
export async function getPreferencesCookie(
	cookies: Cookies,
	config: ResolvedAuthConfig,
	secret: string,
): Promise<Record<string, unknown>> {
	const raw = cookies.get(config.cookies.preferences_name);
	if (!raw) return {};
	const data = await verifyState(raw, secret);
	return data ?? {};
}

/** Signs and sets the user preferences cookie. Deletes if empty. */
export async function setPreferencesCookie(
	cookies: Cookies,
	config: ResolvedAuthConfig,
	secret: string,
	data: Record<string, unknown>,
): Promise<void> {
	if (Object.keys(data).length === 0) {
		deletePreferencesCookie(cookies, config);
		return;
	}
	const value = await signState(data, secret);
	cookies.set(config.cookies.preferences_name, value, {
		path: config.cookies.path,
		httpOnly: config.cookies.http_only,
		secure: config.cookies.secure,
		sameSite: config.cookies.same_site,
	});
}

/** Deletes the user preferences cookie */
export function deletePreferencesCookie(
	cookies: Cookies,
	config: ResolvedAuthConfig,
): void {
	cookies.delete(config.cookies.preferences_name, {
		path: config.cookies.path,
	});
}

// ── Org state cookie (per-org cached data + preferences) ──────

/** Returns the cookie name for a specific org's state cookie */
function orgStateCookieName(config: ResolvedAuthConfig, org_id: string): string {
	return `${config.cookies.org_state_prefix}${org_id}`;
}

/** Reads and verifies an org's state cookie. Returns empty object if missing/invalid. */
export async function getOrgStateCookie(
	cookies: Cookies,
	config: ResolvedAuthConfig,
	secret: string,
	org_id: string,
): Promise<Record<string, unknown>> {
	const raw = cookies.get(orgStateCookieName(config, org_id));
	if (!raw) return {};
	const data = await verifyState(raw, secret);
	return data ?? {};
}

/** Signs and sets an org's state cookie. Deletes if empty. */
export async function setOrgStateCookie(
	cookies: Cookies,
	config: ResolvedAuthConfig,
	secret: string,
	org_id: string,
	data: Record<string, unknown>,
): Promise<void> {
	const name = orgStateCookieName(config, org_id);
	if (Object.keys(data).length === 0) {
		cookies.delete(name, { path: config.cookies.path });
		return;
	}
	const value = await signState(data, secret);
	cookies.set(name, value, {
		path: config.cookies.path,
		httpOnly: config.cookies.http_only,
		secure: config.cookies.secure,
		sameSite: config.cookies.same_site,
	});
}

/** Deletes an org's state cookie */
export function deleteOrgStateCookie(
	cookies: Cookies,
	config: ResolvedAuthConfig,
	org_id: string,
): void {
	cookies.delete(orgStateCookieName(config, org_id), {
		path: config.cookies.path,
	});
}

// ── base64url helpers ─────────────────────────────────────────

function base64urlEncode(str: string): string {
	// Encode string to UTF-8 bytes first to handle non-Latin-1 characters
	const bytes = new TextEncoder().encode(str);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlDecode(str: string): string {
	const padded = str.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return new TextDecoder().decode(bytes);
}

function base64urlEncodeBuffer(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlDecodeBuffer(str: string): Uint8Array {
	const padded = str.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
