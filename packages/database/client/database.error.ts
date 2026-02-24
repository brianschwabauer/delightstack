/**
 * Structured error for database CRUD operations.
 *
 * When thrown from a worker, comlink only preserves the `message` property.
 * This class encodes status/body in the message for worker-to-main transfer,
 * and provides `fromWorker()` to parse them back on the main thread.
 */
export class DatabaseError extends Error {
	readonly status: number;
	readonly body: Record<string, unknown>;

	constructor(message: string, status: number, body: Record<string, unknown>) {
		super(message);
		this.name = 'DatabaseError';
		this.status = status;
		this.body = body;
	}

	/**
	 * Create an error that encodes status/body in the message so they survive
	 * comlink's structured clone transfer. Use this in the worker.
	 */
	static transferable(
		message: string,
		status: number,
		body: Record<string, unknown>,
	): DatabaseError {
		return new DatabaseError(
			JSON.stringify({ m: message, s: status, b: body }),
			status,
			body,
		);
	}

	/**
	 * Parse an error transferred through comlink from a worker.
	 * Returns a DatabaseError with clean message, or null if not a DatabaseError.
	 */
	static fromWorker(error: unknown): DatabaseError | null {
		if (!(error instanceof Error)) return null;
		try {
			const { m, s, b } = JSON.parse(error.message);
			if (typeof s !== 'number' || typeof m !== 'string') return null;
			return new DatabaseError(m, s, b ?? {});
		} catch {
			return null;
		}
	}
}
