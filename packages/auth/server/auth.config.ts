import type { UserSessionMeta } from '../types';
import type { AuthOperationResult } from './auth.db.server';

/**
 * Configuration for the auth integration layer.
 * Pass to `defineAuthConfig()` to fill in defaults, or directly to `createAuthHandle()`.
 */
export interface AuthConfig {
	/** JWT signing secret (hex-encoded HMAC-SHA256 key) */
	secret: string;

	/** JWT issuer identifier */
	issuer: string;

	/**
	 * Permission names for bitwise role encoding.
	 * Array index = bit position. Append-only: never reorder or remove entries.
	 * @example permissions: ['org:read', 'org:write', 'org:admin', 'org:owner']
	 */
	permissions: readonly string[];

	/**
	 * OAuth scope names for bitwise capability encoding.
	 * Array index = bit position. Append-only: never reorder or remove entries.
	 * @example oauth_scopes: ['profile', 'email', 'calendar']
	 */
	oauth_scopes: readonly string[];

	/**
	 * Whether the app is running in dev mode.
	 * Used for: cookie secure default, DO proxy detection.
	 * Pass `dev` from '$app/environment'.
	 * @default false
	 */
	dev?: boolean;

	/** Cookie configuration */
	cookies?: {
		/** Session cookie name @default 'auth-session' */
		session_name?: string;
		/** User preferences cookie name @default 'auth-pref' */
		preferences_name?: string;
		/** Per-org state cookie name prefix @default 'auth-org-' */
		org_state_prefix?: string;
		/** Cookie path @default '/' */
		path?: string;
		/** Secure cookies (HTTPS only) @default !dev */
		secure?: boolean;
		/** httpOnly — prevents JavaScript access @default true */
		http_only?: boolean;
		/** SameSite policy @default 'lax' */
		same_site?: 'strict' | 'lax' | 'none';
	};

	/** Session configuration */
	session?: {
		/** Session duration in seconds @default 3600 (1 hour) */
		expires_in?: number;
		/** Refresh threshold in seconds @default 600 (10 minutes) */
		refresh_threshold?: number;
	};

	/** OAuth providers configuration (for signing in via third-party providers) */
	oauth?: {
		[vendor: string]: {
			client_id: string;
			client_secret: string;
			authorization_url: string;
			access_token_url: string;
			scopes?: string[];
		};
	};

	/**
	 * Email sending configuration for magic links, verification, and password reset.
	 * The `sendEmail` function receives default `subject`, `html`, and `text` along with the
	 * action `link`. Use the defaults as-is or build custom email content using the `link`.
	 */
	email?: {
		sendEmail: (options: {
			to: string;
			/** The action URL the user should visit (e.g. verification link, password reset link) */
			link: string;
			/** Default subject line — use as-is or replace with your own */
			subject: string;
			/** Default HTML body — use as-is or replace with your own using `link` */
			html: string;
			/** Default plain text body — use as-is or replace with your own using `link` */
			text: string;
			type: 'magic-link' | 'verification' | 'password-reset' | 'new-signin-method';
		}) => Promise<void>;
		/** Base URL for email links @default derived from request origin */
		base_url?: string;
	};

	/**
	 * Custom org_id resolver. Called on every request to determine the active organization.
	 * Receives the SvelteKit RequestEvent and the decoded session (null if not authenticated).
	 * Return the org_id string or null if no org is selected.
	 *
	 * @default Resolves from: URL params (org_id) > query (?org=) > header (Org-ID) > auto-select (single org)
	 *
	 * @example
	 * ```ts
	 * // Route-based org selection from /org/[org_id]/...
	 * resolveOrgId: (event, session) => event.params.org_id || null
	 * ```
	 */
	resolveOrgId?: (event: import('@sveltejs/kit').RequestEvent, session: import('../types').SessionToken<'auth'> | null) => string | null;

	/** Base path for auth API routes @default '/api/auth' */
	base_path?: string;

	/**
	 * CSRF protection. Verifies Origin/Referer headers on POST/PATCH/DELETE requests.
	 * @default true
	 */
	csrf?: boolean | { allowed_origins?: string[] };

	/** Lifecycle hooks for auth events */
	hooks?: {
		onSignIn?: (ctx: {
			result: AuthOperationResult;
			method: 'email' | 'magic-link' | 'oauth';
			is_new_user: boolean;
			meta: UserSessionMeta;
		}) => Promise<void>;

		onSignUp?: (ctx: {
			result: AuthOperationResult;
			method: 'email' | 'magic-link' | 'oauth';
			meta: UserSessionMeta;
		}) => Promise<void>;

		onNewSignInMethod?: (ctx: {
			result: AuthOperationResult;
			vendor: string;
			meta: UserSessionMeta;
		}) => Promise<void>;

		onSignOut?: (ctx: { user_id: string; session_id: string }) => Promise<void>;

		onPasswordReset?: (ctx: { user_id: string; email: string }) => Promise<void>;
		onEmailVerified?: (ctx: { user_id: string; email: string }) => Promise<void>;
		onOrgJoined?: (ctx: { user_id: string; org_id: string }) => Promise<void>;
	};
}

/** Resolved auth config with all defaults filled in */
export interface ResolvedAuthConfig extends AuthConfig {
	base_path: string;
	csrf: boolean | { allowed_origins?: string[] };
	cookies: Required<NonNullable<AuthConfig['cookies']>>;
	session: Required<NonNullable<AuthConfig['session']>>;
}

/** Creates an auth config with sensible defaults */
export function defineAuthConfig(config: AuthConfig): ResolvedAuthConfig {
	const dev = config.dev ?? false;
	return {
		...config,
		base_path: config.base_path ?? '/api/auth',
		csrf: config.csrf ?? true,
		cookies: {
			session_name: 'auth-session',
			preferences_name: 'auth-pref',
			org_state_prefix: 'auth-org-',
			path: '/',
			http_only: true,
			secure: !dev,
			same_site: 'lax',
			...config.cookies,
		},
		session: {
			expires_in: 3600,
			refresh_threshold: 600,
			...config.session,
		},
	};
}
