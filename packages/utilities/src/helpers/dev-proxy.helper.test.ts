import { describe, expect, it } from 'vitest';
import { createDevHandle } from './dev-proxy.helper.js';

type Platform = { env: Record<string, unknown> };

async function run(platform: Platform) {
	const handle = createDevHandle({ url: 'http://localhost:9999', bindings: ['AUTH', 'DB'] });
	let seen: Platform | undefined;
	await handle({
		event: { platform },
		resolve: (event) => {
			seen = event.platform as Platform;
			return new Response('ok');
		},
	});
	return seen!;
}

describe('createDevHandle', () => {
	it('replaces the listed bindings on an ordinary env', async () => {
		const env: Record<string, unknown> = { AUTH: { stub: true }, OTHER: 1 };
		const platform = await run({ env });
		expect(platform.env.AUTH).not.toEqual({ stub: true });
		expect(typeof (platform.env.AUTH as { get: unknown }).get).toBe('function');
		expect(typeof (platform.env.DB as { get: unknown }).get).toBe('function');
		expect(platform.env.OTHER).toBe(1);
	});

	it("leaves a prerenderable route's getter-only env alone", async () => {
		// adapter-cloudflare's prerender platform: every binding is a getter that throws
		const env: Record<string, unknown> = {};
		for (const key of ['AUTH', 'DB']) {
			Object.defineProperty(env, key, {
				get: () => {
					throw new Error(`Cannot access platform.env.${key} in a prerenderable route`);
				},
			});
		}
		await expect(run({ env })).resolves.toBeDefined();
	});
});
