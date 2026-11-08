import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

/**
 * The workerd suite: `DatabaseServer` running as a real SQLite-backed Durable
 * Object, in the runtime it ships to.
 *
 * The node suite drives the class against `node:sqlite` through a façade. That
 * proves behaviour, but not three things only workerd can answer: what DO
 * SQLite allows (triggers, table rebuilds, `PRAGMA`s, temp tables), what each
 * operation is *billed* (the cursor's `rowsRead` / `rowsWritten`, which count
 * index entries and trigger writes), and that the package loads at all.
 */
export default defineWorkersConfig({
	test: {
		include: ['src/**/*.workerd.test.ts'],
		poolOptions: {
			workers: {
				main: './src/__workerd__/worker.ts',
				isolatedStorage: false,
				singleWorker: true,
				miniflare: {
					compatibilityDate: '2026-03-10',
					compatibilityFlags: ['nodejs_compat'],
					durableObjects: {
						DB: { className: 'TestDatabase', useSQLite: true },
						BARE: { className: 'BareDatabase', useSQLite: true },
					},
				},
			},
		},
	},
});
