import { DelightError } from '@delightstack/utilities';
import { hashToken, randomToken, sha256Base64Url, timingSafeEqual } from './crypto.js';
import type { McpAuthContext } from './types.js';

/**
 * An OAuth 2.1 authorization server and resource server, sized to what the MCP
 * authorization specification actually requires.
 *
 * Storage is entirely injected. The package knows the *protocol* — the
 * metadata documents, the PKCE transform, code redemption, refresh rotation,
 * the bearer challenge — and knows nothing about where a row is written, which
 * is the only part that differs between a Durable Object, a D1 table, and a
 * test. The consent screen is injected for the same reason: it is the one part
 * of the flow a user looks at, so it belongs to the application's design
 * system rather than to a library.
 *
 * What it deliberately does not do: no implicit grant, no password grant, no
 * `plain` PKCE. OAuth 2.1 removes all three, and an option to re-enable them
 * is an option someone eventually sets.
 */

// ---------------------------------------------------------------------------
// Records and stores
// ---------------------------------------------------------------------------

/** A registered client. Mirrors RFC 7591 metadata, so those keys keep its casing. */
export interface OauthClient {
	client_id: string;
	client_id_issued_at: number;
	client_name?: string;
	redirect_uris: string[];
	grant_types: string[];
	response_types: string[];
	/** Space-delimited, as RFC 7591 writes it. */
	scope?: string;
	token_endpoint_auth_method: 'none' | 'client_secret_post' | 'client_secret_basic';
	/** Absent for a public client. Never the secret itself. */
	client_secret_hash?: string;
	client_secret_expires_at?: number;
	client_uri?: string;
	logo_uri?: string;
	policy_uri?: string;
	tos_uri?: string;
	software_id?: string;
	software_version?: string;
}

export interface OauthAuthorizationCode {
	/** The digest of the code. The code itself is never stored. */
	code_hash: string;
	client_id: string;
	redirect_uri: string;
	scopes: string[];
	code_challenge: string;
	/** Only `S256`. `plain` is refused at the authorization endpoint. */
	code_challenge_method: 'S256';
	resource?: string;
	subject: string;
	org_id?: string;
	expires_at: number;
}

export interface OauthAccessToken {
	id: string;
	token_hash: string;
	refresh_hash?: string;
	/**
	 * The refresh token this row most recently rotated away from. Kept so that a
	 * replay of the superseded token is *detectable* rather than merely unknown
	 * — OAuth 2.1 §4.3.1 asks that reuse revoke the whole family.
	 */
	previous_refresh_hash?: string;
	client_id: string;
	client_name?: string;
	subject: string;
	org_id?: string;
	scopes: string[];
	/** The audience the token was minted for — the MCP server's canonical URI. */
	resource?: string;
	created_at: number;
	expires_at: number;
	refresh_expires_at?: number;
	last_used_at?: number;
}

export interface OauthClientStore {
	get(client_id: string): OauthClient | undefined | Promise<OauthClient | undefined>;
	create(client: OauthClient): void | Promise<void>;
}

export interface OauthCodeStore {
	create(code: OauthAuthorizationCode): void | Promise<void>;
	/**
	 * Reads *and deletes* in one step. Single-use is a property of the store,
	 * not of the caller: a read-then-delete pair leaves a window in which the
	 * same code redeems twice.
	 */
	take(
		code_hash: string,
	): OauthAuthorizationCode | undefined | Promise<OauthAuthorizationCode | undefined>;
}

