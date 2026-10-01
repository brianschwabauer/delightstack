import { describe, expect, it } from 'vitest';
import { DelightError } from './error.helper';

/**
 * What a DelightError looks like after a Workers RPC hop (a Durable Object
 * method call, a service binding): workerd rebuilds it as a plain Error and
 * copies its own enumerable properties, but not its prototype.
 */
function afterRpc(options: {
	message: string;
	status: number;
	code?: string;
	detail?: string;
}) {
	const error = new Error(options.message);
	error.name = 'DelightError';
	Object.assign(error, {
		status: options.status,
		code: options.code,
		detail: options.detail,
		errors: [],
	});
	return error;
}

describe('DelightError.from', () => {
	it('keeps the status, code and detail of an error that crossed an RPC boundary', () => {
		const err = DelightError.from(
			afterRpc({
				message: 'Incorrect email or password',
				status: 401,
				code: 'invalid_credentials',
			}),
		);
		expect(err.status).toBe(401);
		expect(err.code).toBe('invalid_credentials');
		expect(err.message).toBe('Incorrect email or password');
	});

	it('still defaults a plain Error to 500', () => {
		expect(DelightError.from(new Error('boom')).status).toBe(500);
	});

	it('lets a transferable() JSON envelope win over own properties', () => {
		const envelope = DelightError.transferable({
			message: 'Nope',
			status: 409,
			code: 'conflict',
		});
		const crossed = new Error(envelope.message);
		Object.assign(crossed, { status: 500 });
		const err = DelightError.from(crossed);
		expect(err.status).toBe(409);
		expect(err.code).toBe('conflict');
		expect(err.message).toBe('Nope');
	});

	it('returns the same instance for a real DelightError', () => {
		const original = DelightError.notFound('Missing');
		expect(DelightError.from(original)).toBe(original);
	});
});
