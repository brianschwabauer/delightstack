import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import Icons from 'unplugin-icons/vite';

export default defineConfig({
	plugins: [sveltekit(), Icons({ compiler: 'svelte' })],
	test: {
		// Source only. `svelte-package` copies `src` into `.svelte-kit/__package__`
		// and `dist`, so the default glob would collect two stale compiled copies
		// of every test and run each of them a second time.
		include: ['src/**/*.{test,spec}.{js,ts}'],
	},
});
