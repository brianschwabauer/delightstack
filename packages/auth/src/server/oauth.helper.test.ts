import { describe, it, expect, vi, afterEach } from 'vitest';
import { getOauthAccount, getOauthToken } from './oauth.helper';

/** Builds an unsigned JWT with the given claims (only the payload segment is ever read) */
function makeIdToken(claims: Record<string, unknown>) {
	const encode = (value: unknown) =>
		btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/, '');
	return `${encode({ alg: 'RS256' })}.${encode(claims)}.signature`;
}

const GOOGLE_CONFIG = {
	environment: 'production' as const,
	authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth',
	access_token_url: 'https://oauth2.googleapis.com/token',
	client_id: 'client-id',
	client_secret: 'client-secret',
};

afterEach(() => vi.unstubAllGlobals());

describe('getOauthAccount', () => {
	it('reads the account out of an OpenID Connect id_token', async () => {
		const account = await getOauthAccount(
			{},
			{
				access_token: 'at',
				payload: {
					id_token: makeIdToken({
						sub: '1234567890',
						email: 'brian@example.com',
						email_verified: true,
						name: 'Brian Schwabauer',
						picture: 'https://example.com/avatar.png',
					}),
				},
			},
		);
		expect(account).toEqual({
			vendor_id: '1234567890',
			account_email: 'brian@example.com',
			account_name: 'Brian Schwabauer',
			account_image: 'https://example.com/avatar.png',
		});
	});

	it('decodes utf-8 names in the id_token', async () => {
		const account = await getOauthAccount(
			{},
			{
				access_token: 'at',
				payload: { id_token: makeIdToken({ sub: '1', name: 'José Ávila' }) },
			},
		);
		expect(account.account_name).toBe('José Ávila');
	});

	it('drops the email when the vendor says it is unverified', async () => {
		const account = await getOauthAccount(
			{},
			{
				access_token: 'at',
				payload: {
					id_token: makeIdToken({
						sub: '1',
						email: 'nope@example.com',
						email_verified: false,
					}),
				},
			},
		);
		expect(account.vendor_id).toBe('1');
		expect(account.account_email).toBeUndefined();
	});

	it('keeps the email when the vendor omits the verified claim', async () => {
		const account = await getOauthAccount(
			{},
			{
				access_token: 'at',
				payload: { id_token: makeIdToken({ sub: '1', email: 'a@b.com' }) },
			},
		);
		expect(account.account_email).toBe('a@b.com');
	});

	it('falls back to the user info endpoint when there is no id_token', async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({ id: 42, email: 'gh@example.com', name: 'GH', avatar_url: 'img' }),
		);
		vi.stubGlobal('fetch', fetchMock);

		const account = await getOauthAccount(
			{ user_info_url: 'https://api.github.com/user' },
			{ access_token: 'at', payload: {} },
		);

		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://api.github.com/user');
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer at');
		expect(account).toEqual({
			vendor_id: '42',
			account_email: 'gh@example.com',
			account_name: 'GH',
			account_image: 'img',
		});
	});

	it('returns an empty identity when the vendor provides nothing', async () => {
		const account = await getOauthAccount({}, { access_token: 'at', payload: {} });
		expect(account).toEqual({ vendor_id: '' });
	});

	it('ignores an id_token that is not decodable', async () => {
		const account = await getOauthAccount(
			{},
			{ access_token: 'at', payload: { id_token: 'junk' } },
		);
		expect(account).toEqual({ vendor_id: '' });
	});
});

describe('getOauthToken', () => {
	it('fills in the account from the id_token on the auth code exchange', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				Response.json({
					access_token: 'access',
					refresh_token: 'refresh',
					expires_in: 3600,
					id_token: makeIdToken({
						sub: '1234567890',
						email: 'Brian@Example.com',
						email_verified: true,
						name: 'Brian',
					}),
				}),
			),
		);

		const token = await getOauthToken(GOOGLE_CONFIG, {
			auth_code: 'code',
			redirect_url: 'https://foreverfamily.app/api/auth/signin/google/callback',
			vendor: 'google',
		});

		expect(token.vendor_id).toBe('1234567890');
		expect(token.account_email).toBe('Brian@Example.com');
		expect(token.account_name).toBe('Brian');
		expect(token.access_token).toBe('access');
	});

	it('keeps the known account when refreshing a token', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ access_token: 'access2', expires_in: 3600 })),
		);

		const token = await getOauthToken(GOOGLE_CONFIG, {
			id: 'ot_1',
			created_at: 0,
			updated_at: 0,
			vendor: 'google',
			vendor_id: '1234567890',
			access_token: 'old',
			access_token_expires_at: Date.now() - 1000,
			refresh_token: 'refresh',
			capabilities: [],
			account_email: 'brian@example.com',
			account_name: 'Brian',
		});

		expect(token.access_token).toBe('access2');
		expect(token.vendor_id).toBe('1234567890');
		expect(token.account_email).toBe('brian@example.com');
	});
});
