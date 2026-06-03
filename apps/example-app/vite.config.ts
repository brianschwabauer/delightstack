import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import Icons from 'unplugin-icons/vite';
import { fileURLToPath } from 'url';

const monorepoRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Resolve @delightstack/components to its TypeScript/Svelte source instead of
 * its built `dist/` output. This lets Vite compile the components directly,
 * so edits to packages/components/src hot-reload here with no `svelte-package`
 * build step. (The package's `exports` map points consumers at `dist/`, which
 * is correct for publishing but stale during local development.)
 */
const componentsSrc = fileURLToPath(
	new URL('../../packages/components/src', import.meta.url),
);

export default defineConfig({
	plugins: [sveltekit(), Icons({ compiler: 'svelte' })],
	resolve: {
		alias: {
			'@delightstack/components': componentsSrc,
		},
	},
	server: {
		fs: {
			allow: [monorepoRoot],
		},
	},
});
