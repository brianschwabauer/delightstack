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
	| 'csrf_failed'
	| 'unknown';

/**
 * Maps known DelightError detail/message strings to AuthErrorCode.
 * Used by route handlers to attach a typed `code` field to error responses.
 */
export const AUTH_ERROR_MAP: Record<string, AuthErrorCode> = {
	'auth/expired': 'session_expired',
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
	'Invalid or expired email verification link': 'invalid_token',
	'Invalid or expired reset password link': 'invalid_token',
	'Cannot remove the only admin from the organization': 'permission_denied',
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
