import { describe, it, expect } from 'vitest';
import {
	Passkey,
	PasskeyRegistrationResponse,
	PasskeyAuthenticationResponse,
} from './passkey.type';

describe('Passkey', () => {
	it('parses a full passkey record', () => {
		const result = Passkey.safeParse({
			id: 'Y3JlZGVudGlhbC1pZA',
			user_auth_id: 'ua_1',
			name: 'MacBook Touch ID',
			device_type: 'multiDevice',
			backed_up: true,
			transports: ['internal', 'hybrid'],
			last_used_at: 1700000000000,
			created_at: 1700000000000,
			updated_at: 1700000000000,
		});
		expect(result.success).toBe(true);
	});

	it('parses a minimal passkey record', () => {
		const result = Passkey.safeParse({
			id: 'abc',
			user_auth_id: 'ua_1',
			backed_up: false,
			created_at: 1,
			updated_at: 1,
		});
		expect(result.success).toBe(true);
	});

	it('rejects an unknown device_type', () => {
		const result = Passkey.safeParse({
			id: 'abc',
			user_auth_id: 'ua_1',
			device_type: 'quantum',
			backed_up: false,
			created_at: 1,
			updated_at: 1,
		});
		expect(result.success).toBe(false);
	});
});

describe('PasskeyRegistrationResponse', () => {
	const valid = {
		id: 'Y3JlZA',
		rawId: 'Y3JlZA',
		type: 'public-key',
		response: {
			clientDataJSON: 'eyJ0eXBlIjoi',
			attestationObject: 'o2NmbXQ',
			transports: ['internal'],
		},
		clientExtensionResults: {},
	};

	it('parses a browser registration response', () => {
		expect(PasskeyRegistrationResponse.safeParse(valid).success).toBe(true);
	});

	it('allows unknown extra fields (loose parsing)', () => {
		const result = PasskeyRegistrationResponse.safeParse({
			...valid,
			authenticatorAttachment: 'platform',
			futureField: 'ok',
		});
		expect(result.success).toBe(true);
	});

	it('rejects a response missing the attestationObject', () => {
		const result = PasskeyRegistrationResponse.safeParse({
			...valid,
			response: { clientDataJSON: 'abc' },
		});
		expect(result.success).toBe(false);
	});

	it('rejects a non public-key credential type', () => {
		const result = PasskeyRegistrationResponse.safeParse({ ...valid, type: 'password' });
		expect(result.success).toBe(false);
	});
});

describe('PasskeyAuthenticationResponse', () => {
	const valid = {
		id: 'Y3JlZA',
		rawId: 'Y3JlZA',
		type: 'public-key',
		response: {
			clientDataJSON: 'eyJ0eXBlIjoi',
			authenticatorData: 'SZYN5Q',
			signature: 'MEUCIQ',
			userHandle: 'dXNlcl8x',
		},
		clientExtensionResults: {},
	};

	it('parses a browser authentication response', () => {
		expect(PasskeyAuthenticationResponse.safeParse(valid).success).toBe(true);
	});

	it('parses without the optional userHandle', () => {
		const result = PasskeyAuthenticationResponse.safeParse({
			...valid,
			response: {
				clientDataJSON: 'abc',
				authenticatorData: 'def',
				signature: 'ghi',
			},
		});
		expect(result.success).toBe(true);
	});

	it('rejects a response missing the signature', () => {
		const result = PasskeyAuthenticationResponse.safeParse({
			...valid,
			response: { clientDataJSON: 'abc', authenticatorData: 'def' },
		});
		expect(result.success).toBe(false);
	});
});
