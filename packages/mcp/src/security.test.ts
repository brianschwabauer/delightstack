import { describe, expect, it } from 'vitest';
import { sha256Base64Url } from './crypto.js';
import {
	createMemoryOauthStores,
	createOauthProvider,
	type OauthResolvedUser,
} from './oauth.js';
import { validateInput } from './schema.js';
import { createMcpServer } from './server.js';
import { createMemorySessionStore } from './sessions.js';
import { defineTool } from './tools.js';
import type { McpAuthContext, McpToolInput } from './types.js';

/**
 * The adversarial suite: every case here is written from the attacker's side of
 * the boundary rather than the client's, so it says what the package must
 * *refuse* rather than what it must accept.
 */

const ISSUER = 'https://write.example.com';
const RESOURCE = 'https://write.example.com/mcp';
const ENDPOINT = `${ISSUER}/mcp`;
const SCOPES = ['vault:read', 'vault:write'] as const;
const REDIRECT = 'http://localhost:57891/callback';

const USER: OauthResolvedUser = {
	subject: 'user_1',
	org_id: 'org_1',
	scopes: ['vault:read', 'vault:write'],
};

interface ErrorBody {
	error?: string;
	error_description?: string;
}

interface ClientBody {
	client_id: string;
}

interface TokenBody {
	access_token?: string;
	refresh_token?: string;
	error?: string;
}

function buildOauth(overrides?: Partial<Parameters<typeof createOauthProvider>[0]>) {
	const stores = createMemoryOauthStores();
	const provider = createOauthProvider({
		issuer: ISSUER,
		resource: RESOURCE,
		scopes_supported: SCOPES,
		...stores,
		resolveUser: async () => USER,
		renderConsent: () => new Response('<form></form>', { status: 200 }),
		...overrides,
	});
	return { provider, ...stores };
}

async function register(
	provider: ReturnType<typeof createOauthProvider>,
	body: Record<string, unknown>,
): Promise<Response> {
	return (await provider.fetch(
		new Request(`${ISSUER}/oauth/register`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		}),
	))!;
}

/** Registers a public client and returns its id. */
async function publicClient(
	provider: ReturnType<typeof createOauthProvider>,
): Promise<string> {
	const response = await register(provider, {
		client_name: 'probe',
		redirect_uris: [REDIRECT],
	});
	return ((await response.json()) as ClientBody).client_id;
}

/** Drives consent to a code, returning the `code` query parameter. */
async function authorize(
	provider: ReturnType<typeof createOauthProvider>,
	client_id: string,
	challenge: string,
	extra?: Record<string, string>,
): Promise<string> {
	const form = new URLSearchParams({
		client_id,
		redirect_uri: REDIRECT,
		response_type: 'code',
		scope: 'vault:read',
		code_challenge: challenge,
		code_challenge_method: 'S256',
		approved: 'true',
		...extra,
	});
	const response = (await provider.fetch(
		new Request(`${ISSUER}/oauth/authorize`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Origin: ISSUER,
			},
			body: form,
		}),
	))!;
	expect(response.status).toBe(302);
	return new URL(response.headers.get('Location')!).searchParams.get('code')!;
}

async function redeem(
	provider: ReturnType<typeof createOauthProvider>,
	body: Record<string, string>,
): Promise<Response> {
	return (await provider.fetch(
		new Request(`${ISSUER}/oauth/token`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams(body),
		}),
	))!;
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

describe('dynamic client registration hardening', () => {
	it('refuses a redirect_uri whose scheme can execute in a browser', async () => {
		const { provider } = buildOauth();
		for (const uri of [
			'javascript:alert(document.domain)',
			'data:text/html,<script>alert(1)</script>',
			'vbscript:msgbox(1)',
			'file:///etc/passwd',
			'blob:https://write.example.com/abc',
		]) {
			const response = await register(provider, { redirect_uris: [uri] });
			expect(response.status, `${uri} must not be accepted as a redirect_uri`).toBe(400);
			expect((await response.json()) as ErrorBody).toMatchObject({
				error: 'invalid_redirect_uri',
			});
		}
	});

	it('still accepts a native app private-use scheme', async () => {
		const { provider } = buildOauth();
		const response = await register(provider, {
			redirect_uris: ['com.example.app:/oauth/callback'],
		});
		expect(response.status).toBe(201);
	});

	it('refuses non-loopback plain http', async () => {
		const { provider } = buildOauth();
		const response = await register(provider, {
			redirect_uris: ['http://evil.example.com/callback'],
		});
		expect(response.status).toBe(400);
	});

	it('runs the injected registration rate limiter before creating a client', async () => {
		const seen: string[] = [];
		const { provider, clients } = buildOauth({
			registration: {
				rateLimit: (request: Request) => {
					seen.push(new URL(request.url).pathname);
					throw new Error('too many');
				},
			},
		} as Partial<Parameters<typeof createOauthProvider>[0]>);
		const response = await register(provider, { redirect_uris: [REDIRECT] });
		expect(response.status).toBe(429);
		expect(seen).toEqual(['/oauth/register']);
		// Nothing was written.
		expect(await clients.get('anything')).toBeUndefined();
	});
});

