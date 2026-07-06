import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthClient, type AuthClientData } from './auth.client.svelte';
import type { SessionToken } from '../types';

const startAuthentication = vi.hoisted(() => vi.fn());
const startRegistration = vi.hoisted(() => vi.fn());
const browserSupportsWebAuthn = vi.hoisted(() => vi.fn(() => true));
const browserSupportsWebAuthnAutofill = vi.hoisted(() => vi.fn(async () => true));

vi.mock('@simplewebauthn/browser', () => ({
	startAuthentication,
	startRegistration,
	browserSupportsWebAuthn,
	browserSupportsWebAuthnAutofill,
}));

function makeSession(): SessionToken<'auth'> {
	const now = Math.floor(Date.now() / 1000);
	return {
		typ: 'auth',
		iss: 'test',
		uid: 'user_1',
		sub: 'ua_1',
		jti: 'us_1',
		name: 'Test User',
		email: 'test@example.com',
		verified: true,
		org: {},
		iat: now,
		exp: now + 3600,
	};
}

function makeData(overrides: Partial<AuthClientData> = {}): AuthClientData {
	return {
		jwt: 'test-jwt',
		session: makeSession(),
		org_id: null,
		preferences: {},
		org_state: {},
		...overrides,
	};
}

/** Creates a fetch mock that responds per-path */
function mockFetch(routes: Record<string, unknown>) {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const path = url.replace(/^.*\/api\/auth/, '');
		const key = `${init?.method || 'GET'} ${path}`;
		if (!(key in routes)) {
			return new Response(
				JSON.stringify({ message: `No mock for ${key}`, status: 404 }),
				{
					status: 404,
					headers: { 'Content-Type': 'application/json' },
				},
			);
		}
		const body = routes[key];
		if (body === undefined) return new Response(null, { status: 204 });
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	});
}

beforeEach(() => {
	startAuthentication.mockReset();
	startRegistration.mockReset();
});

describe('AuthClient passkey sign-in', () => {
	it('fetches options, runs the browser ceremony, and stores the session', async () => {
		const session = makeSession();
		const auth_response = { id: 'cred_1', type: 'public-key' };
		startAuthentication.mockResolvedValue(auth_response);
		const fetchFn = mockFetch({
			'POST /signin/passkey/options': { challenge: 'Y2hhbGxlbmdl', rpId: 'localhost' },
			'POST /signin/passkey': { jwt: 'new-jwt', decoded_jwt: session },
		});
		const client = new AuthClient(makeData({ jwt: null, session: null }), {
			fetch: fetchFn as unknown as typeof fetch,
		});

		const result = await client.signIn.passkey();

		expect(startAuthentication).toHaveBeenCalledWith({
			optionsJSON: { challenge: 'Y2hhbGxlbmdl', rpId: 'localhost' },
			useBrowserAutofill: undefined,
		});
		// The verify call must send the browser's response back to the server
		const verify_call = fetchFn.mock.calls.find(([url]) =>
			String(url).endsWith('/signin/passkey'),
		);
		expect(JSON.parse(String(verify_call![1]!.body))).toEqual({
			response: auth_response,
		});
		expect(result.jwt).toBe('new-jwt');
		expect(client.jwt).toBe('new-jwt');
		expect(client.signed_in).toBe(true);
		client.destroy();
	});

	it('passes autofill + invitation_id through', async () => {
		const session = makeSession();
		startAuthentication.mockResolvedValue({ id: 'cred_1' });
		const fetchFn = mockFetch({
			'POST /signin/passkey/options': { challenge: 'abc' },
			'POST /signin/passkey': { jwt: 'j', decoded_jwt: session },
		});
		const client = new AuthClient(makeData({ jwt: null, session: null }), {
			fetch: fetchFn as unknown as typeof fetch,
		});

		await client.signIn.passkey({ autofill: true, invitation_id: 'inv_1' });

		expect(startAuthentication).toHaveBeenCalledWith({
			optionsJSON: { challenge: 'abc' },
			useBrowserAutofill: true,
		});
		const verify_call = fetchFn.mock.calls.find(([url]) =>
			String(url).endsWith('/signin/passkey'),
		);
		expect(JSON.parse(String(verify_call![1]!.body)).invitation_id).toBe('inv_1');
		client.destroy();
	});

	it('propagates server errors as AuthClientError', async () => {
		startAuthentication.mockResolvedValue({ id: 'cred_1' });
		const fetchFn = vi.fn(
			async (input: RequestInfo | URL) =>
				new Response(
					JSON.stringify(
						String(input).endsWith('/options')
							? { challenge: 'abc' }
							: { message: 'Passkey not recognized', status: 401 },
					),
					{
						status: String(input).endsWith('/options') ? 200 : 401,
						headers: { 'Content-Type': 'application/json' },
					},
				),
		);
		const client = new AuthClient(makeData({ jwt: null, session: null }), {
			fetch: fetchFn as unknown as typeof fetch,
		});

		await expect(client.signIn.passkey()).rejects.toMatchObject({
			code: 'passkey_failed',
			status: 401,
		});
		expect(client.signed_in).toBe(false);
		client.destroy();
	});
});

describe('AuthClient passkey management', () => {
	it('registers a passkey with a label', async () => {
		const reg_response = { id: 'cred_2', type: 'public-key' };
		startRegistration.mockResolvedValue(reg_response);
		const passkey = { id: 'cred_2', user_auth_id: 'ua_2', backed_up: true };
		const fetchFn = mockFetch({
			'POST /passkey/options': { challenge: 'reg-challenge' },
			'POST /passkey': passkey,
		});
		const client = new AuthClient(makeData(), {
			fetch: fetchFn as unknown as typeof fetch,
		});

		const result = await client.passkey.register('MacBook Touch ID');

		expect(startRegistration).toHaveBeenCalledWith({
			optionsJSON: { challenge: 'reg-challenge' },
		});
		const verify_call = fetchFn.mock.calls.find(
			([url, init]) => String(url).endsWith('/passkey') && init?.method === 'POST',
		);
		expect(JSON.parse(String(verify_call![1]!.body))).toEqual({
			response: reg_response,
			name: 'MacBook Touch ID',
		});
		expect(result).toEqual(passkey);
		client.destroy();
	});

	it('lists, renames, and removes passkeys', async () => {
		const fetchFn = mockFetch({
			'GET /passkey': { list: [{ id: 'cred_1' }], count: 1, hasMore: false },
			'PATCH /passkey/cred_1': { id: 'cred_1', name: 'Renamed' },
			'DELETE /passkey/cred_1': undefined,
		});
		const client = new AuthClient(makeData(), {
			fetch: fetchFn as unknown as typeof fetch,
		});

		const { list } = await client.passkey.list();
		expect(list).toHaveLength(1);
		const renamed = await client.passkey.rename('cred_1', 'Renamed');
		expect(renamed.name).toBe('Renamed');
		await client.passkey.remove('cred_1');
		client.destroy();
	});

	it('url-encodes credential ids in paths', async () => {
		const fetchFn = mockFetch({});
		const client = new AuthClient(makeData(), {
			fetch: fetchFn as unknown as typeof fetch,
		});
		await client.passkey.remove('a+b/c=').catch(() => {});
		expect(String(fetchFn.mock.calls[0][0])).toContain('/passkey/a%2Bb%2Fc%3D');
		client.destroy();
	});

	it('exposes browser support checks', async () => {
		const client = new AuthClient(makeData());
		expect(client.passkey.isSupported()).toBe(true);
		await expect(client.passkey.isAutofillSupported()).resolves.toBe(true);
		client.destroy();
	});
});