export interface OauthTokenStore {
	create(token: OauthAccessToken): void | Promise<void>;
	getByAccessHash(
		hash: string,
	): OauthAccessToken | undefined | Promise<OauthAccessToken | undefined>;
	getByRefreshHash(
		hash: string,
	): OauthAccessToken | undefined | Promise<OauthAccessToken | undefined>;
	/**
	 * Finds a row by the refresh token it has already rotated away from.
	 *
	 * Optional, because it costs a second index. Implement it and a replayed
	 * refresh token revokes the family it came from; leave it out and the replay
	 * is merely refused, which is the weaker half of OAuth 2.1 §4.3.1.
	 */
	getByPreviousRefreshHash?(
		hash: string,
	): OauthAccessToken | undefined | Promise<OauthAccessToken | undefined>;
	/** Replaces a rotated token in place, keeping its id. */
	update(id: string, patch: Partial<OauthAccessToken>): void | Promise<void>;
	delete(id: string): void | Promise<void>;
	touch?(id: string, at: number): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** What the consent renderer is handed. Everything it needs to draw a decision. */
export interface OauthConsentContext {
	client: OauthClient;
	/** Scopes the client asked for, already narrowed to what the user may grant. */
	scopes: string[];
	/** Scopes the client asked for that the user does not hold. */
	denied_scopes: string[];
	subject: string;
	org_id?: string;
	/** The exact form fields a POST back to the authorization endpoint must carry. */
	fields: Record<string, string>;
	/** Where the consent form must POST. */
	action: string;
	request: Request;
}

/** The signed-in user, as the host application resolves them. */
export interface OauthResolvedUser {
	subject: string;
	org_id?: string;
	/** The ceiling: a token can never out-rank the session it was minted from. */
	scopes: string[];
}

export interface OauthProviderOptions {
	/**
	 * The authorization server's issuer identifier — an https origin, no path,
	 * no trailing slash. It is compared by exact string, so it must be written
	 * the same way everywhere it appears.
	 */
	issuer: string;
	/** The MCP server's canonical URI, the audience every token is bound to. */
	resource: string;
	/** Every scope the server can issue, in the order the app defines them. */
	scopes_supported: readonly string[];
	/** Where `authorize`, `token`, and `register` live. @default '/oauth' */
	base_path?: string;
	clients: OauthClientStore;
	codes: OauthCodeStore;
	tokens: OauthTokenStore;
	/** Resolves the browser session at the authorization endpoint. */
	resolveUser: (request: Request) => Promise<OauthResolvedUser | null>;
	/** Renders the consent screen. The application owns this UI. */
	renderConsent: (context: OauthConsentContext) => Response | Promise<Response>;
	/**
	 * Where to send an unauthenticated browser. Given the full authorization
	 * URL so the sign-in page can return to it.
	 */
	signInUrl?: (request: Request, return_to: string) => string;
	/** Dynamic client registration (RFC 7591). @default enabled */
	registration?: {
		enabled?: boolean;
		/** Scopes granted to a client that registers without asking. */
		default_scopes?: readonly string[];
		/** Rejects non-https redirect URIs other than loopback. @default true */
		require_https?: boolean;
		/**
		 * Runs before a registration is written. Throw to refuse — a
		 * `DelightError` carrying a status is answered with that status, anything
		 * else with 429.
		 *
		 * Injected rather than built in, for the same reason the MCP server's
		 * rate limiter is: registration is unauthenticated by design, so the only
		 * correct counter on Workers lives in a Durable Object the application
		 * owns.
		 */
		rateLimit?: (request: Request) => void | Promise<void>;
	};
	/** @default 1 hour */
	access_token_ttl_ms?: number;
	/** @default 60 days. `0` issues no refresh token. */
	refresh_token_ttl_ms?: number;
	/** @default 60 seconds — OAuth 2.1 wants codes short-lived. */
	code_ttl_ms?: number;
	/** Overridable for tests. @default Date.now */
	now?: () => number;
}

export interface OauthProvider {
	/**
	 * Handles the metadata, registration, authorization and token endpoints.
	 * Returns `undefined` for a path it does not own, so a host can chain it.
	 */
	fetch(request: Request): Promise<Response | undefined>;
	/**
	 * Validates a bearer token. Returns `null` when there is no `Authorization`
	 * header at all, and throws a `DelightError` when there is one that fails —
	 * "absent" and "wrong" want different challenges.
	 */
	authenticate(request: Request): Promise<McpAuthContext | null>;
	/** The RFC 9728 document, for a host that serves it from its own route. */
	protectedResourceMetadata(): Record<string, unknown>;
	/** The RFC 8414 document. */
	authorizationServerMetadata(): Record<string, unknown>;
	/** The `WWW-Authenticate` value for a 401 or an `insufficient_scope` 403. */
	challenge(options?: {
		error?: 'invalid_token' | 'insufficient_scope';
		error_description?: string;
		scope?: string | string[];
	}): string;
	/** The URL the challenge points at. */
	resource_metadata_url: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * A private-use URI scheme as RFC 8252 §7.1 defines one: a domain name the app
 * controls, in reverse order, so it always carries a dot. `com.example.app:` is
 * one; `javascript:` and `data:` are not.
 */
const PRIVATE_USE_SCHEME = /^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+:$/;

/**
 * The `code_verifier` grammar, RFC 7636 §4.1: 43–128 unreserved characters.
 * Checked because a short verifier is a guessable one, and the length is the
 * only part of PKCE's strength a server can enforce on a client's behalf.
 */
const CODE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;

function jsonResponse(
	body: unknown,
	status = 200,
	headers?: Record<string, string>,
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': status === 200 ? 'public, max-age=3600' : 'no-store',
			...headers,
		},
	});
}

function oauthError(status: number, error: string, description?: string): Response {
	return new Response(
		JSON.stringify(description ? { error, error_description: description } : { error }),
		{
			status,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
		},
	);
}

