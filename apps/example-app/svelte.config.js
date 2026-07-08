import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
const packageJsonPath = fileURLToPath(new URL('./../../package.json', import.meta.url));
const packageJsonFile = readFileSync(packageJsonPath, 'utf8');
const packageJson = JSON.parse(packageJsonFile);

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// No `script: true` — Svelte 5 compiles TS scripts natively, and esbuild
	// script preprocessing strips comments (including `svelte-ignore` ones).
	preprocess: vitePreprocess(),
	compilerOptions: {
		experimental: {
			async: true,
		},
	},
	kit: {
		adapter: adapter({
			platformProxy: {
				configPath: './wrangler.jsonc',
				environment: 'staging',
				persist: { path: '.wrangler/state/v3' },
			},
		}),
		version: { name: `v${packageJson.version}` },
	},
};

export default config;
