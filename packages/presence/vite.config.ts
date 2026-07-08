import { defineConfig, type Plugin } from 'vitest/config';
import { transformWithEsbuild } from 'vite';
import { compileModule } from 'svelte/compiler';

/**
 * Compile Svelte 5 "runes module" files (`*.svelte.ts` / `*.svelte.js`) for
 * tests. `PresenceClient` lives in a `.svelte.ts` file and uses `$state` /
 * `$derived` / `$effect`, which must go through the Svelte compiler. We do it
 * inline (esbuild strips the TS, then `compileModule` lowers the runes) rather
 * than pulling in `@sveltejs/vite-plugin-svelte`, whose v5 line would churn the
 * shared build plugin for every other workspace package.
 */
function svelteRunesModules(): Plugin {
	return {
		name: 'presence:svelte-runes-modules',
		enforce: 'pre',
		async transform(code, id) {
			const file = id.split('?')[0];
			if (!/\.svelte\.(ts|js)$/.test(file)) return null;
			const js = file.endsWith('.ts')
				? (await transformWithEsbuild(code, file, { loader: 'ts' })).code
				: code;
			const compiled = compileModule(js, {
				filename: file,
				generate: 'client',
				dev: true,
			});
			return { code: compiled.js.code, map: compiled.js.map };
		},
	};
}

export default defineConfig({
	plugins: [svelteRunesModules()],
	// The Svelte client runtime (effects, `flushSync`) needs the browser build.
	resolve: { conditions: ['browser'] },
	test: {
		environment: 'happy-dom',
		include: ['src/**/*.test.ts'],
	},
});
