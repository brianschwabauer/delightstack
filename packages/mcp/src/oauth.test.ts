import { describe, expect, it } from 'vitest';
import { randomToken, sha256Base64Url } from './crypto.js';
import {
	createMemoryOauthStores,
	createOauthProvider,
	type OauthProvider,
	type OauthResolvedUser,
} from './oauth.js';

/**
 * The whole flow, driven the way `claude mcp add` drives it: discover, register,
 * authorize with PKCE, redeem, call, refresh.
 */

/**
 * `Response.json()` is typed `unknown`, and every body in this file is a JSON
 * object with a known shape, so the decode is done once here rather than cast
 * at forty call sites.
 */
async function json<T>(response: Response | undefined): Promise<T> {
	return (await response!.json()) as T;
}

/** The OAuth error body, and the two success bodies these tests read. */
interface ErrorBody {
	error?: string;
	error_description?: string;
}

/** A successful token response. The error shape is {@link ErrorBody}. */
interface TokenBody {
	access_token: string;
	refresh_token: string;
	token_type: string;
	expires_in: number;
	scope: string;
}

interface MetadataBody {
	issuer?: string;
	resource?: string;
	authorization_servers?: string[];
	scopes_supported?: string[];
	code_challenge_methods_supported?: string[];
	grant_types_supported?: string[];
	response_types_supported?: string[];
	token_endpoint_auth_methods_supported?: string[];
	authorization_response_iss_parameter_supported?: boolean;
	registration_endpoint?: string;
}

interface ClientBody {
	client_id: string;
	client_secret?: string;
	token_endpoint_auth_method?: string;
}

const ISSUER = 'https://write.example.com';
const RESOURCE = 'https://write.example.com/mcp';
const SCOPES = ['vault:read', 'vault:write', 'vault:admin'] as const;
const REDIRECT = 'http://localhost:57891/callback';

const USER: OauthResolvedUser = {
	subject: 'user_1',
	org_id: 'org_1',
	scopes: ['vault:read', 'vault:write'],
};

function build(overrides?: Partial<Parameters<typeof createOauthProvider>[0]>) {
	const stores = createMemoryOauthStores();
	const provider = createOauthProvider({
		issuer: ISSUER,
		resource: RESOURCE,
		scopes_supported: SCOPES,
		...stores,
		resolveUser: async () => USER,
		renderConsent: (context) =>
			new Response(
				`<form method="post" action="${context.action}">${context.scopes.join(' ')}</form>`,
				{ headers: { 'Content-Type': 'text/html' } },
			),
		...overrides,
	});
	return { provider, ...stores };
}

/** Generates a PKCE pair the way a client does. */
async function pkce(): Promise<{ verifier: string; challenge: string }> {
	const verifier = randomToken(32);
	return { verifier, challenge: await sha256Base64Url(verifier) };
}

async function register(
	provider: OauthProvider,
	body?: Record<string, unknown>,
): Promise<ClientBody> {
	const response = await provider.fetch(
		new Request(`${ISSUER}/oauth/register`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				client_name: 'Claude Code',
				redirect_uris: [REDIRECT],
				grant_types: ['authorization_code', 'refresh_token'],
				token_endpoint_auth_method: 'none',
				...body,
			}),
		}),
	);
	expect(response!.status).toBe(201);
	return json<ClientBody>(response);
}

function authorizeUrl(
	client_id: string,
	challenge: string,
	extra?: Record<string, string>,
): string {
	const url = new URL(`${ISSUER}/oauth/authorize`);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('client_id', client_id);
	url.searchParams.set('redirect_uri', REDIRECT);
	url.searchParams.set('scope', 'vault:read vault:write');
	url.searchParams.set('state', 'state_123');
	url.searchParams.set('code_challenge', challenge);
	url.searchParams.set('code_challenge_method', 'S256');
	url.searchParams.set('resource', RESOURCE);
	for (const [key, value] of Object.entries(extra ?? {}))
		url.searchParams.set(key, value);
	return url.toString();
}

