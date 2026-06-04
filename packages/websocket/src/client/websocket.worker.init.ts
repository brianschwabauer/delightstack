import type { Remote } from 'comlink';
import type { WebsocketWorker } from './websocket.worker';

let cached: Promise<Remote<WebsocketWorker>> | undefined;
let raw_worker: Worker | SharedWorker | undefined;

/**
 * Returns a comlink-wrapped WebsocketWorker instance.
 * Uses SharedWorker in production, regular Worker in dev.
 * Returns the same promise on repeated calls (singleton).
 */
export function getWsWorker(dev = false): Promise<Remote<WebsocketWorker>> {
	if (cached) return cached;

	cached = (async () => {
		const { wrap } = await import('comlink');

		if (typeof SharedWorker !== 'undefined' && !dev) {
			const sw = new SharedWorker(new URL('./websocket.worker.js', import.meta.url), {
				type: 'module',
			});
			raw_worker = sw;
			return wrap<WebsocketWorker>(sw.port) as Remote<WebsocketWorker>;
		}

		const w = new Worker(new URL('./websocket.worker.js', import.meta.url), {
			type: 'module',
		});
		raw_worker = w;
		return wrap<WebsocketWorker>(w) as Remote<WebsocketWorker>;
	})();

	return cached;
}

/** Terminates the worker and clears the cached instance. */
export function resetWsWorker(): void {
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
