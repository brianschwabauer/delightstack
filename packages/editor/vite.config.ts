import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
	// vite-plugin-svelte compiles both .svelte components (node views, menus)
	// and .svelte.ts runes modules (Editor class, plugins) for tests — unlike
	// other workspace packages, the editor needs full component compilation
	// to test the NodeView bridge.
	plugins: [svelte({ compilerOptions: { dev: true } })],
	// The Svelte client runtime (effects, `flushSync`) needs the browser build.
	resolve: { conditions: ['browser'] },
	test: {
		environment: 'happy-dom',
		include: ['src/**/*.test.ts'],
	},
});
