import type { Remote } from 'comlink';
import type { DatabaseWorker } from './database.worker';

let cached: Promise<Remote<DatabaseWorker>> | undefined;
let raw_worker: Worker | SharedWorker | undefined;

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
			const sw = new SharedWorker(new URL('./database.worker.ts', import.meta.url), {
				type: 'module',
			});
			raw_worker = sw;
			return wrap<DatabaseWorker>(sw.port) as Remote<DatabaseWorker>;
		}

		const w = new Worker(new URL('./database.worker.ts', import.meta.url), {
			type: 'module',
		});
		raw_worker = w;
		return wrap<DatabaseWorker>(w) as Remote<DatabaseWorker>;
	})();

	return cached;
}

/** Terminates the worker and clears the cached instance. */
export function resetWorker(): void {
	if (raw_worker) {
		if (raw_worker instanceof SharedWorker) {
			raw_worker.port.close();
		} else {
			raw_worker.terminate();
		}
		raw_worker = undefined;
	}
	cached = undefined;
}
