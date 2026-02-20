import { describe, it, expect } from 'vitest';
import { resolveErrorCode, AUTH_ERROR_MAP } from './error.type';

describe('resolveErrorCode', () => {
	it('resolves known detail strings', () => {
		expect(resolveErrorCode({ detail: 'auth/expired' })).toBe('session_expired');
	});

	it('resolves known message strings by exact match', () => {
		expect(resolveErrorCode({ message: 'Incorrect email or password' })).toBe(
			'invalid_credentials',
		);
		expect(resolveErrorCode({ message: 'Email is already in use' })).toBe(
			'email_taken',
		);
		expect(resolveErrorCode({ message: 'Password is too common' })).toBe(
			'weak_password',
		);
		expect(resolveErrorCode({ message: 'Password must be at least 8 characters' })).toBe(
			'weak_password',
		);
	});

	it('resolves rate limiting messages', () => {
		expect(
			resolveErrorCode({ message: 'Too many failed sign in attempts' }),
		).toBe('rate_limited');
		expect(
			resolveErrorCode({ message: 'Too many failed sign up attempts' }),
		).toBe('rate_limited');
		expect(
			resolveErrorCode({ message: 'Too many email availability checks' }),
		).toBe('rate_limited');
		expect(
			resolveErrorCode({ message: 'Too many password reset requests' }),
		).toBe('rate_limited');
	});

	it('resolves user deletion messages', () => {
		expect(
			resolveErrorCode({ message: 'account has been deleted' }),
		).toBe('user_deleted');
		expect(
			resolveErrorCode({ message: "Can't sign-in to a deleted account" }),
		).toBe('user_deleted');
	});

	it('resolves OAuth conflict', () => {
		expect(
			resolveErrorCode({
				message: "Can't connect an oauth account that is already connected",
			}),
		).toBe('oauth_account_conflict');
	});

	it('resolves token-related errors', () => {
		expect(
			resolveErrorCode({ message: 'Invalid or expired email sign-in link' }),
		).toBe('invalid_token');
		expect(
			resolveErrorCode({ message: 'Invalid or expired email verification link' }),
		).toBe('invalid_token');
		expect(
			resolveErrorCode({ message: 'Invalid or expired reset password link' }),
		).toBe('invalid_token');
	});

	it('resolves invitation errors', () => {
		expect(
			resolveErrorCode({ message: 'Invitation has been deleted or is expired' }),
		).toBe('invitation_expired');
	});

	it('resolves permission errors', () => {
		expect(
			resolveErrorCode({
				message: 'Cannot remove the only admin from the organization',
			}),
		).toBe('permission_denied');
	});

	it('resolves last method error', () => {
		expect(
			resolveErrorCode({
				message: 'You cannot revoke the last verified sign in method',
			}),
		).toBe('last_method');
	});

	it('resolves session not found', () => {
		expect(
			resolveErrorCode({ message: "Can't refresh a revoked session" }),
		).toBe('session_not_found');
	});

	it('prefers detail over message when both match', () => {
		expect(
			resolveErrorCode({
				detail: 'auth/expired',
				message: 'Incorrect email or password',
			}),
		).toBe('session_expired');
	});

	it('returns "unknown" for unrecognized errors', () => {
		expect(resolveErrorCode({ message: 'Some weird error' })).toBe('unknown');
		expect(resolveErrorCode({ detail: 'unknown/detail' })).toBe('unknown');
		expect(resolveErrorCode({})).toBe('unknown');
	});

	it('returns "unknown" for empty message', () => {
		expect(resolveErrorCode({ message: '' })).toBe('unknown');
	});

	it('matches messages containing known substrings', () => {
		// The error map matches via includes(), so messages with extra context should still resolve
		expect(
			resolveErrorCode({ message: 'Error: account has been deleted, contact support' }),
		).toBe('user_deleted');
	});

	it('covers all entries in AUTH_ERROR_MAP', () => {
		for (const [key, expectedCode] of Object.entries(AUTH_ERROR_MAP)) {
			// Test as detail
			if (!key.includes('/')) {
				// Non-detail keys are messages
				const result = resolveErrorCode({ message: key });
				expect(result).toBe(expectedCode);
			} else {
				const result = resolveErrorCode({ detail: key });
				expect(result).toBe(expectedCode);
			}
		}
	});
});
