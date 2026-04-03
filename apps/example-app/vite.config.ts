import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import Icons from 'unplugin-icons/vite';
import { fileURLToPath } from 'url';

const monorepoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
	plugins: [
		sveltekit(),
		Icons({ compiler: 'svelte' }),
	],
	server: {
		fs: {
			allow: [monorepoRoot],
		},
	},
});