async function consent(
	provider: OauthProvider,
	client_id: string,
	challenge: string,
	extra?: Record<string, string>,
): Promise<Response> {
	const form = new URLSearchParams({
		response_type: 'code',
		client_id,
		redirect_uri: REDIRECT,
		scope: 'vault:read vault:write',
		state: 'state_123',
		code_challenge: challenge,
		code_challenge_method: 'S256',
		resource: RESOURCE,
		approved: 'true',
		...extra,
	});
	return (await provider.fetch(
		new Request(`${ISSUER}/oauth/authorize`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ISSUER },
			body: form.toString(),
		}),
	))!;
}

async function token(
	provider: OauthProvider,
	fields: Record<string, string>,
): Promise<Response> {
	return (await provider.fetch(
		new Request(`${ISSUER}/oauth/token`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams(fields).toString(),
		}),
	))!;
}

describe('discovery metadata', () => {
	it('serves protected resource metadata naming the authorization server', async () => {
		const { provider } = build();
		const response = await provider.fetch(
			new Request(`${ISSUER}/.well-known/oauth-protected-resource`),
		);
		const body = await json<MetadataBody>(response);
		expect(body.resource).toBe(RESOURCE);
		expect(body.authorization_servers).toEqual([ISSUER]);
		expect(body.scopes_supported).toEqual([...SCOPES]);
	});

	it('serves it at the path-suffixed form too', async () => {
		const { provider } = build();
		const response = await provider.fetch(
			new Request(`${ISSUER}/.well-known/oauth-protected-resource/mcp`),
		);
		expect(response!.status).toBe(200);
	});

	it('advertises S256 only, and never `plain`', async () => {
		const { provider } = build();
		const body = await json<MetadataBody>(
			await provider.fetch(
				new Request(`${ISSUER}/.well-known/oauth-authorization-server`),
			),
		);
		expect(body.code_challenge_methods_supported).toEqual(['S256']);
		expect(body.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
		expect(body.response_types_supported).toEqual(['code']);
		expect(body.authorization_response_iss_parameter_supported).toBe(true);
		expect(body.registration_endpoint).toBe(`${ISSUER}/oauth/register`);
	});

	it('answers the OpenID discovery path with the same document', async () => {
		const { provider } = build();
		const response = await provider.fetch(
			new Request(`${ISSUER}/.well-known/openid-configuration`),
		);
		expect((await json<MetadataBody>(response)).issuer).toBe(ISSUER);
	});

	it('leaves a path it does not own to the host', async () => {
		const { provider } = build();
		expect(await provider.fetch(new Request(`${ISSUER}/settings`))).toBeUndefined();
	});
});

describe('dynamic client registration', () => {
	it('registers a public client and issues no secret', async () => {
		const { provider } = build();
		const client = await register(provider);
		expect(client.client_id).toBeTruthy();
		expect(client.client_secret).toBeUndefined();
		expect(client.token_endpoint_auth_method).toBe('none');
	});

	it('issues a secret to a confidential client', async () => {
		const { provider } = build();
		const client = await register(provider, {
			token_endpoint_auth_method: 'client_secret_post',
		});
		expect(client.client_secret).toBeTruthy();
	});

	it('stores the secret only as a digest', async () => {
		const { provider, clients } = build();
		const registered = await register(provider, {
			token_endpoint_auth_method: 'client_secret_post',
		});
		const stored = await clients.get(registered.client_id);
		expect(stored!.client_secret_hash).toBeTruthy();
		expect(stored!.client_secret_hash).not.toBe(registered.client_secret);
	});

	it('accepts a loopback http redirect, which is what a CLI needs', async () => {
		const { provider } = build();
		await expect(
			register(provider, { redirect_uris: ['http://127.0.0.1:1455/cb'] }),
		).resolves.toBeTruthy();
	});

	it('refuses a plain-http redirect that is not loopback', async () => {
		const { provider } = build();
		const response = await provider.fetch(
			new Request(`${ISSUER}/oauth/register`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ redirect_uris: ['http://evil.test/cb'] }),
			}),
		);
		expect(response!.status).toBe(400);
		expect((await json<ErrorBody>(response)).error).toBe('invalid_redirect_uri');
	});

	it('refuses a redirect carrying a fragment', async () => {
		const { provider } = build();
		const response = await provider.fetch(
			new Request(`${ISSUER}/oauth/register`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ redirect_uris: ['https://app.test/cb#x'] }),
			}),
		);
		expect(response!.status).toBe(400);
	});

	it('refuses a grant type it does not implement', async () => {
		const { provider } = build();
		const response = await provider.fetch(
			new Request(`${ISSUER}/oauth/register`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					redirect_uris: [REDIRECT],
					grant_types: ['client_credentials'],
				}),
			}),
		);
		expect(response!.status).toBe(400);
	});

	it('can be turned off entirely', async () => {
		const { provider } = build({ registration: { enabled: false } });
		const response = await provider.fetch(
			new Request(`${ISSUER}/oauth/register`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{}',
			}),
		);
		expect(response!.status).toBe(404);
	});
});

