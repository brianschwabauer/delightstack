import type { Handle, RequestEvent } from '@sveltejs/kit';
import type { AuthConfig, ResolvedAuthConfig } from './auth.config';
import type { AuthDatabaseServer } from './auth.db.server';
import type { AuthClientData } from '../client/auth.client.svelte';
import type { SessionToken, UserSessionMeta } from '../types';
import { DelightError } from '@delightstack/utilities';
import { decodeJwt, extractJwtRefreshToken } from './jwt.server';
import { matchRoute } from './auth.routes';
import {
	getSessionCookie,
	setSessionCookie,
	deleteSessionCookie,
	serializeSessionCookie,
	serializeDeleteSessionCookie,
	getPreferencesCookie,
	setPreferencesCookie,
	serializePreferencesCookie,
	getOrgStateCookie,
	setOrgStateCookie,
	serializeOrgStateCookie,
	deleteOrgStateCookie,
} from '../sveltekit/cookies';
import { defineAuthConfig } from './auth.config';

/** Generic auth server type — the subset of AuthDatabaseServer used by the handler */
export type AuthServer = DurableObjectStub<
	Omit<
		AuthDatabaseServer,
		'alarm' | 'webSocketMessage' | 'webSocketClose' | 'webSocketError' | 'fetch' | 'Rpc'
	>
>;

/** Options for `createAuthHandle()` */
export interface AuthHandleOptions<Config extends AuthConfig> {
	/** The auth configuration */
	config: Config;

	/**
	 * Get the auth server instance.
	 * Returns a DurableObjectStub or compatible RPC interface.
	 */
	getAuthServer: (event: RequestEvent) => AuthServer;

	/** Whether the app is building (static build step) @default false */
	building?: boolean;
}

/** Auth-related properties populated on `event.locals` by the auth handler */
export interface AuthLocals {
	/** The decoded session token (null if not authenticated) */
	session: SessionToken<'auth'> | null;

	/** The raw JWT string (null if not authenticated) */
	jwt: string | null;

	/** Convenience user accessor (null if not authenticated) */
	user: {
		id: string;
		name: string;
		email: string;
		verified: boolean;
		user_auth_id: string;
		user_session_id: string;
	} | null;

	/** The current organization ID (resolved from URL params/query/header/auto-select) */
	org_id: string | null;

	/** Current org info from the session token */
	org: {
		id: string;
		name: string;
		permissions: number;
		db?: string;
		entitlements?: number;
	} | null;

	/**
	 * Global user preferences (from signed preferences cookie).
	 * Persists across signouts and is synced to the user DB for cross-device access.
	 */
	preferences: Record<string, unknown>;

	/**
	 * Per-org state for the current org (from signed org state cookie).
	 * Cleared on signout. NOT synced to DB — intended for caching org data like org name.
	 */
	org_state: Record<string, unknown>;

	/**
	 * Merge updates into the user preferences cookie. Set a value to null/undefined to remove it.
	 * Changes are automatically persisted to both the signed cookie and the user DB.
	 */
	setPreferences: (updates: Record<string, unknown>) => void;

	/**
	 * Merge updates into the current org's state cookie. Set a value to null/undefined to remove it.
	 * Changes are written to the signed cookie only (not synced to DB).
	 */
	setOrgState: (updates: Record<string, unknown>) => void;

	/** Pre-built serialized auth data for passing to the client via +layout.server.ts */
	auth_client_data: AuthClientData;

	/** User session metadata (IP, geo, user agent) */
	meta: UserSessionMeta;

	/** The auth server instance */
	auth: AuthServer;
}

/** Extract UserSessionMeta from the request */
function extractMeta(event: RequestEvent): UserSessionMeta {
	const request = event.request;
	const platform = event.platform as Record<string, unknown> | undefined;
	const cf = (platform as Record<string, Record<string, string>> | undefined)?.cf;

	const user_agent = request.headers.get('User-Agent') || undefined;

	return {
		ip_address: event.getClientAddress?.() || undefined,
		city: cf?.city || undefined,
		country: cf?.country || undefined,
		latitude: cf?.latitude || undefined,
		longitude: cf?.longitude || undefined,
		region: cf?.region || cf?.regionCode || undefined,
		timezone: cf?.timezone || undefined,
		user_agent,
	};
}

