import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['**/*.test.ts'],
		testTimeout: 120_000,
		hookTimeout: 120_000,
		alias: {
			// `src/loro.server.ts` pins `loro-crdt/bundler`, which is correct for
			// workerd (the default browser build throws at module scope there) but
			// unloadable under Vite's Node SSR transform — its wasm arrives through
			// an ESM wasm import that Node has no loader for, so the glue reads
			// `wasm.memory` off `undefined`. The `nodejs` build is the same
			// wasm-bindgen output over `fs.readFileSync`, so the semantics under
			// test are identical and only the loader differs. Tests only.
			'loro-crdt/bundler': 'loro-crdt/nodejs',
			'loro-crdt/web': 'loro-crdt/nodejs',
		},
	},
});