describe('the authorization endpoint', () => {
	it('renders the consent screen for a signed-in user', async () => {
		const { provider } = build();
		const client = await register(provider);
		const { challenge } = await pkce();
		const response = await provider.fetch(
			new Request(authorizeUrl(client.client_id, challenge)),
		);
		expect(response!.status).toBe(200);
		expect(await response!.text()).toContain('vault:read vault:write');
	});

	it('narrows the offered scopes to what the user actually holds', async () => {
		const { provider } = build({
			resolveUser: async () => ({ ...USER, scopes: ['vault:read'] }),
		});
		const client = await register(provider);
		const { challenge } = await pkce();
		const response = await provider.fetch(
			new Request(authorizeUrl(client.client_id, challenge)),
		);
		const html = await response!.text();
		expect(html).toContain('vault:read');
		expect(html).not.toContain('vault:write');
	});

	it('sends an unauthenticated browser to sign in, and back again', async () => {
		const { provider } = build({
			resolveUser: async () => null,
			signInUrl: (_request, return_to) =>
				`${ISSUER}/signin?redirect=${encodeURIComponent(return_to)}`,
		});
		const client = await register(provider);
		const { challenge } = await pkce();
		const response = await provider.fetch(
			new Request(authorizeUrl(client.client_id, challenge)),
		);
		expect(response!.status).toBe(302);
		expect(response!.headers.get('Location')).toContain('/signin?redirect=');
		expect(decodeURIComponent(response!.headers.get('Location')!)).toContain(
			'/oauth/authorize',
		);
	});

	it('refuses a request with no PKCE challenge', async () => {
		const { provider } = build();
		const client = await register(provider);
		const url = new URL(authorizeUrl(client.client_id, 'x'));
		url.searchParams.delete('code_challenge');
		const response = await provider.fetch(new Request(url));
		expect(response!.status).toBe(400);
		expect((await json<ErrorBody>(response)).error_description).toContain('PKCE');
	});

	it('refuses the `plain` challenge method', async () => {
		const { provider } = build();
		const client = await register(provider);
		const { challenge } = await pkce();
		const url = authorizeUrl(client.client_id, challenge, {
			code_challenge_method: 'plain',
		});
		const response = await provider.fetch(new Request(url));
		expect(response!.status).toBe(400);
	});

	it('refuses an unregistered redirect_uri rather than redirecting to it', async () => {
		const { provider } = build();
		const client = await register(provider);
		const { challenge } = await pkce();
		const url = authorizeUrl(client.client_id, challenge, {
			redirect_uri: 'http://localhost:57891/callback/../steal',
		});
		const response = await provider.fetch(new Request(url));
		expect(response!.status).toBe(400);
		expect(response!.headers.get('Location')).toBeNull();
	});

	it('redirects a resource mismatch back to the client as an error', async () => {
		const { provider } = build();
		const client = await register(provider);
		const { challenge } = await pkce();
		const url = authorizeUrl(client.client_id, challenge, {
			resource: 'https://other.example.com/mcp',
		});
		const response = await provider.fetch(new Request(url));
		expect(response!.status).toBe(302);
		const location = new URL(response!.headers.get('Location')!);
		expect(location.searchParams.get('error')).toBe('invalid_target');
		expect(location.searchParams.get('state')).toBe('state_123');
	});

	it('refuses a cross-origin consent POST', async () => {
		const { provider } = build();
		const client = await register(provider);
		const { challenge } = await pkce();
		const response = await provider.fetch(
			new Request(`${ISSUER}/oauth/authorize`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Origin: 'https://evil.test',
				},
				body: new URLSearchParams({
					response_type: 'code',
					client_id: client.client_id,
					redirect_uri: REDIRECT,
					code_challenge: challenge,
					code_challenge_method: 'S256',
					approved: 'true',
				}).toString(),
			}),
		);
		expect(response!.status).toBe(403);
	});

	it('re-narrows a scope the browser tried to widen', async () => {
		const { provider, codes } = build({
			resolveUser: async () => ({ ...USER, scopes: ['vault:read'] }),
		});
		const client = await register(provider);
		const { challenge } = await pkce();
		const response = await consent(provider, client.client_id, challenge, {
			scope: 'vault:read vault:write vault:admin',
		});
		const code = new URL(response.headers.get('Location')!).searchParams.get('code')!;
		const stored = await codes.take(await sha256Base64Url(code));
		expect(stored!.scopes).toEqual(['vault:read']);
	});

	it('redirects a decline back to the client', async () => {
		const { provider } = build();
		const client = await register(provider);
		const { challenge } = await pkce();
		const response = await consent(provider, client.client_id, challenge, {
			approved: 'false',
		});
		const location = new URL(response.headers.get('Location')!);
		expect(location.searchParams.get('error')).toBe('access_denied');
	});

	it('returns the code, the state, and the RFC 9207 issuer', async () => {
		const { provider } = build();
		const client = await register(provider);
		const { challenge } = await pkce();
		const response = await consent(provider, client.client_id, challenge);
		expect(response.status).toBe(302);
		const location = new URL(response.headers.get('Location')!);
		expect(location.origin + location.pathname).toBe(REDIRECT);
		expect(location.searchParams.get('code')).toBeTruthy();
		expect(location.searchParams.get('state')).toBe('state_123');
		expect(location.searchParams.get('iss')).toBe(ISSUER);
	});

	it('stores the code only as a digest', async () => {
		const { provider, codes } = build();
		const client = await register(provider);
		const { challenge } = await pkce();
		const response = await consent(provider, client.client_id, challenge);
		const code = new URL(response.headers.get('Location')!).searchParams.get('code')!;
		// The raw code is not a key; its digest is.
		expect(await codes.take(code)).toBeUndefined();
		expect(await codes.take(await sha256Base64Url(code))).toMatchObject({
			subject: 'user_1',
		});
	});
});

