import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import Icons from 'unplugin-icons/vite';

export default defineConfig({
	plugins: [sveltekit(), Icons({ compiler: 'svelte' })],
	// Tests that `mount()` a component need the client build of Svelte; without
	// this, `svelte` resolves to `index-server.js` and `mount` throws. The
	// `svelte/server` entry has no `browser` condition, so the SSR-render tests
	// are unaffected. (Same reason as packages/editor's vite config.)
	resolve: { conditions: ['browser'] },
	test: {
		// Source only. `svelte-package` copies `src` into `.svelte-kit/__package__`
		// and `dist`, so the default glob would collect two stale compiled copies
		// of every test and run each of them a second time.
		include: ['src/**/*.{test,spec}.{js,ts}'],
	},
});
