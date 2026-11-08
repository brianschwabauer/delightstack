import { describe, expect, it } from 'vitest';
import {
	createMcpServer,
	createMemoryOauthStores,
	createMemorySessionStore,
	createOauthProvider,
	defineTool,
	randomToken,
	sha256Base64Url,
} from '../index.js';
import type { McpTool } from '../types.js';

/**
 * The packaging proof.
 *
 * This suite runs inside workerd with **no `nodejs_compat` flag**, so it fails
 * if anything in the package reaches for a `node:` module, a Node global, or a
 * Web Crypto call workerd does not implement. The node suite covers the
 * behaviour exhaustively; what runs here is the one question it cannot answer.
 *
 * Deliberately small, and deliberately end-to-end rather than unit: every
 * export is touched once, on the path that actually uses the runtime.
 */

const ISSUER = 'https://write.example.com';
const RESOURCE = `${ISSUER}/mcp`;

describe('inside workerd', () => {
	it('runs a tool call end to end', async () => {
		const tool = defineTool({
			name: 'search',
			description: 'Search the vault',
			input: { query: { type: 'string' } },
			run: (args: { query: string }) => ({ hits: [args.query] }),
		});
		const server = createMcpServer({
			name: 'delightwrite',
			version: '1.0.0',
			tools: [tool] as unknown as McpTool<never, unknown>[],
			sessions: createMemorySessionStore(),
		});

		const init = await server.fetch(
			new Request(RESOURCE, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
			}),
		);
		const session_id = init.headers.get('Mcp-Session-Id')!;
		expect(session_id).toBeTruthy();

		const called = await server.fetch(
			new Request(RESOURCE, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': session_id },
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 2,
					method: 'tools/call',
					params: { name: 'search', arguments: { query: 'lighthouse' } },
				}),
			}),
		);
		const body = (await called.json()) as {
			result: { structuredContent: { hits: string[] } };
		};
		expect(body.result.structuredContent.hits).toEqual(['lighthouse']);
	});

	it('computes the PKCE S256 transform with workerd Web Crypto', async () => {
		expect(await sha256Base64Url('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
			'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
		);
		expect(randomToken(32)).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it('completes the OAuth flow and validates the bearer token it issued', async () => {
		const stores = createMemoryOauthStores();
		const provider = createOauthProvider({
			issuer: ISSUER,
			resource: RESOURCE,
			scopes_supported: ['vault:read'],
			...stores,
			resolveUser: async () => ({
				subject: 'user_1',
				org_id: 'org_1',
				scopes: ['vault:read'],
			}),
			renderConsent: () => new Response('consent'),
		});

		const registered = (await (await provider.fetch(
			new Request(`${ISSUER}/oauth/register`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					client_name: 'Claude Code',
					redirect_uris: ['http://localhost:9999/cb'],
				}),
			}),
		))!.json()) as { client_id: string };

		const verifier = randomToken(32);
		const consented = (await provider.fetch(
			new Request(`${ISSUER}/oauth/authorize`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Origin: ISSUER,
				},
				body: new URLSearchParams({
					response_type: 'code',
					client_id: registered.client_id,
					redirect_uri: 'http://localhost:9999/cb',
					scope: 'vault:read',
					code_challenge: await sha256Base64Url(verifier),
					code_challenge_method: 'S256',
					approved: 'true',
				}).toString(),
			}),
		))!;
		const code = new URL(consented.headers.get('Location')!).searchParams.get('code')!;

		const issued = (await (await provider.fetch(
			new Request(`${ISSUER}/oauth/token`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					grant_type: 'authorization_code',
					code,
					client_id: registered.client_id,
					code_verifier: verifier,
				}).toString(),
			}),
		))!.json()) as { access_token: string };

		const auth = await provider.authenticate(
			new Request(RESOURCE, {
				headers: { Authorization: `Bearer ${issued.access_token}` },
			}),
		);
		expect(auth).toMatchObject({ subject: 'user_1', scopes: ['vault:read'] });
	});

	it('serves the discovery documents', async () => {
		const stores = createMemoryOauthStores();
		const provider = createOauthProvider({
			issuer: ISSUER,
			resource: RESOURCE,
			scopes_supported: ['vault:read'],
			...stores,
			resolveUser: async () => null,
			renderConsent: () => new Response('consent'),
		});
		const response = await provider.fetch(
			new Request(`${ISSUER}/.well-known/oauth-protected-resource`),
		);
		const metadata = (await response!.json()) as { resource: string };
		expect(metadata.resource).toBe(RESOURCE);
	});
});
