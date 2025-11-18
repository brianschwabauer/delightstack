import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
const packageJsonPath = fileURLToPath(new URL('./../../package.json', import.meta.url));
const packageJsonFile = readFileSync(packageJsonPath, 'utf8');
const packageJson = JSON.parse(packageJsonFile);

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess({
		script: true,
	}),
	kit: {
		adapter: adapter({
			platformProxy: {
				configPath: './wrangler.jsonc',
				persist: {
					path: './../../.wrangler/state/v3',
				},
			},
		}),
		files: {
			assets: 'static',
			lib: 'lib',
			routes: 'routes',
			appTemplate: 'app.html',
		},
		version: { name: `v${packageJson.version}` },
	},
	vitePlugin: {
		inspector: {
			showToggleButton: 'active',
			toggleButtonPos: 'top-right',
		},
	},
};

export default config;