describe('the token endpoint', () => {
	async function authorized() {
		const context = build();
		const client = await register(context.provider);
		const { verifier, challenge } = await pkce();
		const response = await consent(context.provider, client.client_id, challenge);
		const code = new URL(response.headers.get('Location')!).searchParams.get('code')!;
		return { ...context, client, verifier, code };
	}

	it('redeems a code with the matching verifier', async () => {
		const { provider, client, verifier, code } = await authorized();
		const response = await token(provider, {
			grant_type: 'authorization_code',
			code,
			client_id: client.client_id,
			redirect_uri: REDIRECT,
			code_verifier: verifier,
			resource: RESOURCE,
		});
		expect(response.status).toBe(200);
		const body = await json<TokenBody>(response);
		expect(body.token_type).toBe('Bearer');
		expect(body.access_token).toBeTruthy();
		expect(body.refresh_token).toBeTruthy();
		expect(body.scope).toBe('vault:read vault:write');
		expect(response.headers.get('Cache-Control')).toBe('no-store');
	});

	it('refuses a wrong code_verifier', async () => {
		const { provider, client, code } = await authorized();
		const response = await token(provider, {
			grant_type: 'authorization_code',
			code,
			client_id: client.client_id,
			code_verifier: randomToken(32),
		});
		expect(response.status).toBe(400);
		expect((await json<ErrorBody>(response)).error).toBe('invalid_grant');
	});

	it('refuses a code with no verifier at all', async () => {
		const { provider, client, code } = await authorized();
		const response = await token(provider, {
			grant_type: 'authorization_code',
			code,
			client_id: client.client_id,
		});
		expect(response.status).toBe(400);
	});

	it('refuses to redeem the same code twice', async () => {
		const { provider, client, verifier, code } = await authorized();
		const fields = {
			grant_type: 'authorization_code',
			code,
			client_id: client.client_id,
			code_verifier: verifier,
		};
		expect((await token(provider, fields)).status).toBe(200);
		const replay = await token(provider, fields);
		expect(replay.status).toBe(400);
		expect((await json<ErrorBody>(replay)).error).toBe('invalid_grant');
	});

	it('refuses a code presented by another client', async () => {
		const { provider, verifier, code } = await authorized();
		const other = await register(provider, { client_name: 'Impostor' });
		const response = await token(provider, {
			grant_type: 'authorization_code',
			code,
			client_id: other.client_id,
			code_verifier: verifier,
		});
		expect(response.status).toBe(400);
	});

	it('refuses a redirect_uri that differs from the authorization request', async () => {
		const { provider, client, verifier, code } = await authorized();
		const response = await token(provider, {
			grant_type: 'authorization_code',
			code,
			client_id: client.client_id,
			redirect_uri: 'http://localhost:1/other',
			code_verifier: verifier,
		});
		expect(response.status).toBe(400);
	});

	it('refuses a token request for another resource', async () => {
		const { provider, client, verifier, code } = await authorized();
		const response = await token(provider, {
			grant_type: 'authorization_code',
			code,
			client_id: client.client_id,
			code_verifier: verifier,
			resource: 'https://other.example.com/mcp',
		});
		expect(response.status).toBe(400);
		expect((await json<ErrorBody>(response)).error).toBe('invalid_target');
	});

	it('accepts the resource written with a trailing slash', async () => {
		const { provider, client, verifier, code } = await authorized();
		const response = await token(provider, {
			grant_type: 'authorization_code',
			code,
			client_id: client.client_id,
			code_verifier: verifier,
			resource: `${RESOURCE}/`,
		});
		expect(response.status).toBe(200);
	});

	it('refuses a JSON body — OAuth 2.1 wants form encoding', async () => {
		const { provider } = build();
		const response = await provider.fetch(
			new Request(`${ISSUER}/oauth/token`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{}',
			}),
		);
		expect(response!.status).toBe(400);
	});

	it('refuses an unsupported grant type', async () => {
		const { provider, client } = await authorized();
		const response = await token(provider, {
			grant_type: 'client_credentials',
			client_id: client.client_id,
		});
		expect((await json<ErrorBody>(response)).error).toBe('unsupported_grant_type');
	});

	it('requires the secret from a confidential client', async () => {
		const { provider } = build();
		const client = await register(provider, {
			token_endpoint_auth_method: 'client_secret_post',
		});
		const { verifier, challenge } = await pkce();
		const consented = await consent(provider, client.client_id, challenge);
		const code = new URL(consented.headers.get('Location')!).searchParams.get('code')!;

		const without = await token(provider, {
			grant_type: 'authorization_code',
			code,
			client_id: client.client_id,
			code_verifier: verifier,
		});
		expect(without.status).toBe(401);
	});

	it('accepts a confidential client’s secret over HTTP Basic', async () => {
		const { provider } = build();
		const client = await register(provider, {
			token_endpoint_auth_method: 'client_secret_basic',
		});
		const { verifier, challenge } = await pkce();
		const consented = await consent(provider, client.client_id, challenge);
		const code = new URL(consented.headers.get('Location')!).searchParams.get('code')!;

		const response = await provider.fetch(
			new Request(`${ISSUER}/oauth/token`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Authorization: `Basic ${btoa(`${client.client_id}:${client.client_secret}`)}`,
				},
				body: new URLSearchParams({
					grant_type: 'authorization_code',
					code,
					code_verifier: verifier,
				}).toString(),
			}),
		);
		expect(response!.status).toBe(200);
	});

	it('expires a code', async () => {
		let clock = 1_000_000;
		const stores = createMemoryOauthStores();
		const provider = createOauthProvider({
			issuer: ISSUER,
			resource: RESOURCE,
			scopes_supported: SCOPES,
			...stores,
			resolveUser: async () => USER,
			renderConsent: () => new Response('consent'),
			code_ttl_ms: 60_000,
			now: () => clock,
		});
		const client = await register(provider);
		const { verifier, challenge } = await pkce();
		const consented = await consent(provider, client.client_id, challenge);
		const code = new URL(consented.headers.get('Location')!).searchParams.get('code')!;

		clock += 61_000;
		const response = await token(provider, {
			grant_type: 'authorization_code',
			code,
			client_id: client.client_id,
			code_verifier: verifier,
		});
		expect((await json<ErrorBody>(response)).error_description).toContain('expired');
	});
});

