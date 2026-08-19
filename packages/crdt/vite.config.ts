import { defineConfig, type Plugin } from 'vitest/config';
import { transformWithEsbuild } from 'vite';
import { compileModule } from 'svelte/compiler';

/**
 * Compile Svelte 5 "runes module" files (`*.svelte.ts`) for tests.
 *
 * `CrdtClient` lives in a `.svelte.ts` file and uses `$state` / `$derived`,
 * which must go through the Svelte compiler. Done inline (esbuild strips the
 * TS, `compileModule` lowers the runes) rather than by pulling in
 * `@sveltejs/vite-plugin-svelte`, which would churn the shared build plugin for
 * every other workspace package. Same approach as `packages/presence`.
 */
function svelteRunesModules(): Plugin {
	return {
		name: 'crdt:svelte-runes-modules',
		enforce: 'pre',
		async transform(code, id) {
			const file = id.split('?')[0];
			if (!/\.svelte\.(ts|js)$/.test(file)) return null;
			const js = file.endsWith('.ts')
				? (await transformWithEsbuild(code, file, { loader: 'ts' })).code
				: code;
			const compiled = compileModule(js, { filename: file, generate: 'client', dev: true });
			return { code: compiled.js.code, map: compiled.js.map };
		},
	};
}

export default defineConfig({
	plugins: [svelteRunesModules()],
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