/** Verify CSRF by checking Origin/Referer headers */
function verifyCsrf(event: RequestEvent, config: ResolvedAuthConfig): boolean {
	const method = event.request.method;
	if (method !== 'POST' && method !== 'PATCH' && method !== 'DELETE') return true;

	if (config.csrf === false) return true;

	const origin = event.request.headers.get('Origin');
	const referer = event.request.headers.get('Referer');
	const host = event.url.origin;

	const allowed_origins =
		typeof config.csrf === 'object' ? config.csrf.allowed_origins || [] : [];

	if (origin) {
		if (origin === host) return true;
		if (allowed_origins.includes(origin)) return true;
		return false;
	}

	if (referer) {
		try {
			const referer_origin = new URL(referer).origin;
			if (referer_origin === host) return true;
			if (allowed_origins.includes(referer_origin)) return true;
		} catch {
			// invalid referer
		}
		return false;
	}

	// No Origin or Referer — allow for non-browser clients
	return true;
}

/**
 * Default org_id resolver.
 * Priority: URL params (org_id) > query (?org=) > header (Org-ID) > auto-select (single org).
 * Verifies the user has access to the resolved org.
 */
function defaultResolveOrgId(
	event: RequestEvent,
	session: SessionToken<'auth'> | null,
): string | null {
	const { url, request } = event;
	const params = event.params;

	// Priority: URL params > query > header > auto-select
	let org_id: string | null =
		params.org_id || url.searchParams.get('org') || request.headers.get('Org-ID') || null;

	// Tokens with no permission bits are not memberships (defensive — newer
	// servers never issue them, but older tokens may still be in flight).
	const orgs = session?.org || {};
	const member_org_ids = Object.keys(orgs).filter((id) => (orgs[id]?.p ?? 0) > 0);

	// Auto-select if user has exactly one org
	if (!org_id && session && member_org_ids.length === 1) {
		org_id = member_org_ids[0];
	}

	// Verify user has access to this org
	if (org_id && session && !member_org_ids.includes(org_id)) {
		org_id = null;
	}

	if (org_id === 'null') org_id = null;

	return org_id;
}

/**
 * Creates a SvelteKit Handle function for authentication.
 * Composable with SvelteKit's sequence().
 */