describe('bearer validation', () => {
	async function withToken(
		overrides?: Partial<Parameters<typeof createOauthProvider>[0]>,
	) {
		const context = build(overrides);
		const client = await register(context.provider);
		const { verifier, challenge } = await pkce();
		const consented = await consent(context.provider, client.client_id, challenge);
		const code = new URL(consented.headers.get('Location')!).searchParams.get('code')!;
		const issued = await json<TokenBody>(
			await token(context.provider, {
				grant_type: 'authorization_code',
				code,
				client_id: client.client_id,
				code_verifier: verifier,
			}),
		);
		return { ...context, client, issued };
	}

	const bearer = (value: string) =>
		new Request(RESOURCE, { headers: { Authorization: `Bearer ${value}` } });

	it('resolves the subject, org, scopes and client name', async () => {
		const { provider, issued } = await withToken();
		const auth = await provider.authenticate(bearer(issued.access_token));
		expect(auth).toMatchObject({
			subject: 'user_1',
			org_id: 'org_1',
			scopes: ['vault:read', 'vault:write'],
			client_name: 'Claude Code',
		});
	});

	it('returns null when there is no Authorization header at all', async () => {
		const { provider } = build();
		expect(await provider.authenticate(new Request(RESOURCE))).toBeNull();
	});

	it('throws a 401 for an unknown token', async () => {
		const { provider } = build();
		await expect(provider.authenticate(bearer(randomToken(32)))).rejects.toMatchObject({
			status: 401,
		});
	});

	it('throws a 401 for a non-Bearer scheme', async () => {
		const { provider } = build();
		const request = new Request(RESOURCE, { headers: { Authorization: 'Basic abc' } });
		await expect(provider.authenticate(request)).rejects.toMatchObject({ status: 401 });
	});

	it('throws a 401 once the token expires', async () => {
		let clock = 1_000_000;
		const { provider, issued } = await withToken({
			access_token_ttl_ms: 60_000,
			now: () => clock,
		});
		expect(await provider.authenticate(bearer(issued.access_token))).toBeTruthy();
		clock += 61_000;
		await expect(provider.authenticate(bearer(issued.access_token))).rejects.toThrow(
			/expired/,
		);
	});

	it('stores the access token only as a digest', async () => {
		const { tokens, issued } = await withToken();
		expect(await tokens.getByAccessHash(issued.access_token)).toBeUndefined();
		expect(
			await tokens.getByAccessHash(await sha256Base64Url(issued.access_token)),
		).toBeTruthy();
	});

	it('refuses a token minted for a different resource', async () => {
		const { provider, tokens, issued } = await withToken();
		const record = (await tokens.getByAccessHash(
			await sha256Base64Url(issued.access_token),
		))!;
		await tokens.update(record.id, { resource: 'https://other.example.com/mcp' });
		await expect(provider.authenticate(bearer(issued.access_token))).rejects.toThrow(
			/another resource/,
		);
	});

	it('builds a 401 challenge pointing at the resource metadata', async () => {
		const { provider } = build();
		expect(provider.challenge()).toBe(
			`Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource"`,
		);
	});

	it('builds an insufficient_scope challenge naming the scope needed', async () => {
		const { provider } = build();
		const challenge = provider.challenge({
			error: 'insufficient_scope',
			scope: ['vault:write'],
		});
		expect(challenge).toContain('error="insufficient_scope"');
		expect(challenge).toContain('scope="vault:write"');
		expect(challenge).toContain('resource_metadata=');
	});
});

