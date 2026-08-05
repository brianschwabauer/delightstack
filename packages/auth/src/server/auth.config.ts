import type { UserSessionMeta } from '../types';
import type { AuthOperationResult, AuthDatabaseServer } from './auth.db.server';

/** The auth DO stub type — matches DurableObjectStub<AuthDatabaseServer> minus lifecycle methods. */
type AuthStub = DurableObjectStub<
	Omit<
		AuthDatabaseServer,
		'alarm' | 'webSocketMessage' | 'webSocketClose' | 'webSocketError' | 'fetch' | 'Rpc'
	>
>;

/**
 * Configuration for the auth integration layer.
 * Pass to `defineAuthConfig()` to fill in defaults, or directly to `createAuthHandle()`.
 */
export interface AuthConfig<
	P extends string = string,
	S extends string = string,
	E extends string = string,
> {
	/** JWT signing secret (hex-encoded HMAC-SHA256 key) */
	secret: string;

	/** JWT issuer identifier */
	issuer: string;

	/**
	 * Permission names for bitwise role encoding.
	 * Array index = bit position. Append-only: never reorder or remove entries.
	 * @example permissions: ['org:read', 'org:write', 'org:admin', 'org:owner']
	 */
	permissions: readonly P[];

	/**
	 * OAuth scope names for bitwise capability encoding.
	 * Array index = bit position. Append-only: never reorder or remove entries.
	 * @example oauth_scopes: ['profile', 'email', 'calendar']
	 */
	oauth_scopes: readonly S[];

	/**
	 * Entitlement names for bitwise org-level feature encoding.
	 * Array index = bit position. Append-only: never reorder or remove entries.
	 * @example entitlements: ['premium', 'video-uploads', 'extra-usage']
	 * @default []
	 */
	entitlements?: readonly E[];

	/**
	 * The permission (an entry in `permissions`) that marks a user as an admin of an
	 * organization. Admins can manage org members and update org metadata via the org
	 * API routes. The org owner can always do these regardless of this permission.
	 * Should match the `orgAdminPermission` option passed to the Durable Object.
	 * @default 'org:admin'
	 */
	org_admin_permission?: P[number] | (string & {});

	/**
	 * Whether the app is running in dev mode.
	 * Used for: cookie secure default, DO proxy detection.
	 * Pass `dev` from '$app/environment'.
	 * @default false
	 */
	dev?: boolean;

	/**
	 * Whether a session JWT may be supplied via the `?auth=` query parameter.
	 * Off by default: URLs end up in Referer headers, browser history, and
	 * server logs, so a query-string token source silently leaks sessions.
	 * Enable only for flows that genuinely can't send a cookie or header.
	 * @default false
	 */
	allow_query_token?: boolean;

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
			/**
			 * The vendor's user info endpoint, used to resolve the account's id, email,
			 * name & image. Only needed for vendors that don't return an OpenID Connect
			 * `id_token` alongside the access token.
			 * @example user_info_url: 'https://api.github.com/user'
			 */
			user_info_url?: string;
		};
	};

	/**
	 * Passkey (WebAuthn) configuration. Passkeys work with zero config — the relying
	 * party ID and origin are derived from the request URL. Set these explicitly when
	 * the app is served from multiple origins (e.g. a subdomain + apex domain).
	 */
	passkeys?: {
		/**
		 * The relying party ID — the domain passkeys are bound to (e.g. 'example.com').
		 * Passkeys registered under this ID work on it and all of its subdomains.
		 * @default the request hostname
		 */
		rp_id?: string;
		/** The human-readable app name shown in the browser's passkey prompt @default issuer */
		rp_name?: string;
		/**
		 * The web origins allowed to complete WebAuthn ceremonies (e.g. 'https://example.com').
		 * Must be set if the app is served from origins other than the request origin.
		 * @default [request origin]
		 */
		origins?: string[];
	};

	/**
	 * Email sending configuration for magic links, verification, and password reset.
	 * The `sendEmail` function receives default `subject`, `html`, and `text` along with the
	 * action `link` and/or one-time `code`. Use the defaults as-is or build custom email
	 * content using `link` / `code`.
	 *
	 * The `link` and `code` flags control what sign-in and verification emails contain —
	 * enable either or both. Password reset emails always contain a link.
	 */
	email?: {
		sendEmail: (options: {
			to: string;
			/** The action URL the user should visit. Omitted when `link` is disabled (sign-in / verification emails only) */
			link?: string;
			/** The one-time code the user can type instead of clicking the link. Present when `code` is enabled */
			code?: string;
			/** Default subject line — use as-is or replace with your own */
			subject: string;
			/** Default HTML body — use as-is or replace with your own using `link` / `code` */
			html: string;
			/** Default plain text body — use as-is or replace with your own using `link` / `code` */
			text: string;
			type: 'magic-link' | 'verification' | 'password-reset' | 'new-signin-method';
		}) => Promise<void>;
		/** Base URL for email links @default derived from request origin */
		base_url?: string;
		/** Include a clickable link in sign-in and verification emails @default true */
		link?: boolean;
		/**
		 * Include a one-time code in sign-in and verification emails — 6 lowercase
		 * characters, checked case-insensitively. Vowels and ambiguous characters
		 * (0/o, 1/l/i) are excluded so codes are easy to read and never spell words.
		 * Redeem via `POST /signin/email/code` and
		 * `POST /email/verify/code` (client: `auth.signIn.emailCode()` / `auth.email.verifyCode()`).
		 * @default false
		 */
		code?: boolean;
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
	 *
	 * @example
	 * ```ts
	 * // Subdomain-based org selection (e.g. acme.myapp.com)
	 * resolveOrgId: (event, session) => {
	 *   const subdomain = event.url.hostname.split('.')[0];
	 *   if (subdomain === 'www' || subdomain === 'myapp') return null;
	 *   const match = session?.org ? Object.entries(session.org).find(([, o]) => o.name === subdomain) : null;
	 *   return match?.[0] ?? null;
	 * }
	 * ```
	 *
	 * @example
	 * ```ts
	 * // From a cookie or custom header
	 * resolveOrgId: (event) => event.cookies.get('org_id') ?? event.request.headers.get('X-Org-Id') ?? null
	 * ```
	 *
	 * @example
	 * ```ts
	 * // Always select the first org (single-org apps)
	 * resolveOrgId: (_event, session) => Object.keys(session?.org ?? {})[0] ?? null
	 * ```
	 */
	resolveOrgId?: (
		event: import('@sveltejs/kit').RequestEvent,
		session: import('../types').SessionToken<'auth'> | null,
	) => string | null;

	/** Base path for auth API routes @default '/api/auth' */
	base_path?: string;

	/**
	 * CSRF protection. Verifies Origin/Referer headers on POST/PATCH/DELETE requests.
	 * @default true
	 */
	csrf?: boolean | { allowed_origins?: string[] };

	/** Lifecycle hooks for auth events. Each hook receives `auth` — the Durable Object stub for the current request. */
	hooks?: {
		onSignIn?: (ctx: {
			auth: AuthStub;
			result: AuthOperationResult;
			method: 'email' | 'magic-link' | 'email-code' | 'oauth' | 'passkey';
			is_new_user: boolean;
			meta: UserSessionMeta;
		}) => Promise<void>;

		onSignUp?: (ctx: {
			auth: AuthStub;
			result: AuthOperationResult;
			method: 'email' | 'magic-link' | 'email-code' | 'oauth';
			meta: UserSessionMeta;
		}) => Promise<void>;

		onNewSignInMethod?: (ctx: {
			auth: AuthStub;
			result: AuthOperationResult;
			vendor: string;
			meta: UserSessionMeta;
		}) => Promise<void>;

		onSignOut?: (ctx: {
			auth: AuthStub;
			user_id: string;
			session_id: string;
		}) => Promise<void>;

		onPasswordReset?: (ctx: {
			auth: AuthStub;
			user_id: string;
			email: string;
		}) => Promise<void>;
		onEmailVerified?: (ctx: {
			auth: AuthStub;
			user_id: string;
			email: string;
		}) => Promise<void>;
		onOrgJoined?: (ctx: {
			auth: AuthStub;
			user_id: string;
			org_id: string;
		}) => Promise<void>;
	};
}