describe('PKCE', () => {
	it('refuses a code_verifier outside the RFC 7636 length bounds', async () => {
		const { provider } = buildOauth();
		const client_id = await publicClient(provider);
		for (const verifier of ['short', 'a'.repeat(42), 'a'.repeat(129)]) {
			const code = await authorize(provider, client_id, await sha256Base64Url(verifier));
			const response = await redeem(provider, {
				grant_type: 'authorization_code',
				client_id,
				code,
				code_verifier: verifier,
				redirect_uri: REDIRECT,
			});
			expect(
				response.status,
				`a ${verifier.length}-character verifier must be refused`,
			).toBe(400);
			expect((await response.json()) as ErrorBody).toMatchObject({
				error: 'invalid_grant',
			});
		}
	});

	it('accepts a verifier at both ends of the legal range', async () => {
		const { provider } = buildOauth();
		const client_id = await publicClient(provider);
		for (const verifier of ['a'.repeat(43), 'a'.repeat(128)]) {
			const code = await authorize(provider, client_id, await sha256Base64Url(verifier));
			const response = await redeem(provider, {
				grant_type: 'authorization_code',
				client_id,
				code,
				code_verifier: verifier,
				redirect_uri: REDIRECT,
			});
			expect(response.status).toBe(200);
		}
	});
});

describe('resource indicators', () => {
	it('refuses a forged resource on the consent POST', async () => {
		const { provider } = buildOauth();
		const client_id = await publicClient(provider);
		const verifier = 'v'.repeat(64);
		const form = new URLSearchParams({
			client_id,
			redirect_uri: REDIRECT,
			response_type: 'code',
			scope: 'vault:read',
			code_challenge: await sha256Base64Url(verifier),
			code_challenge_method: 'S256',
			approved: 'true',
			resource: 'https://attacker.example.com/mcp',
		});
		const response = (await provider.fetch(
			new Request(`${ISSUER}/oauth/authorize`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Origin: ISSUER,
				},
				body: form,
			}),
		))!;
		// It may only come back as an OAuth error — never as a usable code.
		const location = response.headers.get('Location');
		const code = location ? new URL(location).searchParams.get('code') : null;
		expect(code).toBeNull();
	});
});

describe('the consent screen', () => {
	it('is served with anti-clickjacking headers', async () => {
		const { provider } = buildOauth();
		const client_id = await publicClient(provider);
		const url = new URL(`${ISSUER}/oauth/authorize`);
		url.searchParams.set('client_id', client_id);
		url.searchParams.set('redirect_uri', REDIRECT);
		url.searchParams.set('response_type', 'code');
		url.searchParams.set('scope', 'vault:read');
		url.searchParams.set('code_challenge', await sha256Base64Url('v'.repeat(64)));
		url.searchParams.set('code_challenge_method', 'S256');
		const response = (await provider.fetch(new Request(url)))!;
		expect(response.status).toBe(200);
		expect(response.headers.get('X-Frame-Options')).toBe('DENY');
		expect(response.headers.get('Content-Security-Policy')).toContain(
			"frame-ancestors 'none'",
		);
	});
});

describe('refresh rotation', () => {
	it('refuses a rotated-away refresh token', async () => {
		const { provider } = buildOauth();
		const client_id = await publicClient(provider);
		const verifier = 'v'.repeat(64);
		const code = await authorize(provider, client_id, await sha256Base64Url(verifier));
		const first = (await (
			await redeem(provider, {
				grant_type: 'authorization_code',
				client_id,
				code,
				code_verifier: verifier,
				redirect_uri: REDIRECT,
			})
		).json()) as TokenBody;

		const rotated = (await (
			await redeem(provider, {
				grant_type: 'refresh_token',
				client_id,
				refresh_token: first.refresh_token!,
			})
		).json()) as TokenBody;
		expect(rotated.refresh_token).toBeTruthy();

		// Replaying the superseded refresh token must fail…
		const replay = await redeem(provider, {
			grant_type: 'refresh_token',
			client_id,
			refresh_token: first.refresh_token!,
		});
		expect(replay.status).toBe(400);

		// …and, per OAuth 2.1 §4.3.1, must take the whole family with it.
		const after = await redeem(provider, {
			grant_type: 'refresh_token',
			client_id,
			refresh_token: rotated.refresh_token!,
		});
		expect(after.status, 'reuse must revoke the rotated family').toBe(400);
	});
});

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const ping = defineTool({
	name: 'ping_tool',
	description: 'A tool',
	input: {},
	run: () => 'ok',
});