/** Redirects an *error* back to the client, per OAuth 2.1 §4.1.2.1. */
function redirectError(
	redirect_uri: string,
	error: string,
	description: string,
	state: string | null,
	issuer: string,
): Response {
	const url = new URL(redirect_uri);
	url.searchParams.set('error', error);
	url.searchParams.set('error_description', description);
	if (state) url.searchParams.set('state', state);
	// RFC 9207: the client validates this before sending the code anywhere.
	url.searchParams.set('iss', issuer);
	return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

/**
 * Adds the framing defences to whatever the application rendered.
 *
 * The consent screen is the one page in this flow where a click grants a token,
 * which makes it the one page worth framing. The application owns the markup,
 * so it cannot be relied on to own the headers too — and both are set only when
 * absent, so an application with a stricter policy of its own keeps it.
 */
function withConsentHeaders(response: Response): Response {
	const headers = new Headers(response.headers);
	if (!headers.has('X-Frame-Options')) headers.set('X-Frame-Options', 'DENY');
	if (!headers.has('Content-Security-Policy')) {
		headers.set('Content-Security-Policy', "frame-ancestors 'none'");
	}
	headers.set('Cache-Control', 'no-store');
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

/**
 * Whether two resource identifiers name the same server.
 *
 * RFC 8707 compares by simple string, and clients are told to send the
 * canonical form — but they are also told to be robust about scheme and host
 * case, and they disagree about the trailing slash. Normalizing those two
 * things and nothing else is the narrowest rule that accepts every correct
 * client without accepting a different server.
 */
function sameResource(a: string, b: string): boolean {
	const normalize = (value: string) => {
		try {
			const url = new URL(value);
			const path = url.pathname.replace(/\/$/, '');
			return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${path}${url.search}`;
		} catch {
			return value.replace(/\/$/, '').toLowerCase();
		}
	};
	return normalize(a) === normalize(b);
}

/**
 * Reads an `application/x-www-form-urlencoded` body.
 *
 * `formData()` rather than `text()`: workerd warns that reading a form body as
 * text may corrupt it, and the warning is right — the decoder it uses knows the
 * content type, and the hand-rolled path does not.
 */
async function readForm(request: Request): Promise<URLSearchParams> {
	const form = await request.formData();
	const params = new URLSearchParams();
	for (const [key, value] of form.entries()) {
		if (typeof value === 'string') params.set(key, value);
	}
	return params;
}

function parseScopes(scope: string | null | undefined): string[] {
	if (!scope) return [];
	return scope.split(/\s+/).filter(Boolean);
}

export function createOauthProvider(options: OauthProviderOptions): OauthProvider {
	const issuer = options.issuer.replace(/\/$/, '');
	const base_path = (options.base_path ?? '/oauth').replace(/\/$/, '');
	const now = options.now ?? (() => Date.now());
	const access_ttl = options.access_token_ttl_ms ?? 60 * 60 * 1000;
	const refresh_ttl = options.refresh_token_ttl_ms ?? 60 * 24 * 60 * 60 * 1000;
	const code_ttl = options.code_ttl_ms ?? 60 * 1000;
	const registration_enabled = options.registration?.enabled !== false;
	const require_https = options.registration?.require_https !== false;

	const authorization_endpoint = `${issuer}${base_path}/authorize`;
	const token_endpoint = `${issuer}${base_path}/token`;
	const registration_endpoint = `${issuer}${base_path}/register`;
	const resource_metadata_url = `${issuer}/.well-known/oauth-protected-resource`;

	function protectedResourceMetadata(): Record<string, unknown> {
		return {
			resource: options.resource,
			authorization_servers: [issuer],
			scopes_supported: [...options.scopes_supported],
			bearer_methods_supported: ['header'],
			resource_documentation: `${issuer}/docs/mcp`,
		};
	}

	function authorizationServerMetadata(): Record<string, unknown> {
		return {
			issuer,
			authorization_endpoint,
			token_endpoint,
			...(registration_enabled ? { registration_endpoint } : {}),
			scopes_supported: [...options.scopes_supported],
			response_types_supported: ['code'],
			grant_types_supported: ['authorization_code', 'refresh_token'],
			// `plain` is absent on purpose: advertising it invites a client to use
			// it, and OAuth 2.1 removed it.
			code_challenge_methods_supported: ['S256'],
			token_endpoint_auth_methods_supported: [
				'none',
				'client_secret_post',
				'client_secret_basic',
			],
			authorization_response_iss_parameter_supported: true,
			resource_indicators_supported: true,
		};
	}

	function challenge(challenge_options?: {
		error?: 'invalid_token' | 'insufficient_scope';
		error_description?: string;
		scope?: string | string[];
	}): string {
		const parts = [`resource_metadata="${resource_metadata_url}"`];
		if (challenge_options?.error) parts.unshift(`error="${challenge_options.error}"`);
		if (challenge_options?.error_description) {
			parts.push(
				`error_description="${challenge_options.error_description.replace(/"/g, "'")}"`,
			);
		}
		const scope = challenge_options?.scope;
		if (scope) {
			parts.push(`scope="${Array.isArray(scope) ? scope.join(' ') : scope}"`);
		}
		return `Bearer ${parts.join(', ')}`;
	}

	// -- registration --------------------------------------------------------

	function validateRedirectUri(uri: string): string | undefined {
		let url: URL;
		try {
			url = new URL(uri);
		} catch {
			return 'redirect_uris must be absolute URIs';
		}
		if (url.hash) return 'redirect_uris must not contain a fragment';
		if (url.protocol === 'https:') return undefined;
		// A CLI's loopback listener and a desktop app's private-use scheme are
		// both public clients redirecting to software on the user's own machine;
		// neither can be https, and both are what `claude mcp add` uses.
		if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return undefined;
		if (url.protocol !== 'http:') {
			// An allowlist rather than a denylist. A redirect target is a URL this
			// server hands to a user agent, and `javascript:`, `data:`, `blob:`,
			// `file:` and friends all parse as perfectly good absolute URIs — so
			// the question is not which schemes are dangerous but which one is
			// asked for, and RFC 8252 §7.1 answers it: a private-use scheme is a
			// reverse-DNS name the app controls, which always has a dot in it.
			return PRIVATE_USE_SCHEME.test(url.protocol)
				? undefined
				: 'redirect_uris must use https, loopback http, or a reverse-DNS private-use scheme';
		}
		return require_https ? 'redirect_uris must use https, except on loopback' : undefined;
	}

	async function handleRegister(request: Request): Promise<Response> {
		if (!registration_enabled) {
			return oauthError(
				404,
				'invalid_request',
				'Dynamic client registration is disabled',
			);
		}
		if (options.registration?.rateLimit) {
			try {
				await options.registration.rateLimit(request);
			} catch (error) {
				const status = DelightError.is(error) ? error.status : 429;
				return oauthError(
					status,
					'invalid_request',
					DelightError.is(error) ? error.message : 'Too many registrations',
				);
			}
		}
		let body: Record<string, unknown>;
		try {
			body = (await request.json()) as Record<string, unknown>;
		} catch {
			return oauthError(400, 'invalid_client_metadata', 'Body must be JSON');
		}

		const redirect_uris = Array.isArray(body.redirect_uris)
			? body.redirect_uris.filter((u): u is string => typeof u === 'string')
			: [];
		if (!redirect_uris.length) {
			return oauthError(
				400,
				'invalid_redirect_uri',
				'At least one redirect_uri is required',
			);
		}
		for (const uri of redirect_uris) {
			const problem = validateRedirectUri(uri);
			if (problem) return oauthError(400, 'invalid_redirect_uri', problem);
		}

		const requested_auth_method =
			typeof body.token_endpoint_auth_method === 'string'
				? body.token_endpoint_auth_method
				: 'none';
		if (
			!['none', 'client_secret_post', 'client_secret_basic'].includes(
				requested_auth_method,
			)
		) {
			return oauthError(
				400,
				'invalid_client_metadata',
				`Unsupported token_endpoint_auth_method "${requested_auth_method}"`,
			);
		}

		const grant_types = Array.isArray(body.grant_types)
			? body.grant_types.filter((g): g is string => typeof g === 'string')
			: ['authorization_code', 'refresh_token'];
		const unsupported = grant_types.filter(
			(g) => g !== 'authorization_code' && g !== 'refresh_token',
		);
		if (unsupported.length) {
			return oauthError(
				400,
				'invalid_client_metadata',
				`Unsupported grant_types: ${unsupported.join(', ')}`,
			);
		}

		const requested_scopes = parseScopes(
			typeof body.scope === 'string' ? body.scope : undefined,
		);
		const default_scopes =
			options.registration?.default_scopes ?? options.scopes_supported;
		const scopes = (
			requested_scopes.length ? requested_scopes : [...default_scopes]
		).filter((scope) => options.scopes_supported.includes(scope));

		const issued_at = now();
		const client_secret = requested_auth_method === 'none' ? undefined : randomToken(32);
		const client: OauthClient = {
			client_id: randomToken(16),
			client_id_issued_at: Math.floor(issued_at / 1000),
			client_name: typeof body.client_name === 'string' ? body.client_name : undefined,
			redirect_uris,
			grant_types,
			response_types: ['code'],
			scope: scopes.join(' '),
			token_endpoint_auth_method:
				requested_auth_method as OauthClient['token_endpoint_auth_method'],
			client_secret_hash: client_secret ? await hashToken(client_secret) : undefined,
			client_uri: typeof body.client_uri === 'string' ? body.client_uri : undefined,
			logo_uri: typeof body.logo_uri === 'string' ? body.logo_uri : undefined,
			policy_uri: typeof body.policy_uri === 'string' ? body.policy_uri : undefined,
			tos_uri: typeof body.tos_uri === 'string' ? body.tos_uri : undefined,
			software_id: typeof body.software_id === 'string' ? body.software_id : undefined,
			software_version:
				typeof body.software_version === 'string' ? body.software_version : undefined,
		};
		await options.clients.create(client);

		return jsonResponse(
			{
				client_id: client.client_id,
				client_id_issued_at: client.client_id_issued_at,
				...(client_secret ? { client_secret, client_secret_expires_at: 0 } : {}),
				client_name: client.client_name,
				redirect_uris: client.redirect_uris,
				grant_types: client.grant_types,
				response_types: client.response_types,
				scope: client.scope,
				token_endpoint_auth_method: client.token_endpoint_auth_method,
			},
			201,
			{ 'Cache-Control': 'no-store' },
		);
	}

	// -- authorization -------------------------------------------------------

	interface AuthorizeParams {
		client_id: string;
		redirect_uri: string;
		scope: string;
		state: string | null;
		code_challenge: string;
		resource: string | null;
	}

	function readAuthorizeParams(
		source: URLSearchParams,
	): { params: AuthorizeParams; client_id: string } | Response {
		const client_id = source.get('client_id');
		if (!client_id) return oauthError(400, 'invalid_request', 'client_id is required');
		if (source.get('response_type') !== 'code') {
			return oauthError(
				400,
				'unsupported_response_type',
				'Only the authorization code grant is supported',
			);
		}
		const code_challenge = source.get('code_challenge');
		if (!code_challenge) {
			return oauthError(400, 'invalid_request', 'code_challenge is required (PKCE)');
		}
		const method = source.get('code_challenge_method');
		if (method !== 'S256') {
			return oauthError(400, 'invalid_request', 'code_challenge_method must be S256');
		}
		return {
			client_id,
			params: {
				client_id,
				redirect_uri: source.get('redirect_uri') ?? '',
				scope: source.get('scope') ?? '',
				state: source.get('state'),
				code_challenge,
				resource: source.get('resource'),
			},
		};
	}

	function resolveRedirectUri(
		client: OauthClient,
		requested: string,
	): { redirect_uri: string } | Response {
		if (!requested) {
			if (client.redirect_uris.length === 1)
				return { redirect_uri: client.redirect_uris[0] };
			return oauthError(
				400,
				'invalid_request',
				'redirect_uri is required when a client registers more than one',
			);
		}
		// Exact string match, never a prefix match: a prefix match on a loopback
		// URI lets any path on the same port collect the code.
		if (!client.redirect_uris.includes(requested)) {
			return oauthError(400, 'invalid_request', 'redirect_uri is not registered');
		}
		return { redirect_uri: requested };
	}

	async function handleAuthorizeGet(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const read = readAuthorizeParams(url.searchParams);
		if (read instanceof Response) return read;

		const client = await options.clients.get(read.client_id);
		if (!client) return oauthError(400, 'invalid_client', 'Unknown client_id');

		const redirect = resolveRedirectUri(client, read.params.redirect_uri);
		if (redirect instanceof Response) return redirect;
		const redirect_uri = redirect.redirect_uri;

		if (read.params.resource && !sameResource(read.params.resource, options.resource)) {
			return redirectError(
				redirect_uri,
				'invalid_target',
				`This authorization server issues tokens for ${options.resource}`,
				read.params.state,
				issuer,
			);
		}

		const user = await options.resolveUser(request);
		if (!user) {
			const return_to = url.toString();
			const sign_in = options.signInUrl?.(request, return_to);
			if (!sign_in) {
				return oauthError(
					401,
					'access_denied',
					'Sign in before authorizing an application',
				);
			}
			return new Response(null, { status: 302, headers: { Location: sign_in } });
		}

		const requested = parseScopes(read.params.scope);
		const client_scopes = parseScopes(client.scope);
		const askable = requested.length ? requested : client_scopes;
		const granted = askable.filter(
			(scope) => options.scopes_supported.includes(scope) && user.scopes.includes(scope),
		);
		const denied = askable.filter((scope) => !granted.includes(scope));
		if (!granted.length) {
			return redirectError(
				redirect_uri,
				'invalid_scope',
				'This account holds none of the requested scopes',
				read.params.state,
				issuer,
			);
		}

		return withConsentHeaders(
			await options.renderConsent({
				client,
				scopes: granted,
				denied_scopes: denied,
				subject: user.subject,
				org_id: user.org_id,
				action: `${base_path}/authorize`,
				fields: {
					client_id: client.client_id,
					redirect_uri,
					response_type: 'code',
					scope: granted.join(' '),
					code_challenge: read.params.code_challenge,
					code_challenge_method: 'S256',
					...(read.params.state ? { state: read.params.state } : {}),
					...(read.params.resource ? { resource: read.params.resource } : {}),
				},
				request,
			}),
		);
	}

	async function handleAuthorizePost(request: Request): Promise<Response> {
		// The consent POST is the one request in the flow that a third-party page
		// could forge on a signed-in user's behalf, and the grant it produces is
		// a token for *their* vault. A same-origin check is the whole defence,
		// so it is applied before anything is read.
		const origin = request.headers.get('Origin');
		if (origin && new URL(origin).origin !== new URL(issuer).origin) {
			return oauthError(403, 'access_denied', 'Cross-origin consent is refused');
		}

		const form = await readForm(request);
		const read = readAuthorizeParams(form);
		if (read instanceof Response) return read;

		const client = await options.clients.get(read.client_id);
		if (!client) return oauthError(400, 'invalid_client', 'Unknown client_id');

		const redirect = resolveRedirectUri(client, read.params.redirect_uri);
		if (redirect instanceof Response) return redirect;
		const redirect_uri = redirect.redirect_uri;

		// Re-checked rather than trusted: the field came back through the browser,
		// so a tampered `resource` would otherwise be written into the code and
		// mint a token this server then refuses at its own door.
		if (read.params.resource && !sameResource(read.params.resource, options.resource)) {
			return redirectError(
				redirect_uri,
				'invalid_target',
				`This authorization server issues tokens for ${options.resource}`,
				read.params.state,
				issuer,
			);
		}

		const user = await options.resolveUser(request);
		if (!user)
			return oauthError(401, 'access_denied', 'The session ended before consent');

		if (form.get('approved') === 'false') {
			return redirectError(
				redirect_uri,
				'access_denied',
				'The user declined',
				read.params.state,
				issuer,
			);
		}

		// Re-narrowed rather than trusted: the scope field came back through the
		// browser, so the ceiling is re-applied to whatever it now says.
		const granted = parseScopes(read.params.scope).filter(
			(scope) => options.scopes_supported.includes(scope) && user.scopes.includes(scope),
		);
		if (!granted.length) {
			return redirectError(
				redirect_uri,
				'invalid_scope',
				'This account holds none of the requested scopes',
				read.params.state,
				issuer,
			);
		}

		const code = randomToken(32);
		await options.codes.create({
			code_hash: await hashToken(code),
			client_id: client.client_id,
			redirect_uri,
			scopes: granted,
			code_challenge: read.params.code_challenge,
			code_challenge_method: 'S256',
			resource: read.params.resource ?? options.resource,
			subject: user.subject,
			org_id: user.org_id,
			expires_at: now() + code_ttl,
		});

		const location = new URL(redirect_uri);
		location.searchParams.set('code', code);
		if (read.params.state) location.searchParams.set('state', read.params.state);
		location.searchParams.set('iss', issuer);
		return new Response(null, {
			status: 302,
			headers: { Location: location.toString(), 'Cache-Control': 'no-store' },
		});
	}

	// -- token ---------------------------------------------------------------

	async function authenticateClient(
		request: Request,
		form: URLSearchParams,
	): Promise<{ client: OauthClient } | Response> {
		let client_id = form.get('client_id') ?? '';
		let client_secret = form.get('client_secret') ?? '';

		const header = request.headers.get('Authorization');
		if (header?.startsWith('Basic ')) {
			try {
				const decoded = atob(header.slice(6));
				const separator = decoded.indexOf(':');
				if (separator < 0) throw new Error('malformed');
				client_id = decodeURIComponent(decoded.slice(0, separator));
				client_secret = decodeURIComponent(decoded.slice(separator + 1));
			} catch {
				return oauthError(401, 'invalid_client', 'Malformed Basic credentials');
			}
		}

		if (!client_id) return oauthError(401, 'invalid_client', 'client_id is required');
		const client = await options.clients.get(client_id);
		if (!client) return oauthError(401, 'invalid_client', 'Unknown client_id');

		if (client.token_endpoint_auth_method === 'none') {
			// A public client proves nothing here; PKCE is what binds the code to
			// the software that started the flow.
			return { client };
		}
		if (!client_secret || !client.client_secret_hash) {
			return oauthError(401, 'invalid_client', 'client_secret is required');
		}
		const presented = await hashToken(client_secret);
		if (!timingSafeEqual(presented, client.client_secret_hash)) {
			return oauthError(401, 'invalid_client', 'client_secret is wrong');
		}
		return { client };
	}

	async function issueToken(grant: {
		client: OauthClient;
		subject: string;
		org_id?: string;
		scopes: string[];
		resource?: string;
		/** Reuses an existing row on refresh, so revocation survives rotation. */
		token_id?: string;
		/** The refresh token being rotated away from, for reuse detection. */
		previous_refresh_hash?: string;
	}): Promise<Response> {
		const issued_at = now();
		const access_token = randomToken(32);
		const refresh_token = refresh_ttl > 0 ? randomToken(32) : undefined;
		const record: OauthAccessToken = {
			id: grant.token_id ?? randomToken(16),
			token_hash: await hashToken(access_token),
			refresh_hash: refresh_token ? await hashToken(refresh_token) : undefined,
			previous_refresh_hash: grant.previous_refresh_hash,
			client_id: grant.client.client_id,
			client_name: grant.client.client_name,
			subject: grant.subject,
			org_id: grant.org_id,
			scopes: grant.scopes,
			resource: grant.resource ?? options.resource,
			created_at: issued_at,
			expires_at: issued_at + access_ttl,
			refresh_expires_at: refresh_token ? issued_at + refresh_ttl : undefined,
		};

		if (grant.token_id) {
			await options.tokens.update(grant.token_id, record);
		} else {
			await options.tokens.create(record);
		}

		return jsonResponse(
			{
				access_token,
				token_type: 'Bearer',
				expires_in: Math.floor(access_ttl / 1000),
				scope: grant.scopes.join(' '),
				...(refresh_token ? { refresh_token } : {}),
			},
			200,
			{ 'Cache-Control': 'no-store' },
		);
	}

	async function handleToken(request: Request): Promise<Response> {
		const content_type = request.headers.get('Content-Type') ?? '';
		if (!content_type.includes('application/x-www-form-urlencoded')) {
			return oauthError(
				400,
				'invalid_request',
				'The token endpoint takes application/x-www-form-urlencoded',
			);
		}
		const form = await readForm(request);

		const authenticated = await authenticateClient(request, form);
		if (authenticated instanceof Response) return authenticated;
		const client = authenticated.client;

		const grant_type = form.get('grant_type');
		const resource = form.get('resource');
		if (resource && !sameResource(resource, options.resource)) {
			return oauthError(
				400,
				'invalid_target',
				`This authorization server issues tokens for ${options.resource}`,
			);
		}

		if (grant_type === 'authorization_code') {
			const code = form.get('code');
			const verifier = form.get('code_verifier');
			if (!code) return oauthError(400, 'invalid_request', 'code is required');
			if (!verifier)
				return oauthError(400, 'invalid_request', 'code_verifier is required');
			// Checked before the code is taken, so a malformed verifier does not
			// burn the code: the client can retry the exchange it got wrong.
			if (!CODE_VERIFIER.test(verifier)) {
				return oauthError(
					400,
					'invalid_grant',
					'code_verifier must be 43–128 unreserved characters (RFC 7636 §4.1)',
				);
			}

			const record = await options.codes.take(await hashToken(code));
			if (!record)
				return oauthError(400, 'invalid_grant', 'Unknown or already-used code');
			if (record.expires_at < now()) {
				return oauthError(400, 'invalid_grant', 'The authorization code expired');
			}
			if (record.client_id !== client.client_id) {
				return oauthError(400, 'invalid_grant', 'The code was issued to another client');
			}
			const requested_redirect = form.get('redirect_uri');
			if (requested_redirect && requested_redirect !== record.redirect_uri) {
				return oauthError(
					400,
					'invalid_grant',
					'redirect_uri does not match the request',
				);
			}
			if (!timingSafeEqual(await sha256Base64Url(verifier), record.code_challenge)) {
				return oauthError(
					400,
					'invalid_grant',
					'code_verifier does not match the challenge',
				);
			}

			return issueToken({
				client,
				subject: record.subject,
				org_id: record.org_id,
				scopes: record.scopes,
				resource: record.resource,
			});
		}

		if (grant_type === 'refresh_token') {
			const presented = form.get('refresh_token');
			if (!presented)
				return oauthError(400, 'invalid_request', 'refresh_token is required');
			const presented_hash = await hashToken(presented);
			const record = await options.tokens.getByRefreshHash(presented_hash);
			if (!record) {
				// Not merely unknown: if it is the token this row *rotated away
				// from*, then two parties hold the family and only one of them can
				// be the client. OAuth 2.1 §4.3.1 says revoke, so the row goes —
				// the legitimate client re-authorizes, and the thief gets nothing.
				const superseded =
					await options.tokens.getByPreviousRefreshHash?.(presented_hash);
				if (superseded) {
					await options.tokens.delete(superseded.id);
					return oauthError(
						400,
						'invalid_grant',
						'This refresh token was already rotated; the grant has been revoked',
					);
				}
				return oauthError(400, 'invalid_grant', 'Unknown refresh token');
			}
			if (record.client_id !== client.client_id) {
				return oauthError(400, 'invalid_grant', 'The token was issued to another client');
			}
			if (record.refresh_expires_at !== undefined && record.refresh_expires_at < now()) {
				await options.tokens.delete(record.id);
				return oauthError(400, 'invalid_grant', 'The refresh token expired');
			}

			// A refresh may narrow the grant but never widen it.
			const asked = parseScopes(form.get('scope'));
			const scopes = asked.length
				? asked.filter((scope) => record.scopes.includes(scope))
				: record.scopes;
			if (!scopes.length) return oauthError(400, 'invalid_scope', 'No overlapping scope');

			return issueToken({
				client,
				subject: record.subject,
				org_id: record.org_id,
				scopes,
				resource: record.resource,
				token_id: record.id,
				previous_refresh_hash: presented_hash,
			});
		}

		return oauthError(
			400,
			'unsupported_grant_type',
			`Unsupported grant_type "${grant_type}"`,
		);
	}

	// -- resource server -----------------------------------------------------

	async function authenticate(request: Request): Promise<McpAuthContext | null> {
		const header = request.headers.get('Authorization');
		if (!header) return null;
		const match = /^Bearer\s+([^\s,]+)$/i.exec(header.trim());
		if (!match) {
			throw new DelightError({
				message: 'Authorization must be a Bearer token',
				status: 401,
				code: 'invalid_token',
			});
		}

		const record = await options.tokens.getByAccessHash(await hashToken(match[1]));
		if (!record) {
			throw new DelightError({
				message: 'This access token is not recognized',
				status: 401,
				code: 'invalid_token',
			});
		}
		if (record.expires_at < now()) {
			throw new DelightError({
				message: 'This access token has expired',
				status: 401,
				code: 'invalid_token',
			});
		}
		// The audience check is what stops a token minted for another resource by
		// the same authorization server from being replayed here.
		if (record.resource && !sameResource(record.resource, options.resource)) {
			throw new DelightError({
				message: 'This access token was issued for another resource',
				status: 401,
				code: 'invalid_token',
			});
		}

		await options.tokens.touch?.(record.id, now());

		return {
			subject: record.subject,
			org_id: record.org_id,
			scopes: record.scopes,
			client_id: record.client_id,
			client_name: record.client_name,
			token_id: record.id,
		};
	}

	// -- routing -------------------------------------------------------------

	async function fetchHandler(request: Request): Promise<Response | undefined> {
		const url = new URL(request.url);
		const path = url.pathname.replace(/\/$/, '') || '/';

		// RFC 9728 allows the path-suffixed form so one origin can host several
		// protected resources; both are answered because clients differ.
		if (
			path === '/.well-known/oauth-protected-resource' ||
			path.startsWith('/.well-known/oauth-protected-resource/')
		) {
			return jsonResponse(protectedResourceMetadata());
		}
		if (
			path === '/.well-known/oauth-authorization-server' ||
			path.startsWith('/.well-known/oauth-authorization-server/') ||
			path === '/.well-known/openid-configuration'
		) {
			return jsonResponse(authorizationServerMetadata());
		}

		if (path === `${base_path}/register`) {
			if (request.method !== 'POST')
				return oauthError(405, 'invalid_request', 'Use POST');
			return handleRegister(request);
		}
		if (path === `${base_path}/authorize`) {
			if (request.method === 'GET') return handleAuthorizeGet(request);
			if (request.method === 'POST') return handleAuthorizePost(request);
			return oauthError(405, 'invalid_request', 'Use GET or POST');
		}
		if (path === `${base_path}/token`) {
			if (request.method !== 'POST')
				return oauthError(405, 'invalid_request', 'Use POST');
			return handleToken(request);
		}
		return undefined;
	}

	return {
		fetch: fetchHandler,
		authenticate,
		protectedResourceMetadata,
		authorizationServerMetadata,
		challenge,
		resource_metadata_url,
	};
}

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

