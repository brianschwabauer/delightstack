import { describe, it, expect, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { createWebsocketHandle, type WebsocketHandleOptions } from './websocket.handler';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface EventOverrides {
	pathname?: string;
	upgrade?: boolean;
	locals?: Record<string, unknown>;
}

/** Minimal fake RequestEvent — the handle only touches url, request, and locals */
function makeEvent(overrides: EventOverrides = {}): RequestEvent {
	const url = new URL(`https://example.com${overrides.pathname ?? '/api/websocket'}`);
	const headers = new Headers();
	if (overrides.upgrade !== false) headers.set('Upgrade', 'websocket');
	return {
		url,
		request: { url: url.href, method: 'GET', headers },
		locals: overrides.locals ?? {},
	} as unknown as RequestEvent;
}

const auth_locals = {
	session: { id: 's1' },
	user: {
		id: 'u1',
		name: 'Ada',
		user_auth_id: 'auth1',
		user_session_id: 'sess1',
	},
	org_id: 'org1',
	org: { permissions: 7 },
};

function makeStub() {
	const fetch_mock = vi.fn(async () => new Response(null, { status: 200 }));
	return { stub: { fetch: fetch_mock as unknown as typeof fetch }, fetch_mock };
}

async function run(
	options: Partial<WebsocketHandleOptions>,
	event: RequestEvent,
): Promise<{ response: Response; resolve: ReturnType<typeof vi.fn> }> {
	const resolve = vi.fn(async () => new Response('resolved'));
	const handle = createWebsocketHandle({
		getWebsocket: () => undefined,
		...options,
	});
	const response = await handle({ event, resolve });
	return { response, resolve };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createWebsocketHandle', () => {
	it('passes through requests for other paths', async () => {
		const { response, resolve } = await run({}, makeEvent({ pathname: '/api/other' }));
		expect(resolve).toHaveBeenCalledTimes(1);
		expect(await response.text()).toBe('resolved');
	});

	it('passes through non-upgrade requests on the websocket path', async () => {
		const { response, resolve } = await run({}, makeEvent({ upgrade: false }));
		expect(resolve).toHaveBeenCalledTimes(1);
		expect(await response.text()).toBe('resolved');
	});

	it('intercepts a custom path when configured', async () => {
		const { stub, fetch_mock } = makeStub();
		const { resolve } = await run(
			{
				path: '/ws',
				authorize: () => ({ meta: { user_id: 'u1' } }),
				getWebsocket: () => stub,
			},
			makeEvent({ pathname: '/ws' }),
		);
		expect(resolve).not.toHaveBeenCalled();
		expect(fetch_mock).toHaveBeenCalledTimes(1);
	});

	it('rejects with 401 when default authorize finds incomplete auth locals', async () => {
		const { response } = await run(
			{},
			makeEvent({ locals: { ...auth_locals, user: null } }),
		);
		expect(response.status).toBe(401);
	});

	it('rejects with 401 when a custom authorize returns undefined', async () => {
		const { response } = await run(
			{ authorize: () => undefined },
			makeEvent({ locals: auth_locals }),
		);
		expect(response.status).toBe(401);
	});

	it('returns 503 when no websocket stub is available', async () => {
		const { response } = await run(
			{ getWebsocket: () => undefined },
			makeEvent({ locals: auth_locals }),
		);
		expect(response.status).toBe(503);
	});

	it('forwards authorized requests to the DO with X-WS-Meta from auth locals', async () => {
		const { stub, fetch_mock } = makeStub();
		const { response } = await run(
			{ getWebsocket: () => stub },
			makeEvent({ locals: auth_locals }),
		);

		expect(response.status).toBe(200);
		expect(fetch_mock).toHaveBeenCalledTimes(1);
		const [url, init] = fetch_mock.mock.calls[0] as unknown as [
			string,
			{ headers: Headers; method: string },
		];
		expect(url).toBe('https://example.com/api/websocket');
		expect(init.method).toBe('GET');
		expect(init.headers.get('Upgrade')).toBe('websocket');
		expect(JSON.parse(init.headers.get('X-WS-Meta')!)).toEqual({
			room: 'org1',
			meta: {
				user_id: 'u1',
				user_name: 'Ada',
				user_auth_id: 'auth1',
				user_session_id: 'sess1',
				permission: 7,
			},
		});
	});

	it('forwards metadata from a custom authorize callback', async () => {
		const { stub, fetch_mock } = makeStub();
		await run(
			{
				authorize: async () => ({ room: 'r1', meta: { role: 'admin' } }),
				getWebsocket: () => stub,
			},
			makeEvent(),
		);

		const [, init] = fetch_mock.mock.calls[0] as unknown as [
			string,
			{ headers: Headers },
		];
		expect(JSON.parse(init.headers.get('X-WS-Meta')!)).toEqual({
			room: 'r1',
			meta: { role: 'admin' },
		});
	});
});
