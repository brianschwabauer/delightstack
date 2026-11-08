import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

/**
 * The packaging proof, in the shape `packages/crdt` established.
 *
 * The node suite proves the protocol; it cannot prove that the code loads in
 * the runtime it ships to. This one runs inside workerd with no `nodejs_compat`
 * flag at all, so a stray `node:` import — or a Web Crypto call workerd does
 * not implement — fails here and only here.
 */
export default defineWorkersConfig({
	test: {
		include: ['src/__tests__/workerd.test.ts'],
		poolOptions: {
			workers: {
				miniflare: {
					compatibilityDate: '2026-03-10',
				},
			},
		},
	},
});