/**
 * In-memory stores, for tests and for `vite dev`.
 *
 * Not for production, for the same reason {@link createMemorySessionStore} is
 * not: an isolate recycling between the authorization redirect and the token
 * exchange would lose the code, and every restart would sign out every agent.
 */
export function createMemoryOauthStores(): {
	clients: OauthClientStore;
	codes: OauthCodeStore;
	tokens: OauthTokenStore;
} {
	const clients = new Map<string, OauthClient>();
	const codes = new Map<string, OauthAuthorizationCode>();
	const tokens = new Map<string, OauthAccessToken>();

	return {
		clients: {
			get: (client_id) => clients.get(client_id),
			create: (client) => void clients.set(client.client_id, { ...client }),
		},
		codes: {
			create: (code) => void codes.set(code.code_hash, { ...code }),
			take(code_hash) {
				const code = codes.get(code_hash);
				codes.delete(code_hash);
				return code;
			},
		},
		tokens: {
			create: (token) => void tokens.set(token.id, { ...token }),
			getByAccessHash: (hash) =>
				[...tokens.values()].find((token) => token.token_hash === hash),
			getByRefreshHash: (hash) =>
				[...tokens.values()].find((token) => token.refresh_hash === hash),
			getByPreviousRefreshHash: (hash) =>
				[...tokens.values()].find((token) => token.previous_refresh_hash === hash),
			update(id, patch) {
				const existing = tokens.get(id);
				if (existing) tokens.set(id, { ...existing, ...patch, id });
			},
			delete: (id) => void tokens.delete(id),
			touch(id, at) {
				const existing = tokens.get(id);
				if (existing) existing.last_used_at = at;
			},
		},
	};
}
