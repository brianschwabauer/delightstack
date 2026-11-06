import { describe, it, expect } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { createAuthHandle, type AuthServer } from './auth.handler.js';
import { generateJwt } from './jwt.server.js';

type HandleInput = Parameters<ReturnType<typeof createAuthHandle>>[0];

/** A plain-http request as Vite sees it behind a TLS-terminating proxy */
function makeEvent(url: string, init: RequestInit = {}): RequestEvent {
	return {
		url: new URL(url),
		request: new Request(url, init),
		cookies: {
			get: () => undefined,
			getAll: () => [],
			set: () => {},
			delete: () => {},
			serialize: () => '',
		},
		locals: {},
		params: {},
		platform: undefined,
		getClientAddress: () => '127.0.0.1',
	} as unknown as RequestEvent;
}

function makeHandle(dev: boolean) {
	return createAuthHandle({
		config: {
			dev,
			secret: 'a'.repeat(64),
			issuer: 'test',
			permissions: ['read'] as const,
			oauth_scopes: ['profile'] as const,
		},
		getAuthServer: () => ({}) as unknown as AuthServer,
	});
}

async function run(dev: boolean, event: RequestEvent) {
	let seen: URL | undefined;
	const response = await makeHandle(dev)({
		event,
		resolve: (e: RequestEvent) => {
			seen = e.url;
			return new Response('ok');
		},
	} as unknown as HandleInput);
	return { response, seen };
}

describe('createAuthHandle behind a TLS-terminating proxy', () => {
	it('upgrades event.url to https in dev when X-Forwarded-Proto is https', async () => {
		const event = makeEvent('http://app.example.test/page', {
			headers: { 'x-forwarded-proto': 'https' },
		});
		const { seen } = await run(true, event);
		expect(seen?.origin).toBe('https://app.example.test');
	});

	it('ignores X-Forwarded-Proto outside dev', async () => {
		const event = makeEvent('http://app.example.test/page', {
			headers: { 'x-forwarded-proto': 'https' },
		});
		const { seen } = await run(false, event);
		expect(seen?.origin).toBe('http://app.example.test');
	});

	it('leaves event.url alone in dev without the header', async () => {
		const { seen } = await run(true, makeEvent('http://localhost:5173/page'));
		expect(seen?.origin).toBe('http://localhost:5173');
	});

	it('passes CSRF for an https Origin proxied over http in dev', async () => {
		const event = makeEvent('http://app.example.test/api/auth/signout', {
			method: 'POST',
			headers: {
				origin: 'https://app.example.test',
				'x-forwarded-proto': 'https',
			},
		});
		const { response } = await run(true, event).catch(() => ({ response: undefined }));
		expect(response?.status).not.toBe(403);
	});

	it('still rejects the mismatched Origin outside dev', async () => {
		const event = makeEvent('http://app.example.test/api/auth/signout', {
			method: 'POST',
			headers: {
				origin: 'https://app.example.test',
				'x-forwarded-proto': 'https',
			},
		});
		const { response } = await run(false, event);
		expect(response.status).toBe(403);
	});
});

describe('createAuthHandle user.image', () => {
	async function localsFor(claims: Record<string, unknown>) {
		const secret = 'a'.repeat(64);
		const { jwt } = await generateJwt<'auth'>(secret, {
			typ: 'auth',
			iss: 'test',
			sub: 'auth_1',
			uid: 'user_1',
			jti: 'session_1',
			name: 'Ada',
			email: 'ada@example.test',
			verified: true,
			org: {},
			...claims,
		});
		const event = makeEvent('https://app.example.test/page');
		(event.cookies as { get: (name: string) => string | undefined }).get = (name) =>
			name === 'auth-session' ? jwt : undefined;
		await makeHandle(false)({
			event,
			resolve: () => new Response('ok'),
		} as unknown as HandleInput);
		return event.locals as unknown as { user: { image?: string } | null };
	}

	it('carries the image claim onto locals.user', async () => {
		const locals = await localsFor({ image: '/avatar/user_1/abc' });
		expect(locals.user?.image).toBe('/avatar/user_1/abc');
	});

	it('leaves image off when the token has none', async () => {
		const locals = await localsFor({});
		expect(locals.user).not.toBeNull();
		expect(locals.user && 'image' in locals.user).toBe(false);
	});
});