export function createAuthHandle<Config extends AuthConfig>(
	options: AuthHandleOptions<Config>,
): Handle {
	const config = defineAuthConfig(options.config) as ResolvedAuthConfig;

	return async ({ event, resolve }) => {
		// 1. Skip during static builds
		if (options.building) {
			return resolve(event);
		}

		// 2. Extract meta
		const meta = extractMeta(event);

		// 3. Initialize auth server (lazy)
		let _cached_auth: AuthServer | undefined;
		const getAuth = () => {
			if (!_cached_auth) {
				_cached_auth = options.getAuthServer(event);
			}
			return _cached_auth;
		};

		// 4. Extract JWT from: cookie > Authorization header > ?auth= query param
		// (query param is opt-in: URLs leak into Referer headers, browser
		// history, and server logs, so it must never be a default token source)
		let jwt: string | undefined =
			getSessionCookie(event.cookies, config) ||
			event.request.headers.get('Authorization')?.match(/Bearer\s+([^\s;]+)/)?.[1] ||
			(config.allow_query_token ? event.url.searchParams.get('auth') : null) ||
			undefined;

		// 5. Decode JWT and refresh if expired
		let session: SessionToken<'auth'> | null = null;
		if (jwt) {
			try {
				const decoded = await decodeJwt<'auth'>(config.secret, jwt);
				if (decoded.typ === 'auth') {
					session = decoded;
				}
			} catch (error: unknown) {
				const apiErr = DelightError.is(error) ? error : DelightError.from(error);
				if (apiErr.detail === 'auth/expired' && jwt) {
					try {
						const jti = extractJwtRefreshToken(jwt);
						const refreshed = await getAuth().refreshSession(jti, meta);
						jwt = refreshed.jwt;
						session = refreshed.decoded_jwt as SessionToken<'auth'>;
					} catch {
						jwt = undefined;
						session = null;
					}
				} else {
					jwt = undefined;
					session = null;
				}
			}
		}

		// 6. Update session cookie
		if (session && jwt) {
			const current_cookie = getSessionCookie(event.cookies, config);
			if (current_cookie !== jwt) {
				setSessionCookie(event.cookies, config, jwt);
			}
		} else {
			const has_cookie = !!getSessionCookie(event.cookies, config);
			if (has_cookie) {
				deleteSessionCookie(event.cookies, config);
			}
		}

		// 7. Read preferences cookie (always — persists across signouts for things like dark mode)
		let preferences = await getPreferencesCookie(event.cookies, config, config.secret);
		let preferences_dirty = false;
		let preferences_persist = false; // when true, flush also writes to user DB for cross-device sync

		// 8. Resolve org_id (custom resolver or default: URL params > query > header > auto-select)
		const resolveOrgId = config.resolveOrgId ?? defaultResolveOrgId;
		const org_id = resolveOrgId(event, session);

		// 9. Read org state cookie for current org
		const org_state = org_id
			? await getOrgStateCookie(event.cookies, config, config.secret, org_id)
			: {};
		let org_state_dirty = false;

		// 10. Build user convenience object
		const user = session
			? {
					id: session.uid,
					name: session.name,
					email: session.email,
					verified: session.verified,
					user_auth_id: session.sub,
					user_session_id: session.jti,
				}
			: null;

		// 11. Build org object (map short token keys to developer-facing names)
		const org_token = session && org_id ? session.org?.[org_id] : undefined;
		const org =
			org_token && org_id
				? {
						id: org_id,
						name: org_token.n,
						permissions: org_token.p,
						db: org_token.d,
						entitlements: org_token.e,
					}
				: null;

		// 12. Build setState closures
		const setPreferences = (updates: Record<string, unknown>) => {
			for (const [key, value] of Object.entries(updates)) {
				if (value === undefined || value === null) {
					delete preferences[key];
				} else {
					preferences[key] = value;
				}
			}
			preferences_dirty = true;
			preferences_persist = true;
		};

		const setOrgState = (updates: Record<string, unknown>) => {
			if (!org_id) return;
			for (const [key, value] of Object.entries(updates)) {
				if (value === undefined || value === null) {
					delete org_state[key];
				} else {
					org_state[key] = value;
				}
			}
			org_state_dirty = true;
		};

		// 13. Populate event.locals with AuthLocals
		const locals: AuthLocals = {
			session,
			jwt: jwt || null,
			user,
			org_id,
			org,
			preferences,
			org_state,
			setPreferences,
			setOrgState,
			auth_client_data: {
				jwt: jwt || null,
				session,
				org_id,
				preferences,
				org_state,
				permissions: config.permissions,
				entitlements: config.entitlements,
			},
			meta,
			get auth() {
				return getAuth();
			},
		};
		Object.assign(event.locals, locals);

		// 14. Check if URL matches auth routes
		const base_path = config.base_path;
		const pathname = event.url.pathname;

		if (pathname.startsWith(base_path)) {
			const route_path = pathname.slice(base_path.length) || '/';
			const method = event.request.method;

			const match = matchRoute(method, route_path);
			if (match) {
				// Verify CSRF on mutating requests
				if (!verifyCsrf(event, config)) {
					return new Response(
						JSON.stringify({
							code: 'csrf_failed',
							message: 'CSRF verification failed',
							status: 403,
						}),
						{ status: 403, headers: { 'Content-Type': 'application/json' } },
					);
				}

				// Merge route params into event.params
				Object.assign(event.params, match.params);

				/**
				 * Starts the session a route just created: sets the session cookie and restores
				 * the user's saved preferences. Routes that redirect (the OAuth callback) call
				 * this themselves, since there's no JSON body for the check below to read.
				 */
				const applySession = async (
					session_jwt: string,
					decoded_jwt?: { uid?: string },
				) => {
					setSessionCookie(event.cookies, config, session_jwt);

					// Restore preferences from DB on sign-in (DB wins on conflict for cross-device sync)
					if (!decoded_jwt?.uid) return;
					try {
						const db_prefs = (await getAuth().getUserPreferences(
							decoded_jwt.uid,
						)) as Record<string, unknown>;
						if (Object.keys(db_prefs).length > 0) {
							preferences = { ...preferences, ...db_prefs };
							preferences_dirty = true;
							// preferences_persist stays false — no need to write back what we just read
						}
					} catch {
						/* ignore DB errors */
					}
				};

				const response = await match.handler({
					event,
					config,
					auth: getAuth(),
					locals,
					meta,
					applySession,
				});

				// After route: update session cookie from response JWT
				if (
					response.status >= 200 &&
					response.status < 300 &&
					response.headers.get('Content-Type')?.includes('application/json')
				) {
					try {
						const cloned = response.clone();
						const data = (await cloned.json()) as Record<string, unknown>;
						if (data.jwt && typeof data.jwt === 'string') {
							await applySession(data.jwt, data.decoded_jwt as { uid?: string });
						}
					} catch {
						// ignore parse errors
					}
				}

				// On signout: clear session + org state cookies (preferences persist across signouts)
				if (
					route_path === '/signout' &&
					(response.status === 204 || response.status === 302)
				) {
					deleteSessionCookie(event.cookies, config);
					// Delete all org state cookies (caching only — not persisted to DB)
					if (session) {
						for (const oid of Object.keys(session.org || {})) {
							deleteOrgStateCookie(event.cookies, config, oid);
							response.headers.append(
								'Set-Cookie',
								await serializeOrgStateCookie(config, config.secret, oid, {}),
							);
						}
					}
					// Preferences cookie is intentionally kept — it persists across signouts
					// so users don't lose settings like dark mode. Preferences are also synced
					// to the user DB, so they restore automatically on sign-in from any device.
					preferences_dirty = false;
					preferences_persist = false;
					org_state_dirty = false;
				}

				// Flush dirty cookies before returning auth route response.
				// SvelteKit only adds event.cookies to responses that go through
				// resolve(), and auth routes return their own Response — so every
				// cookie written here also needs its Set-Cookie header appended by
				// hand, or the write is silently lost.
				if (preferences_dirty) {
					await setPreferencesCookie(event.cookies, config, config.secret, preferences);
					response.headers.append(
						'Set-Cookie',
						await serializePreferencesCookie(config, config.secret, preferences),
					);
					preferences_dirty = false;
				}
				if (preferences_persist && session) {
					try {
						await getAuth().setUserPreferences(session.uid, preferences);
					} catch {
						/* ignore */
					}
					preferences_persist = false;
				}
				if (org_state_dirty && org_id) {
					await setOrgStateCookie(
						event.cookies,
						config,
						config.secret,
						org_id,
						org_state,
					);
					response.headers.append(
						'Set-Cookie',
						await serializeOrgStateCookie(config, config.secret, org_id, org_state),
					);
				}

				const final_jwt = getSessionCookie(event.cookies, config);
				if (final_jwt) {
					response.headers.append(
						'Set-Cookie',
						serializeSessionCookie(config, final_jwt),
					);
				} else if (session && !getSessionCookie(event.cookies, config)) {
					// Session was deleted during this request (e.g. signout)
					response.headers.append('Set-Cookie', serializeDeleteSessionCookie(config));
				}
				return response;
			}
		}

		// 15. Not an auth route — resolve normally
		const response = await resolve(event);

		// 16. Flush dirty cookies
		if (preferences_dirty) {
			await setPreferencesCookie(event.cookies, config, config.secret, preferences);
			preferences_dirty = false;
		}
		if (preferences_persist && session) {
			try {
				await getAuth().setUserPreferences(session.uid, preferences);
			} catch {
				/* ignore */
			}
			preferences_persist = false;
		}
		if (org_state_dirty && org_id) {
			await setOrgStateCookie(event.cookies, config, config.secret, org_id, org_state);
		}

		// 17. Post-resolve: intercept 500 JSON responses and normalize
		if (
			response.status === 500 &&
			response.headers.get('content-type')?.startsWith('application/json')
		) {
			try {
				const body = await response.json();
				const error = DelightError.from(body);
				return error.toResponse();
			} catch {
				// ignore
			}
		}

		return response;
	};
}