function buildServer(options?: {
	sessions?: ReturnType<typeof createMemorySessionStore>;
	authenticate?: (request: Request) => Promise<McpAuthContext | null>;
	max_batch_size?: number;
}) {
	return createMcpServer({
		name: 'test',
		version: '1.0.0',
		tools: [ping],
		...options,
	} as Parameters<typeof createMcpServer>[0]);
}

/** Two bearers, two subjects. */
const AUTH: Record<string, McpAuthContext> = {
	alice: { subject: 'alice', scopes: ['vault:read'], token_id: 'token_alice' },
	bob: { subject: 'bob', scopes: ['vault:read'], token_id: 'token_bob' },
};

async function authenticate(request: Request): Promise<McpAuthContext | null> {
	const header = request.headers.get('Authorization') ?? '';
	const auth = AUTH[header.replace(/^Bearer /, '')];
	return auth ?? null;
}

describe('transport authentication', () => {
	it('refuses an unauthenticated GET stream', async () => {
		const server = buildServer({ authenticate });
		const response = await server.fetch(
			new Request(ENDPOINT, { headers: { Accept: 'text/event-stream' } }),
		);
		expect(response.status).toBe(401);
		await response.body?.cancel();
	});

	it('refuses an unauthenticated DELETE', async () => {
		const sessions = createMemorySessionStore();
		const server = buildServer({ authenticate, sessions });
		const initialized = await server.fetch(
			new Request(ENDPOINT, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer alice',
				},
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
			}),
		);
		const session_id = initialized.headers.get('Mcp-Session-Id')!;
		expect(session_id).toBeTruthy();

		const response = await server.fetch(
			new Request(ENDPOINT, {
				method: 'DELETE',
				headers: { 'Mcp-Session-Id': session_id },
			}),
		);
		expect(response.status, 'an anonymous DELETE must not end a session').toBe(401);
		expect(await sessions.get(session_id)).toBeDefined();
	});
});

describe('session binding', () => {
	it("refuses one principal's session id presented with another's token", async () => {
		const sessions = createMemorySessionStore();
		const server = buildServer({ authenticate, sessions });
		const initialized = await server.fetch(
			new Request(ENDPOINT, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer alice',
				},
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
			}),
		);
		const session_id = initialized.headers.get('Mcp-Session-Id')!;

		const stolen = await server.fetch(
			new Request(ENDPOINT, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer bob',
					'Mcp-Session-Id': session_id,
				},
				body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
			}),
		);
		expect(stolen.status, "bob must not ride alice's session").toBe(404);
	});
});

describe('batch limits', () => {
	it('refuses a batch larger than the cap instead of running it', async () => {
		let calls = 0;
		const server = createMcpServer({
			name: 'test',
			version: '1.0.0',
			tools: [
				defineTool({
					name: 'counted',
					description: 'counts',
					input: {},
					run: () => {
						calls += 1;
						return 'ok';
					},
				}),
			],
		});
		const batch = Array.from({ length: 512 }, (_unused, index) => ({
			jsonrpc: '2.0',
			id: index,
			method: 'tools/call',
			params: { name: 'counted', arguments: {} },
		}));
		const response = await server.fetch(
			new Request(ENDPOINT, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(batch),
			}),
		);
		expect(response.status).toBe(400);
		expect(calls, 'nothing in an over-long batch may run').toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

describe('the validator against hostile arguments', () => {
	it('rejects unknown keys that happen to name an Object.prototype member', () => {
		for (const key of [
			'__proto__',
			'constructor',
			'toString',
			'valueOf',
			'hasOwnProperty',
			'isPrototypeOf',
		]) {
			const args = JSON.parse(`{"${key}": "surprise"}`) as Record<string, unknown>;
			const result = validateInput(args, { known: { type: 'string', optional: true } });
			expect(result.valid, `"${key}" must be reported as an unknown argument`).toBe(
				false,
			);
		}
	});

	it('does not let a prototype member stand in for a declared property', () => {
		const args = JSON.parse('{}') as Record<string, unknown>;
		// Built from JSON rather than a literal: `toString` as a literal key is
		// contextually typed against `Object.prototype.toString`, which is the
		// compiler making the same mistake this test is about.
		const input = JSON.parse('{"toString":{"type":"string"}}') as McpToolInput;
		const result = validateInput(args, input);
		expect(result.valid, 'an inherited method is not a supplied argument').toBe(false);
	});
});
