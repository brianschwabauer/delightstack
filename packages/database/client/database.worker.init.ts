import type { Remote } from 'comlink';
import type { DatabaseWorker } from './database.worker';

let cached: Promise<Remote<DatabaseWorker>> | undefined;

/**
 * Returns a comlink-wrapped DatabaseWorker instance.
 * Uses SharedWorker in production, regular Worker in dev.
 * Returns the same promise on repeated calls (singleton).
 */
export function getWorker(dev = false): Promise<Remote<DatabaseWorker>> {
	if (cached) return cached;

	cached = (async () => {
		const { wrap } = await import('comlink');

		if (typeof SharedWorker !== 'undefined' && !dev) {
			const sw = new SharedWorker(
				new URL('./database.worker.ts', import.meta.url),
				{ type: 'module' },
			);
			return wrap<DatabaseWorker>(sw.port) as Remote<DatabaseWorker>;
		}

		const w = new Worker(
			new URL('./database.worker.ts', import.meta.url),
			{ type: 'module' },
		);
		return wrap<DatabaseWorker>(w) as Remote<DatabaseWorker>;
	})();

	return cached;
}

/** Clears the cached worker instance (used when scope changes). */
export function resetWorker(): void {
	cached = undefined;
}