describe('refresh', () => {
	async function refreshable() {
		const context = build();
		const client = await register(context.provider);
		const { verifier, challenge } = await pkce();
		const consented = await consent(context.provider, client.client_id, challenge);
		const code = new URL(consented.headers.get('Location')!).searchParams.get('code')!;
		const issued = await json<TokenBody>(
			await token(context.provider, {
				grant_type: 'authorization_code',
				code,
				client_id: client.client_id,
				code_verifier: verifier,
			}),
		);
		return { ...context, client, issued };
	}

	it('exchanges a refresh token for a new access token', async () => {
		const { provider, client, issued } = await refreshable();
		const response = await token(provider, {
			grant_type: 'refresh_token',
			refresh_token: issued.refresh_token,
			client_id: client.client_id,
		});
		expect(response.status).toBe(200);
		const refreshed = await json<TokenBody>(response);
		expect(refreshed.access_token).not.toBe(issued.access_token);
		const auth = await provider.authenticate(
			new Request(RESOURCE, {
				headers: { Authorization: `Bearer ${refreshed.access_token}` },
			}),
		);
		expect(auth?.subject).toBe('user_1');
	});

	it('rotates the refresh token, and the old one stops working', async () => {
		const { provider, client, issued } = await refreshable();
		const refreshed = await json<TokenBody>(
			await token(provider, {
				grant_type: 'refresh_token',
				refresh_token: issued.refresh_token,
				client_id: client.client_id,
			}),
		);
		expect(refreshed.refresh_token).not.toBe(issued.refresh_token);

		const replay = await token(provider, {
			grant_type: 'refresh_token',
			refresh_token: issued.refresh_token,
			client_id: client.client_id,
		});
		expect(replay.status).toBe(400);
	});

	it('retires the old access token when it rotates', async () => {
		const { provider, client, issued } = await refreshable();
		await token(provider, {
			grant_type: 'refresh_token',
			refresh_token: issued.refresh_token,
			client_id: client.client_id,
		});
		await expect(
			provider.authenticate(
				new Request(RESOURCE, {
					headers: { Authorization: `Bearer ${issued.access_token}` },
				}),
			),
		).rejects.toMatchObject({ status: 401 });
	});

	it('lets a refresh narrow the grant but not widen it', async () => {
		const { provider, client, issued } = await refreshable();
		const narrowed = await json<TokenBody>(
			await token(provider, {
				grant_type: 'refresh_token',
				refresh_token: issued.refresh_token,
				client_id: client.client_id,
				scope: 'vault:read vault:admin',
			}),
		);
		expect(narrowed.scope).toBe('vault:read');
	});

	it('refuses a refresh token presented by another client', async () => {
		const { provider, issued } = await refreshable();
		const other = await register(provider, { client_name: 'Impostor' });
		const response = await token(provider, {
			grant_type: 'refresh_token',
			refresh_token: issued.refresh_token,
			client_id: other.client_id,
		});
		expect(response.status).toBe(400);
	});

	it('issues no refresh token when the lifetime is zero', async () => {
		const context = build({ refresh_token_ttl_ms: 0 });
		const client = await register(context.provider);
		const { verifier, challenge } = await pkce();
		const consented = await consent(context.provider, client.client_id, challenge);
		const code = new URL(consented.headers.get('Location')!).searchParams.get('code')!;
		const issued = await json<Partial<TokenBody>>(
			await token(context.provider, {
				grant_type: 'authorization_code',
				code,
				client_id: client.client_id,
				code_verifier: verifier,
			}),
		);
		expect(issued.refresh_token).toBeUndefined();
	});
});