/** Resolved auth config with all defaults filled in */
export interface ResolvedAuthConfig<
	P extends string = string,
	S extends string = string,
	E extends string = string,
> extends AuthConfig<P, S, E> {
	entitlements: readonly E[];
	org_admin_permission: string;
	base_path: string;
	csrf: boolean | { allowed_origins?: string[] };
	cookies: Required<NonNullable<AuthConfig['cookies']>>;
	session: Required<NonNullable<AuthConfig['session']>>;
}

/** Creates an auth config with sensible defaults */
export function defineAuthConfig<
	const P extends string,
	const S extends string,
	const E extends string,
>(config: AuthConfig<P, S, E>): ResolvedAuthConfig<P, S, E> {
	if (!/^[0-9a-fA-F]{64,}$/.test(config.secret)) {
		throw new Error(
			'Auth config: secret must be a hex-encoded string of at least 64 characters (32 bytes). ' +
				'Generate one with: openssl rand -hex 32',
		);
	}
	if (config.permissions.length > 32) {
		throw new Error(
			`Auth config: permissions array exceeds 32 entries (got ${config.permissions.length}). Bitwise encoding uses a 32-bit integer.`,
		);
	}
	if (config.oauth_scopes.length > 32) {
		throw new Error(
			`Auth config: oauth_scopes array exceeds 32 entries (got ${config.oauth_scopes.length}). Bitwise encoding uses a 32-bit integer.`,
		);
	}
	const entitlements = config.entitlements ?? [];
	if (entitlements.length > 32) {
		throw new Error(
			`Auth config: entitlements array exceeds 32 entries (got ${entitlements.length}). Bitwise encoding uses a 32-bit integer.`,
		);
	}
	const dev = config.dev ?? false;
	return {
		...config,
		entitlements,
		org_admin_permission: config.org_admin_permission ?? 'org:admin',
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
