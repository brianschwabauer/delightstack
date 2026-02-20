import type { Cookies } from '@sveltejs/kit';
import type { ResolvedAuthConfig } from '../server/auth.config';

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

/** Gets the org ID from cookies */
export function getOrgCookie(
	cookies: Cookies,
	config: ResolvedAuthConfig,
): string | undefined {
	return cookies.get(config.cookies.org_name) || undefined;
}

/** Sets the org ID cookie */
export function setOrgCookie(
	cookies: Cookies,
	config: ResolvedAuthConfig,
	org_id: string,
): void {
	cookies.set(config.cookies.org_name, org_id, {
		path: config.cookies.path,
		httpOnly: config.cookies.http_only,
		secure: config.cookies.secure,
		sameSite: config.cookies.same_site,
	});
}

/** Deletes the org ID cookie */
export function deleteOrgCookie(
	cookies: Cookies,
	config: ResolvedAuthConfig,
): void {
	cookies.delete(config.cookies.org_name, {
		path: config.cookies.path,
	});
}
