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
	cookies.set(config.cookies.session_name, jwt, sessionCookieOptions(config));
}

/** Deletes the session JWT cookie */
export function deleteSessionCookie(cookies: Cookies, config: ResolvedAuthConfig): void {
	cookies.delete(config.cookies.session_name, {
		path: config.cookies.path,
	});
}

/** Returns the cookie options used for session cookies */
function sessionCookieOptions(config: ResolvedAuthConfig) {
	return {
		path: config.cookies.path,
		httpOnly: config.cookies.http_only,
		secure: config.cookies.secure,
		sameSite: config.cookies.same_site as 'lax' | 'strict' | 'none',
	};
}

/**
 * Serializes a Set-Cookie header for the session JWT.
 * Use this when returning a Response directly from a handle (bypassing SvelteKit's
 * cookie pipeline which only adds cookies to responses that go through resolve()).
 */
export function serializeSessionCookie(config: ResolvedAuthConfig, jwt: string): string {
	return serializeCookie(config, config.cookies.session_name, jwt);
}

/** Serializes a Set-Cookie header that deletes the session cookie. */
export function serializeDeleteSessionCookie(config: ResolvedAuthConfig): string {
	return serializeDeleteCookie(config, config.cookies.session_name);
}

/** Serializes a Set-Cookie header for one of the auth cookies, using the configured options */
function serializeCookie(
	config: ResolvedAuthConfig,
	name: string,
	value: string,
): string {
	const opts = sessionCookieOptions(config);
	const parts = [`${name}=${encodeURIComponent(value)}`];
	if (opts.path) parts.push(`Path=${opts.path}`);
	if (opts.httpOnly) parts.push('HttpOnly');
	if (opts.secure) parts.push('Secure');
	if (opts.sameSite)
		parts.push(
			`SameSite=${opts.sameSite.charAt(0).toUpperCase() + opts.sameSite.slice(1)}`,
		);
	return parts.join('; ');
}

/** Serializes a Set-Cookie header that deletes the named cookie */
function serializeDeleteCookie(config: ResolvedAuthConfig, name: string): string {
	return `${name}=; Path=${config.cookies.path}; Max-Age=0`;
}

/**
 * Serializes a Set-Cookie header for the signed preferences cookie (deleting it when
 * there's nothing left to store). Same reason as `serializeSessionCookie`: auth routes
 * return their own Response, which never passes through SvelteKit's cookie pipeline.
 */
export async function serializePreferencesCookie(
	config: ResolvedAuthConfig,
	secret: string,
	data: Record<string, unknown>,
): Promise<string> {
	const name = config.cookies.preferences_name;
	if (Object.keys(data).length === 0) return serializeDeleteCookie(config, name);
	return serializeCookie(config, name, await signState(data, secret));
}

/** Serializes a Set-Cookie header for an org's signed state cookie */
export async function serializeOrgStateCookie(
	config: ResolvedAuthConfig,
	secret: string,
	org_id: string,
	data: Record<string, unknown>,
): Promise<string> {
	const name = orgStateCookieName(config, org_id);
	if (Object.keys(data).length === 0) return serializeDeleteCookie(config, name);
	return serializeCookie(config, name, await signState(data, secret));
}

// ── Signed state cookie primitives (JWT format) ──────────────

/** Maximum cookie value size in bytes (leaves room for name + attributes within 4KB) */
const MAX_STATE_BYTES = 3072;

/** Precomputed base64url-encoded JWT header for HS256 */
const JWT_HEADER = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'; // {"alg":"HS256","typ":"JWT"}

/**
 * Signs a data object into a JWT cookie value.
 * Format: base64url(header).base64url(payload).base64url(hmac-sha256(header.payload, secret))
 */
export async function signState(
	data: Record<string, unknown>,
	secret: string,
): Promise<string> {
	const payload = base64urlEncode(JSON.stringify(data));
	const signing_input = `${JWT_HEADER}.${payload}`;
	const key = await getSecretKey(secret);
	const signature = await crypto.subtle.sign(
		'HMAC',
		key,
		new TextEncoder().encode(signing_input),
	);
	const cookie_value = `${signing_input}.${base64urlEncodeBuffer(signature)}`;

	if (new TextEncoder().encode(cookie_value).byteLength > MAX_STATE_BYTES) {
		throw new Error(
			`Signed state cookie exceeds ${MAX_STATE_BYTES} bytes. Reduce the amount of data stored.`,
		);
	}

	return cookie_value;
}

/**
 * Verifies a JWT cookie value and returns the parsed payload.
 * Returns null if the value is missing, malformed, or has an invalid signature.
 */
export async function verifyState(
	cookie_value: string,
	secret: string,
): Promise<Record<string, unknown> | null> {
	const parts = cookie_value.split('.');
	if (parts.length !== 3) return null;

	const [header, payload, sig] = parts;
	if (!header || !payload || !sig) return null;

	let key: CryptoKey;
	try {
		key = await getSecretKey(secret);
	} catch {
		return null;
	}

	let sig_bytes: Uint8Array<ArrayBuffer>;
	try {
		sig_bytes = base64urlDecodeBuffer(sig);
	} catch {
		return null;
	}

	const signing_input = `${header}.${payload}`;
	const valid = await crypto.subtle.verify(
		'HMAC',
		key,
		sig_bytes,
		new TextEncoder().encode(signing_input),
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

function base64urlDecodeBuffer(str: string): Uint8Array<ArrayBuffer> {
	const padded = str.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
