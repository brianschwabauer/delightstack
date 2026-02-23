import type { UserPermissionMap, OauthCapabilityMap, UserSessionMeta } from '../types';
import type { AuthOperationResult } from './auth.db.server';

/**
 * Configuration for the auth integration layer.
 * Pass to `defineAuthConfig()` to fill in defaults, or directly to `createAuthHandle()`.
 */
export interface AuthConfig<
	PermissionMap extends UserPermissionMap = UserPermissionMap,
	CapabilityMap extends OauthCapabilityMap = OauthCapabilityMap,
> {
	/** JWT signing secret (hex-encoded HMAC-SHA256 key) */
	secret: string;

	/** JWT issuer identifier */
	issuer: string;

	/** Permission map for bitwise encoding */
	permission_map: PermissionMap;

	/** OAuth capability map for bitwise encoding */
	oauth_capability_map: CapabilityMap;

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
		/** Org cookie name @default 'auth-org' */
		org_name?: string;
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

	/** Email sending function for magic links, verification, password reset */
	email?: {
		sendEmail: (options: {
			to: string;
			subject: string;
			html: string;
			text: string;
			type: 'magic-link' | 'verification' | 'password-reset' | 'new-signin-method';
		}) => Promise<void>;
		/** Base URL for email links @default derived from request origin */
		base_url?: string;
	};

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
export interface ResolvedAuthConfig<
	PermissionMap extends UserPermissionMap = UserPermissionMap,
	CapabilityMap extends OauthCapabilityMap = OauthCapabilityMap,
> extends AuthConfig<PermissionMap, CapabilityMap> {
	base_path: string;
	csrf: boolean | { allowed_origins?: string[] };
	cookies: Required<NonNullable<AuthConfig['cookies']>>;
	session: Required<NonNullable<AuthConfig['session']>>;
}

/** Creates an auth config with sensible defaults */
export function defineAuthConfig<
	P extends UserPermissionMap,
	C extends OauthCapabilityMap,
>(config: AuthConfig<P, C>): ResolvedAuthConfig<P, C> {
	const dev = config.dev ?? false;
	return {
		...config,
		base_path: config.base_path ?? '/api/auth',
		csrf: config.csrf ?? true,
		cookies: {
			session_name: 'auth-session',
			org_name: 'auth-org',
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
