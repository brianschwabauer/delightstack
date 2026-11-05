import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import Icons from 'unplugin-icons/vite';

// Dev ports: the repo owns the 5220–5229 block (`system dev ports`): 5220 this
// site, 5221/5222 the example app + its worker, 5223 the docs. DEV_PORT moves
// the whole block (`system dev` sets it for a worktree's copy).
const DEV_PORT = Number(process.env.DEV_PORT) || 5220;

export default defineConfig({
	plugins: [sveltekit(), Icons({ compiler: 'svelte' })],
	server: {
		port: DEV_PORT,
		// Fail loudly instead of drifting to the next free port.
		strictPort: true,
	},
});
