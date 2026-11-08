import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		// `node` rather than `edge-runtime`: every API the package touches
		// (`fetch`, `Request`, `crypto.subtle`, `ReadableStream`) is global in
		// modern Node, and the one question the Node environment cannot answer —
		// does the shipped code load inside workerd — is the whole point of
		// `vitest.workers.config.ts`.
		environment: 'node',
		include: ['**/*.test.ts'],
		exclude: ['**/node_modules/**', 'src/__tests__/workerd.test.ts'],
	},
});
