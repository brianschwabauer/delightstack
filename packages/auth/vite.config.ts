import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
	// @ts-ignore — vite-plugin-svelte resolves a different hoisted vite version than
	// vitest/config in this monorepo, so their Plugin types don't line up. The plugin
	// is required at runtime to compile auth's .svelte.ts rune modules for tests.
	plugins: [svelte()],
	test: {
		globals: true,
		environment: 'edge-runtime',
		include: ['**/*.test.ts'],
	},
});
