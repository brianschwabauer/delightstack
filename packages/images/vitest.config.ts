import { existsSync } from 'node:fs';
import { configDefaults, defineConfig } from 'vitest/config';

// exif.test.ts runs the real container pipeline, and sharp lives only in the
// container's own dependency tree (container/node_modules), which a workspace
// install (CI included) doesn't create. Run it wherever the container's
// dependencies are installed; skip it elsewhere instead of failing to load.
const has_container_deps = existsSync(
	new URL('./container/node_modules/sharp', import.meta.url),
);

export default defineConfig({
	test: {
		exclude: [
			...configDefaults.exclude,
			...(has_container_deps ? [] : ['tests/exif.test.ts']),
		],
	},
});
