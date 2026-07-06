/** Typed error codes returned by auth API responses */
export type AuthErrorCode =
	| 'invalid_credentials'
	| 'email_taken'
	| 'rate_limited'
	| 'weak_password'
	| 'unverified_email'
	| 'session_expired'
	| 'session_not_found'
	| 'invalid_token'
	| 'invalid_code'
	| 'token_expired'
	| 'email_not_found'
	| 'method_not_found'
	| 'last_method'
	| 'permission_denied'
	| 'org_not_found'
	| 'invitation_expired'
	| 'invitation_not_found'
	| 'user_deleted'
	| 'oauth_account_conflict'
	| 'passkey_failed'
	| 'passkey_taken'
	| 'passkey_not_found'
	| 'csrf_failed'
	| 'unknown';

/**
 * Maps known DelightError detail/message strings to AuthErrorCode.
 * Used by route handlers to attach a typed `code` field to error responses.
 */
export const AUTH_ERROR_MAP: Record<string, AuthErrorCode> = {
	'auth/expired': 'session_expired',
	'auth/not_yet_valid': 'invalid_token',
	'Incorrect email or password': 'invalid_credentials',
	'Email is already in use': 'email_taken',
	'Too many failed sign in attempts': 'rate_limited',
	'Too many failed sign up attempts': 'rate_limited',
	'Too many email availability checks': 'rate_limited',
	'Too many password reset requests': 'rate_limited',
	'Too many email & password checks': 'rate_limited',
	'Password is too common': 'weak_password',
	'Password must be at least 8 characters': 'weak_password',
	'Invitation has been deleted or is expired': 'invitation_expired',
	'account has been deleted': 'user_deleted',
	"Can't sign-in to a deleted account": 'user_deleted',
	"Can't connect an oauth account that is already connected": 'oauth_account_conflict',
	'You cannot revoke the last verified sign in method': 'last_method',
	"Can't refresh a revoked session": 'session_not_found',
	'Invalid or expired email sign-in link': 'invalid_token',
	'Incorrect or expired sign-in code': 'invalid_code',
	'Incorrect or expired verification code': 'invalid_code',
	'Too many sign-in email requests': 'rate_limited',
	'Invalid or expired email verification link': 'invalid_token',
	'Invalid or expired reset password link': 'invalid_token',
	'Cannot remove the only admin from the organization': 'permission_denied',
	'You do not have access to this organization': 'permission_denied',
	'Only the organization owner can do this': 'permission_denied',
	'Only the organization owner can transfer ownership': 'permission_denied',
	'You must be an organization admin to do this': 'permission_denied',
	'Too many passkey requests': 'rate_limited',
	'Passkey could not be verified': 'passkey_failed',
	'Passkey not recognized': 'passkey_failed',
	'Invalid passkey response': 'passkey_failed',
	'Invalid or expired passkey challenge': 'passkey_failed',
	'This passkey is already registered': 'passkey_taken',
	'Could not find passkey': 'passkey_not_found',
};

/** Resolves an AuthErrorCode from a DelightError's detail or message string */
export function resolveErrorCode(error: {
	detail?: string;
	message?: string;
}): AuthErrorCode {
	if (error.detail && error.detail in AUTH_ERROR_MAP) return AUTH_ERROR_MAP[error.detail];
	const msg = error.message || '';
	for (const [key, code] of Object.entries(AUTH_ERROR_MAP)) {
		if (msg.includes(key)) return code;
	}
	return 'unknown';
}
