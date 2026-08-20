import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

/**
 * The packaging proof.
 *
 * The main `vite.config.ts` aliases `loro-crdt/bundler` to `loro-crdt/nodejs`,
 * because the bundler build's wasm arrives through an ESM wasm import Node has
 * no loader for. That alias is what makes the ordinary suite runnable — and it
 * is also why the ordinary suite cannot prove the thing `loro.server.ts` exists
 * to do. This config deliberately sets **no alias**, so the specifier the
 * shipped code pins is the specifier workerd actually loads.
 *
 * It is a small suite on purpose. The behaviour of the CRDT is covered
 * exhaustively by the node suite; what runs here is the question that can only
 * be answered inside workerd.
 */
export default defineWorkersConfig({
	test: {
		include: ['src/__tests__/workerd.test.ts'],
		poolOptions: {
			workers: {
				miniflare: {
					compatibilityDate: '2026-03-10',
					compatibilityFlags: ['nodejs_compat'],
				},
			},
		},
	},
});
