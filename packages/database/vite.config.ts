import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'edge-runtime',
		include: ['**/*.test.ts'],
		exclude: ['**/node_modules/**', '**/*.workerd.test.ts'],
	},
});
