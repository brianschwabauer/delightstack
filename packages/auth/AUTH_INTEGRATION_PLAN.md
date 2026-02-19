# Delightstack Auth - SvelteKit Integration Plan

## Overview

This document outlines the plan to create a streamlined SvelteKit authentication integration for `@delightstack/auth`, inspired by [better-auth's SvelteKit integration](https://www.better-auth.com/docs/integrations/svelte-kit). The goal is to enable developers to add authentication to their SvelteKit apps by calling a single handler function in their server hooks.

### Naming Conventions

- **camelCase** for all functions and methods (callable things): `createAuthHandle()`, `signInWithEmail()`, `defineAuthConfig()`
- **snake_case** for all properties and fields (non-callable things): `base_path`, `client_id`, `session_name`
- Rationale: visual distinction between callable and non-callable; snake_case matches SQLite column names on the backend

## Current State

### What Exists

**Server-side (`packages/auth/server/`):**

- `auth.db.server.ts` - Complete `AuthDatabaseServer` Durable Object class with 44+ methods:
  - Email/password sign-in (`signInWithEmail`)
  - Magic link sign-in (`signInWithEmailToken`, `createEmailSignInToken`)
  - Email sign-up (`signUpWithEmail`)
  - OAuth sign-in (`signInWithOauth`)
  - Session management (`refreshSession`, `revokeSession`, `listSessions`)
  - Password reset (`createPasswordResetToken`, `resetPassword`)
  - Email verification (`createEmailVerificationToken`, `verifyEmail`)
  - Password strength checking (`checkPasswordStrength` — uses haveibeenpwned API)
  - User/org management
  - Invitation management (`createInvitation`, `acceptInvitation`, `listInvitations`)
  - Third-party OAuth application support (for being an OAuth provider)
- `jwt.server.ts` - JWT generation and verification utilities
- `auth.sql.schema.ts` - SQLite schema definitions
- `oauth.helper.ts` - OAuth token exchange utilities

**Types (`packages/auth/types/`):**

- `auth.type.ts` - Session tokens, permissions, sign-in schemas
- `oauth.type.ts` - OAuth configurations, tokens, applications
- `meta.type.ts` - Common metadata types

### Current Integration Pattern (Example App)

```typescript
// hooks.server.ts - Manual JWT handling
export const handle: Handle = async ({ event, resolve }) => {
	// 1. Extract JWT from cookies/headers
	// 2. Decode and verify JWT manually
	// 3. Refresh expired tokens manually
	// 4. Set up auth Durable Object connection
	// 5. Create AuthState instance
	// 6. Call resolve(event)
};
```

This requires ~200 lines of boilerplate code in every app's hooks.server.ts.

## Proposed Architecture

### Design Goals

1. **Single function call** in `hooks.server.ts` to handle all auth
2. **Automatic route handling** for `/api/auth/*` endpoints (auth + account management)
3. **Reactive client** with Svelte 5 runes
4. **Type-safe** throughout, including typed error responses
5. **Cloudflare-compatible** (Durable Objects, Workers)
6. **Configurable** with sensible defaults
7. **Secure by default** — CSRF protection, rate limiting, origin checks
8. **Headless-first components** — composable with `@delightstack/components` primitives

### File Structure

```
packages/auth/
├── index.ts                    # Main exports
├── types/
│   ├── auth.type.ts           # Existing types
│   ├── oauth.type.ts          # Existing types
│   ├── meta.type.ts           # Existing types
│   └── error.type.ts          # NEW: Typed auth errors
├── server/
│   ├── index.ts               # Server exports
│   ├── auth.db.server.ts      # Existing Durable Object
│   ├── auth.sql.schema.ts     # Existing schema
│   ├── jwt.server.ts          # Existing JWT utilities
│   ├── oauth.helper.ts        # Existing OAuth utilities
│   ├── auth.handler.ts        # NEW: SvelteKit handler factory
│   ├── auth.config.ts         # NEW: Configuration types
│   └── auth.routes.ts         # NEW: Route handlers
├── client/
│   ├── index.ts               # Client exports
│   ├── auth.client.ts         # NEW: Client auth instance
│   ├── auth.state.svelte.ts   # NEW: Reactive auth state
│   └── components/
│       ├── SignInForm.svelte   # NEW: Sign-in component (headless-first)
│       ├── SignUpForm.svelte   # NEW: Sign-up component (headless-first)
│       ├── OAuthButton.svelte  # NEW: OAuth provider button
│       └── AuthGuard.svelte    # NEW: Conditional rendering based on auth state
└── sveltekit/
    ├── index.ts               # SvelteKit-specific exports
    ├── cookies.ts             # Cookie handling utilities
    └── guards.ts              # NEW: Route guard helpers
```

---

## Detailed Specifications

### 1. Typed Errors (`error.type.ts`)

All auth API routes return typed error responses. This lets the client render meaningful messages without string-matching.

```typescript
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
	| 'last_method' // cannot remove last sign-in method
	| 'permission_denied'
	| 'org_not_found'
	| 'invitation_expired'
	| 'invitation_not_found'
	| 'csrf_failed'
	| 'unknown';

export interface AuthError {
	code: AuthErrorCode;
	message: string;
	/** Seconds until rate limit resets (only for 'rate_limited') */
	retry_after?: number;
}

export interface AuthResponse<T = unknown> {
	ok: boolean;
	data?: T;
	error?: AuthError;
}
```

### 2. Server Configuration (`auth.config.ts`)

```typescript
import type { UserPermissionMap, OauthCapabilityMap } from '../types';
import type { AuthDatabaseServer } from './auth.db.server';
import type { SessionToken } from '../types';

export interface AuthConfig<
	PermissionMap extends UserPermissionMap = UserPermissionMap,
	CapabilityMap extends OauthCapabilityMap = OauthCapabilityMap,
> {
	/**
	 * JWT signing secret (hex-encoded)
	 * Generate with: crypto.subtle.generateKey({name: 'HMAC', hash: 'SHA-256'}, true, ['sign', 'verify'])
	 */
	secret: string;

	/**
	 * JWT issuer identifier
	 */
	issuer: string;

	/**
	 * Permission map for bitwise encoding
	 */
	permission_map: PermissionMap;

	/**
	 * OAuth capability map for bitwise encoding
	 */
	oauth_capability_map: CapabilityMap;

	/**
	 * Cookie configuration
	 */
	cookies?: {
		/** Session cookie name @default 'auth-session' */
		session_name?: string;
		/** Org cookie name @default 'auth-org' */
		org_name?: string;
		/** Cookie path @default '/' */
		path?: string;
		/** Secure cookies (HTTPS only) @default true in production */
		secure?: boolean;
		/** SameSite policy @default 'lax' */
		same_site?: 'strict' | 'lax' | 'none';
	};

	/**
	 * Session configuration
	 */
	session?: {
		/** Session duration in seconds @default 3600 (1 hour) */
		expires_in?: number;
		/** Refresh threshold in seconds @default 600 (10 minutes) */
		refresh_threshold?: number;
	};

	/**
	 * OAuth providers configuration
	 */
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
	 * Email configuration for magic links, verification, password reset
	 */
	email?: {
		/** Function to send emails */
		sendEmail: (options: {
			to: string;
			subject: string;
			html: string;
			text: string;
			type: 'magic-link' | 'verification' | 'password-reset';
		}) => Promise<void>;
		/** Base URL for email links @default derived from request origin */
		base_url?: string;
	};

	/**
	 * Base path for auth API routes @default '/api/auth'
	 */
	base_path?: string;

	/**
	 * CSRF protection configuration
	 * Verifies Origin/Referer headers on POST/PATCH/DELETE requests.
	 * @default true
	 */
	csrf?:
		| boolean
		| {
				/** Additional origins to allow beyond the request host */
				allowed_origins?: string[];
		  };

	/**
	 * Rate limiting configuration (tuning for the built-in rate limiter)
	 */
	rate_limiting?: {
		sign_in?: { max_attempts?: number; window_seconds?: number }; // default 5 / 10s
		magic_link?: { max_attempts?: number; window_seconds?: number }; // default 3 / 60s
		password_reset?: { max_attempts?: number; window_seconds?: number }; // default 3 / 60s
		sign_up?: { max_attempts?: number; window_seconds?: number }; // default 5 / 60s
	};

	/**
	 * Lifecycle hooks for auth events (for custom logic like analytics, welcome emails, provisioning)
	 */
	hooks?: {
		onSignIn?: (ctx: {
			user: { id: string; email: string; name?: string };
			session: SessionToken<'auth'>;
			method: 'email' | 'magic-link' | 'oauth';
			is_new_user: boolean;
		}) => Promise<void>;

		onSignUp?: (ctx: {
			user: { id: string; email: string; name?: string };
			method: 'email' | 'magic-link' | 'oauth';
		}) => Promise<void>;

		onSignOut?: (ctx: {
			user: { id: string; email: string };
			session_id: string;
		}) => Promise<void>;

		onPasswordReset?: (ctx: { user: { id: string; email: string } }) => Promise<void>;

		onEmailVerified?: (ctx: { user: { id: string; email: string } }) => Promise<void>;

		onOrgJoined?: (ctx: {
			user: { id: string; email: string };
			org: { id: string; name: string };
		}) => Promise<void>;
	};
}

export function defineAuthConfig<
	P extends UserPermissionMap,
	C extends OauthCapabilityMap,
>(config: AuthConfig<P, C>): AuthConfig<P, C> {
	return {
		...config,
		base_path: config.base_path ?? '/api/auth',
		csrf: config.csrf ?? true,
		cookies: {
			session_name: 'auth-session',
			org_name: 'auth-org',
			path: '/',
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
```

### 3. SvelteKit Handler Factory (`auth.handler.ts`)

Returns a `Handle` function from a factory, composable with SvelteKit's `sequence()`.

```typescript
import type { Handle, RequestEvent } from '@sveltejs/kit';
import type { AuthConfig } from './auth.config';
import type { AuthDatabaseServer } from './auth.db.server';
import type { SessionToken, UserSessionMeta } from '../types';

export interface AuthHandleOptions<Config extends AuthConfig> {
	/** The auth configuration */
	config: Config;

	/** Get the auth Durable Object instance (receives the current event) */
	getAuthDO: (event: RequestEvent) => AuthDatabaseServer;

	/** Whether the app is building (for static builds) */
	building?: boolean;
}

export interface AuthLocals {
	/** The decoded session token */
	session: SessionToken<'auth'> | null;

	/** The raw JWT string */
	jwt: string | null;

	/** The current user info (convenience accessor) */
	user: {
		id: string;
		email: string;
		name: string;
		verified: boolean;
	} | null;

	/** The current organization ID */
	org_id: string | null;

	/** User session metadata */
	meta: UserSessionMeta;

	/** The auth database instance */
	auth: AuthDatabaseServer;
}

/**
 * Create a SvelteKit Handle function for authentication.
 *
 * Returns a Handle that can be used directly or composed with sequence().
 */
export function createAuthHandle<Config extends AuthConfig>(
	options: AuthHandleOptions<Config>,
): Handle {
	return async ({ event, resolve }) => {
		// Implementation will:
		// 1. Skip during static builds
		// 2. Verify CSRF on mutating requests (POST/PATCH/DELETE) if enabled
		// 3. Extract JWT from cookies/headers/query
		// 4. Decode and validate JWT
		// 5. Auto-refresh expired tokens (within refresh_threshold window)
		// 6. Populate event.locals with auth data (AuthLocals)
		// 7. Handle /api/auth/* routes if matched (see auth.routes.ts)
		// 8. Call resolve(event) for non-auth routes
	};
}
```

### 4. Auth Routes (`auth.routes.ts`)

The handler will automatically handle these routes under the configured `base_path`.

#### Authentication Routes

| Method | Route                      | Description                       | Server Method              |
| ------ | -------------------------- | --------------------------------- | -------------------------- |
| POST   | `/signin/email`            | Email + password sign-in          | `signInWithEmail()`        |
| POST   | `/signin/email/magic`      | Request magic link                | `createEmailSignInToken()` |
| GET    | `/signin/email/verify`     | Verify magic link token           | `signInWithEmailToken()`   |
| POST   | `/signup/email`            | Email sign-up                     | `signUpWithEmail()`        |
| GET    | `/signin/:vendor`          | Initiate OAuth flow               | — (redirect)               |
| GET    | `/signin/:vendor/callback` | OAuth callback                    | `signInWithOauth()`        |
| POST   | `/signout`                 | Sign out (revoke current session) | `revokeSession()`          |

#### Session Routes

| Method | Route              | Description               | Server Method      |
| ------ | ------------------ | ------------------------- | ------------------ |
| GET    | `/session`         | Get current session       | — (from JWT)       |
| POST   | `/session/refresh` | Refresh session token     | `refreshSession()` |
| GET    | `/session/list`    | List all active sessions  | `listSessions()`   |
| DELETE | `/session/:id`     | Revoke a specific session | `revokeSession()`  |

#### Password Routes

| Method | Route                     | Description                       | Server Method                  |
| ------ | ------------------------- | --------------------------------- | ------------------------------ |
| POST   | `/password/reset`         | Request password reset email      | `createPasswordResetToken()`   |
| POST   | `/password/reset/confirm` | Confirm password reset with token | `resetPassword()`              |
| PATCH  | `/password`               | Change password (while logged in) | `updateSignInMethodPassword()` |
| POST   | `/password/check`         | Check password strength           | `checkPasswordStrength()`      |

#### Email Routes

| Method | Route                   | Description                | Server Method                    |
| ------ | ----------------------- | -------------------------- | -------------------------------- |
| POST   | `/email/verify`         | Request email verification | `createEmailVerificationToken()` |
| GET    | `/email/verify/confirm` | Confirm email verification | `verifyEmail()`                  |
| GET    | `/email/check`          | Check email availability   | `checkEmailAvailability()`       |

#### User Routes

| Method | Route                      | Description             | Server Method          |
| ------ | -------------------------- | ----------------------- | ---------------------- |
| GET    | `/user`                    | Get current user        | `getUser()`            |
| PATCH  | `/user`                    | Update current user     | `updateUser()`         |
| GET    | `/user/signin-methods`     | List sign-in methods    | `listSignInMethods()`  |
| DELETE | `/user/signin-methods/:id` | Remove a sign-in method | `revokeSignInMethod()` |

#### Organization Routes

| Method | Route                    | Description                 | Server Method        |
| ------ | ------------------------ | --------------------------- | -------------------- |
| POST   | `/org/switch`            | Switch current organization | — (sets org cookie)  |
| POST   | `/org/invite`            | Invite user to organization | `createInvitation()` |
| POST   | `/org/invite/:id/accept` | Accept an invitation        | `acceptInvitation()` |

**Route Handler Interface:**

```typescript
interface AuthRouteContext {
	event: RequestEvent;
	config: AuthConfig;
	auth: AuthDatabaseServer;
	session: SessionToken<'auth'> | null;
	meta: UserSessionMeta;
}

type AuthRouteHandler = (ctx: AuthRouteContext) => Promise<Response>;
```

All route handlers return `AuthResponse<T>` JSON payloads. Error responses use the typed `AuthError` format.

### 5. Route Guards (`sveltekit/guards.ts`)

Helper functions for protecting routes in `+layout.server.ts` / `+page.server.ts` load functions.

```typescript
import { redirect } from '@sveltejs/kit';
import type { ServerLoadEvent } from '@sveltejs/kit';
import type { AuthLocals } from '../server/auth.handler';

interface GuardOptions {
	/** URL to redirect unauthenticated users to @default '/signin' */
	redirect_to?: string;
}

/**
 * Require an authenticated session. Redirects to sign-in if not authenticated.
 */
export function requireAuth<T>(
	loadFn: (event: ServerLoadEvent & { locals: AuthLocals }) => T | Promise<T>,
	options?: GuardOptions,
): (event: ServerLoadEvent) => Promise<T> {
	return async (event) => {
		if (!event.locals.session) {
			const target = options?.redirect_to ?? '/signin';
			const return_to = encodeURIComponent(event.url.pathname + event.url.search);
			throw redirect(302, `${target}?redirect=${return_to}`);
		}
		return loadFn(event as any);
	};
}

/**
 * Require a specific organization context.
 */
export function requireOrg<T>(
	loadFn: (
		event: ServerLoadEvent & { locals: AuthLocals & { org_id: string } },
	) => T | Promise<T>,
	options?: GuardOptions,
): (event: ServerLoadEvent) => Promise<T> {
	return async (event) => {
		if (!event.locals.session) {
			throw redirect(302, options?.redirect_to ?? '/signin');
		}
		if (!event.locals.org_id) {
			throw redirect(302, '/org/select');
		}
		return loadFn(event as any);
	};
}

/**
 * Require a specific permission within the current org.
 */
export function requirePermission<T>(
	permission: string,
	loadFn: (event: ServerLoadEvent & { locals: AuthLocals }) => T | Promise<T>,
	options?: GuardOptions & { forbidden_redirect?: string },
): (event: ServerLoadEvent) => Promise<T> {
	return async (event) => {
		if (!event.locals.session) {
			throw redirect(302, options?.redirect_to ?? '/signin');
		}
		const org_id = event.locals.org_id;
		if (!org_id) {
			throw redirect(302, '/org/select');
		}
		const org = event.locals.session.org[org_id];
		if (!org) {
			throw redirect(302, options?.forbidden_redirect ?? '/403');
		}
		// Check permission bit in org.role using the config's permission_map
		// (permission_map is available from the config passed to createAuthHandle)
		return loadFn(event as any);
	};
}
```

### 6. Client Auth Instance (`auth.client.ts`)

```typescript
import type { AuthResponse, AuthError } from '../types/error.type';

export interface AuthClientConfig {
	/** Base path for auth API @default '/api/auth' */
	base_path?: string;

	/** Fetch implementation (for custom fetch, e.g. from SvelteKit load) */
	fetch?: typeof fetch;
}

async function handleResponse<T>(res: Response): Promise<AuthResponse<T>> {
	const json = await res.json();
	if (!res.ok) {
		return { ok: false, error: json as AuthError };
	}
	return { ok: true, data: json as T };
}

export function createAuthClient(config: AuthClientConfig = {}) {
	const base_path = config.base_path || '/api/auth';
	const fetchFn = config.fetch || fetch;

	return {
		/**
		 * Sign in methods
		 */
		signIn: {
			email: async (data: { email: string; password: string }) => {
				const res = await fetchFn(`${base_path}/signin/email`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(data),
				});
				return handleResponse(res);
			},

			emailMagicLink: async (data: { email: string }) => {
				const res = await fetchFn(`${base_path}/signin/email/magic`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(data),
				});
				return handleResponse(res);
			},

			oauth: (vendor: string, options?: { redirect_to?: string }) => {
				const params = new URLSearchParams();
				if (options?.redirect_to) params.set('redirect', options.redirect_to);
				window.location.href = `${base_path}/signin/${vendor}?${params}`;
			},
		},

		/**
		 * Sign up methods
		 */
		signUp: {
			email: async (data: { name: string; email: string; password?: string }) => {
				const res = await fetchFn(`${base_path}/signup/email`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(data),
				});
				return handleResponse(res);
			},
		},

		/**
		 * Sign out the current user
		 */
		signOut: async () => {
			const res = await fetchFn(`${base_path}/signout`, { method: 'POST' });
			return handleResponse(res);
		},

		/**
		 * Session management
		 */
		session: {
			get: async () => {
				const res = await fetchFn(`${base_path}/session`);
				return handleResponse(res);
			},

			refresh: async () => {
				const res = await fetchFn(`${base_path}/session/refresh`, { method: 'POST' });
				return handleResponse(res);
			},

			list: async () => {
				const res = await fetchFn(`${base_path}/session/list`);
				return handleResponse(res);
			},

			revoke: async (session_id: string) => {
				const res = await fetchFn(`${base_path}/session/${session_id}`, {
					method: 'DELETE',
				});
				return handleResponse(res);
			},
		},

		/**
		 * Password management
		 */
		password: {
			reset: async (email: string) => {
				const res = await fetchFn(`${base_path}/password/reset`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ email }),
				});
				return handleResponse(res);
			},

			confirmReset: async (token: string, password: string) => {
				const res = await fetchFn(`${base_path}/password/reset/confirm`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ token, password }),
				});
				return handleResponse(res);
			},

			change: async (data: { current_password: string; new_password: string }) => {
				const res = await fetchFn(`${base_path}/password`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(data),
				});
				return handleResponse(res);
			},

			checkStrength: async (password: string) => {
				const res = await fetchFn(`${base_path}/password/check`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ password }),
				});
				return handleResponse(res);
			},
		},

		/**
		 * Email operations
		 */
		email: {
			requestVerification: async () => {
				const res = await fetchFn(`${base_path}/email/verify`, { method: 'POST' });
				return handleResponse(res);
			},

			checkAvailability: async (email: string) => {
				const params = new URLSearchParams({ email });
				const res = await fetchFn(`${base_path}/email/check?${params}`);
				return handleResponse<{ available: boolean }>(res);
			},
		},

		/**
		 * User management
		 */
		user: {
			get: async () => {
				const res = await fetchFn(`${base_path}/user`);
				return handleResponse(res);
			},

			update: async (data: { name?: string; image?: string }) => {
				const res = await fetchFn(`${base_path}/user`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(data),
				});
				return handleResponse(res);
			},

			listSignInMethods: async () => {
				const res = await fetchFn(`${base_path}/user/signin-methods`);
				return handleResponse(res);
			},

			removeSignInMethod: async (method_id: string) => {
				const res = await fetchFn(`${base_path}/user/signin-methods/${method_id}`, {
					method: 'DELETE',
				});
				return handleResponse(res);
			},
		},

		/**
		 * Organization operations
		 */
		org: {
			switch: async (org_id: string) => {
				const res = await fetchFn(`${base_path}/org/switch`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ org_id }),
				});
				return handleResponse(res);
			},

			invite: async (data: { org_id: string; email: string; permission: number }) => {
				const res = await fetchFn(`${base_path}/org/invite`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(data),
				});
				return handleResponse(res);
			},

			acceptInvite: async (invitation_id: string) => {
				const res = await fetchFn(`${base_path}/org/invite/${invitation_id}/accept`, {
					method: 'POST',
				});
				return handleResponse(res);
			},
		},

		/**
		 * Create a reactive auth state (Svelte 5 runes).
		 * See auth.state.svelte.ts for implementation.
		 */
		useSession: () => {
			// Returns reactive auth state object — see section 7
		},
	};
}
```

### 7. Reactive Auth State (`auth.state.svelte.ts`)

```typescript
import type { SessionToken } from '../types';

interface AuthSession {
	user: {
		id: string;
		name: string;
		email: string;
		verified: boolean;
	} | null;
	session: SessionToken<'auth'> | null;
	is_loading: boolean;
	is_authenticated: boolean;
	orgs: Array<{
		id: string;
		name: string;
		role: number;
	}>;
	current_org: {
		id: string;
		name: string;
		role: number;
	} | null;
}

/**
 * Create reactive auth state using Svelte 5 runes.
 * This should be called from a .svelte.ts file.
 *
 * Includes auto-refresh: sets up an interval that proactively refreshes
 * the session before the JWT expires, so long-lived pages stay authenticated.
 */
export function createAuthState(options: {
	initial_data?: Partial<AuthSession>;
	refresh_threshold_ms?: number; // @default 600_000 (10 minutes)
	base_path?: string;
}) {
	const base_path = options.base_path ?? '/api/auth';
	const refresh_threshold_ms = options.refresh_threshold_ms ?? 600_000;

	let session = $state<SessionToken<'auth'> | null>(
		options.initial_data?.session ?? null,
	);
	let is_loading = $state(false);
	let current_org_id = $state<string | null>(null);

	const user = $derived(
		session
			? {
					id: session.uid,
					name: session.name,
					email: session.email,
					verified: session.verified,
				}
			: null,
	);

	const is_authenticated = $derived(!!session);

	const orgs = $derived(
		session
			? Object.entries(session.org).map(([id, org]) => ({
					id,
					name: org.name,
					role: org.role,
				}))
			: [],
	);

	const current_org = $derived(() => {
		if (!session || !current_org_id) return null;
		const org = session.org[current_org_id];
		if (!org) return null;
		return { id: current_org_id, name: org.name, role: org.role };
	});

	// Auto-refresh: refresh session before JWT expires
	let refresh_timer: ReturnType<typeof setInterval> | null = null;

	function startAutoRefresh() {
		stopAutoRefresh();
		if (!session) return;

		const expires_at_ms = session.exp * 1000;
		const refresh_at_ms = expires_at_ms - refresh_threshold_ms;
		const delay = Math.max(refresh_at_ms - Date.now(), 0);

		refresh_timer = setTimeout(async () => {
			try {
				const res = await fetch(`${base_path}/session/refresh`, { method: 'POST' });
				if (res.ok) {
					const data = await res.json();
					session = data.session;
					startAutoRefresh(); // schedule next refresh
				}
			} catch {
				// silently fail — next navigation will handle expired session
			}
		}, delay);
	}

	function stopAutoRefresh() {
		if (refresh_timer) {
			clearTimeout(refresh_timer);
			refresh_timer = null;
		}
	}

	// Start auto-refresh if we have a session
	if (session) startAutoRefresh();

	return {
		get user() {
			return user;
		},
		get session() {
			return session;
		},
		get is_loading() {
			return is_loading;
		},
		get is_authenticated() {
			return is_authenticated;
		},
		get orgs() {
			return orgs;
		},
		get current_org() {
			return current_org;
		},

		setSession(new_session: SessionToken<'auth'> | null) {
			session = new_session;
			if (new_session) {
				startAutoRefresh();
			} else {
				stopAutoRefresh();
			}
		},

		setLoading(loading: boolean) {
			is_loading = loading;
		},

		setCurrentOrg(org_id: string | null) {
			current_org_id = org_id;
		},

		destroy() {
			stopAutoRefresh();
		},
	};
}
```

### 8. Svelte Components (Headless-First)

Components are headless by default — they expose state and actions via Svelte 5 snippets, and optionally render default UI using `@delightstack/components` primitives when no snippet is provided.

#### SignInForm.svelte

```svelte
<script lang="ts">
	import type { AuthResponse, AuthError } from '../types/error.type';
	import type { Snippet } from 'svelte';

	interface SignInState {
		email: string;
		password: string;
		is_loading: boolean;
		error: AuthError | null;
		magic_link_sent: boolean;
	}

	interface SignInActions {
		handleSubmit: () => Promise<void>;
		handleMagicLink: () => Promise<void>;
		handleOAuth: (vendor: string) => void;
		setEmail: (value: string) => void;
		setPassword: (value: string) => void;
	}

	interface Props {
		/** Base path for auth API @default '/api/auth' */
		base_path?: string;
		/** Redirect URL after sign-in */
		redirect_to?: string;
		/** Allow magic link sign-in */
		allow_magic_link?: boolean;
		/** OAuth providers to show */
		oauth_providers?: string[];
		/** Headless render snippet — receives state and actions */
		children?: Snippet<[SignInState & SignInActions]>;
		/** Callback on successful sign-in */
		onSuccess?: () => void;
		/** Callback on error */
		onError?: (error: AuthError) => void;
	}

	let {
		base_path = '/api/auth',
		redirect_to = '/dashboard',
		allow_magic_link = true,
		oauth_providers = [],
		children,
		onSuccess,
		onError,
	}: Props = $props();

	let email = $state('');
	let password = $state('');
	let is_loading = $state(false);
	let error = $state<AuthError | null>(null);
	let magic_link_sent = $state(false);

	// ... action implementations ...
</script>

{#if children}
	<!-- Headless mode: consumer provides all UI -->
	{@render children({
		email,
		password,
		is_loading,
		error,
		magic_link_sent,
		handleSubmit,
		handleMagicLink,
		handleOAuth,
		setEmail: (v) => (email = v),
		setPassword: (v) => (password = v),
	})}
{:else}
	<!-- Default UI using @delightstack/components -->
	<form onsubmit={handleSubmit}>
		<input type="email" bind:value={email} placeholder="Email" required />
		<input type="password" bind:value={password} placeholder="Password" />

		{#if error}
			<p class="error">{error.message}</p>
		{/if}

		<button type="submit" disabled={is_loading}>
			{is_loading ? 'Signing in...' : 'Sign In'}
		</button>

		{#if allow_magic_link}
			<button type="button" onclick={handleMagicLink} disabled={is_loading}>
				{magic_link_sent ? 'Check your email' : 'Sign in with Magic Link'}
			</button>
		{/if}

		{#each oauth_providers as provider}
			<button type="button" onclick={() => handleOAuth(provider)}>
				Continue with {provider}
			</button>
		{/each}
	</form>
{/if}
```

#### SignUpForm.svelte

```svelte
<script lang="ts">
	import type { AuthError } from '../types/error.type';
	import type { Snippet } from 'svelte';

	interface SignUpState {
		name: string;
		email: string;
		password: string;
		is_loading: boolean;
		error: AuthError | null;
	}

	interface SignUpActions {
		handleSubmit: () => Promise<void>;
		handleOAuth: (vendor: string) => void;
		setName: (value: string) => void;
		setEmail: (value: string) => void;
		setPassword: (value: string) => void;
	}

	interface Props {
		base_path?: string;
		redirect_to?: string;
		require_password?: boolean;
		oauth_providers?: string[];
		children?: Snippet<[SignUpState & SignUpActions]>;
		onSuccess?: () => void;
		onError?: (error: AuthError) => void;
	}

	let {
		base_path = '/api/auth',
		redirect_to = '/dashboard',
		require_password = false,
		oauth_providers = [],
		children,
		onSuccess,
		onError,
	}: Props = $props();

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let is_loading = $state(false);
	let error = $state<AuthError | null>(null);

	// ... action implementations ...
</script>

{#if children}
	{@render children({
		name,
		email,
		password,
		is_loading,
		error,
		handleSubmit,
		handleOAuth,
		setName: (v) => (name = v),
		setEmail: (v) => (email = v),
		setPassword: (v) => (password = v),
	})}
{:else}
	<form onsubmit={handleSubmit}>
		<input type="text" bind:value={name} placeholder="Name" required />
		<input type="email" bind:value={email} placeholder="Email" required />
		{#if require_password}
			<input type="password" bind:value={password} placeholder="Password" required />
		{/if}

		{#if error}
			<p class="error">{error.message}</p>
		{/if}

		<button type="submit" disabled={is_loading}>
			{is_loading ? 'Creating account...' : 'Create Account'}
		</button>

		{#each oauth_providers as provider}
			<button type="button" onclick={() => handleOAuth(provider)}>
				Continue with {provider}
			</button>
		{/each}
	</form>
{/if}
```

#### AuthGuard.svelte

```svelte
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { AuthSession } from '../auth.state.svelte';

	interface Props {
		/** The reactive auth state instance */
		auth: ReturnType<typeof import('../auth.state.svelte').createAuthState>;
		/** Required permission (checked against current org) */
		required_permission?: string;
		/** Content to show when authenticated */
		children: Snippet;
		/** Content to show when not authenticated */
		fallback?: Snippet;
		/** Content to show while loading */
		loading?: Snippet;
	}

	let { auth, required_permission, children, fallback, loading }: Props = $props();
</script>

{#if auth.is_loading}
	{#if loading}
		{@render loading()}
	{/if}
{:else if auth.is_authenticated}
	{@render children()}
{:else if fallback}
	{@render fallback()}
{/if}
```

---

## Usage Examples

### 1. Server Setup (`src/lib/auth.ts`)

```typescript
import { defineAuthConfig } from '@delightstack/auth/server';
import { PERMISSIONS, OAUTH_CAPABILITIES } from './constants';

export const authConfig = defineAuthConfig({
	secret: process.env.JWT_SECRET!,
	issuer: 'my-app',
	permission_map: PERMISSIONS,
	oauth_capability_map: OAUTH_CAPABILITIES,

	csrf: true,

	rate_limiting: {
		sign_in: { max_attempts: 5, window_seconds: 10 },
		sign_up: { max_attempts: 3, window_seconds: 60 },
	},

	oauth: {
		google: {
			client_id: process.env.GOOGLE_CLIENT_ID!,
			client_secret: process.env.GOOGLE_CLIENT_SECRET!,
			authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth',
			access_token_url: 'https://oauth2.googleapis.com/token',
			scopes: ['openid', 'email', 'profile'],
		},
	},

	email: {
		sendEmail: async ({ to, subject, html, text }) => {
			await resend.emails.send({ from: 'noreply@myapp.com', to, subject, html, text });
		},
	},

	hooks: {
		onSignUp: async ({ user }) => {
			await analytics.track('user_signed_up', { user_id: user.id });
		},
		onEmailVerified: async ({ user }) => {
			await sendWelcomeEmail(user.email);
		},
	},
});
```

### 2. Hooks Setup (`src/hooks.server.ts`)

```typescript
import { sequence } from '@sveltejs/kit/hooks';
import { createAuthHandle } from '@delightstack/auth/sveltekit';
import { authConfig } from '$lib/auth';
import { building } from '$app/environment';

const authHandle = createAuthHandle({
	config: authConfig,
	building,
	getAuthDO: (event) => {
		const id = event.platform!.env.AUTH.idFromName('main');
		return event.platform!.env.AUTH.get(id);
	},
});

// Composes cleanly with other handles
export const handle = sequence(authHandle, myOtherHandle);
```

### 3. Client Setup (`src/lib/auth.client.ts`)

```typescript
import { createAuthClient } from '@delightstack/auth/client';

export const authClient = createAuthClient();
```

### 4. Using in Components (Svelte 5 — no `$` prefix)

```svelte
<script lang="ts">
	import { authClient } from '$lib/auth.client';
	import { SignInForm } from '@delightstack/auth/client/components';

	const auth = authClient.useSession();
</script>

{#if auth.is_authenticated}
	<p>Welcome, {auth.user?.name}!</p>
	<button onclick={() => authClient.signOut()}>Sign Out</button>
{:else}
	<SignInForm
		oauth_providers={['google']}
		allow_magic_link={true}
		redirect_to="/dashboard" />
{/if}
```

### 5. Headless Sign-In (custom UI)

```svelte
<script lang="ts">
	import { SignInForm } from '@delightstack/auth/client/components';
	import { Input, Button } from '@delightstack/components';
</script>

<SignInForm oauth_providers={['google', 'github']} redirect_to="/app">
	{#snippet children(ctx)}
		<div class="my-custom-layout">
			<Input
				type="email"
				value={ctx.email}
				oninput={(e) => ctx.setEmail(e.currentTarget.value)}
				placeholder="Email address" />
			<Input
				type="password"
				value={ctx.password}
				oninput={(e) => ctx.setPassword(e.currentTarget.value)}
				placeholder="Password" />

			{#if ctx.error}
				<p class="text-red-500">{ctx.error.message}</p>
				{#if ctx.error.code === 'rate_limited'}
					<p>Try again in {ctx.error.retry_after}s</p>
				{/if}
			{/if}

			<Button onclick={ctx.handleSubmit} disabled={ctx.is_loading}>Sign In</Button>
		</div>
	{/snippet}
</SignInForm>
```

### 6. Protected Routes with Guards (`src/routes/dashboard/+layout.server.ts`)

```typescript
import { requireAuth } from '@delightstack/auth/sveltekit';

export const load = requireAuth(({ locals }) => {
	return {
		user: locals.user,
	};
});
```

### 7. Permission-Gated Routes (`src/routes/admin/+layout.server.ts`)

```typescript
import { requirePermission } from '@delightstack/auth/sveltekit';

export const load = requirePermission('org:admin', ({ locals }) => {
	return {
		user: locals.user,
	};
});
```

### 8. Type-safe Locals (`src/app.d.ts`)

```typescript
import type { AuthLocals } from '@delightstack/auth/sveltekit';

declare global {
	namespace App {
		interface Locals extends AuthLocals {}
	}
}
```

---

## Supported Sign-In Methods

Based on `AuthDatabaseServer`, the following methods are supported:

| Method           | Description                | Server Method                                         |
| ---------------- | -------------------------- | ----------------------------------------------------- |
| Email + Password | Traditional email/password | `signInWithEmail()`                                   |
| Magic Link       | Passwordless email link    | `createEmailSignInToken()` + `signInWithEmailToken()` |
| OAuth            | Google, GitHub, etc.       | `signInWithOauth()`                                   |
| Email Sign-up    | Create new account         | `signUpWithEmail()`                                   |

---

## Implementation Tasks

### Phase 1: Core Server Handler

- [ ] Create `types/error.type.ts` with `AuthError` and `AuthResponse` types
- [ ] Create `auth.config.ts` with configuration types and `defineAuthConfig()`
- [ ] Create `auth.handler.ts` with `createAuthHandle()` factory
- [ ] Create `auth.routes.ts` with all route handlers (auth, session, password, email, user, org)
- [ ] Implement CSRF origin checking in the handler
- [ ] Wire up configurable rate limiting
- [ ] Create `sveltekit/cookies.ts` for cookie utilities
- [ ] Create `sveltekit/guards.ts` with `requireAuth()`, `requireOrg()`, `requirePermission()`
- [ ] Add type definitions for `App.Locals`

### Phase 2: Client Library

- [ ] Create `auth.client.ts` with `createAuthClient()` returning typed `AuthResponse` values
- [ ] Create `auth.state.svelte.ts` with reactive state and auto-refresh timer
- [ ] Integrate `useSession()` with `createAuthState()`
- [ ] Add org switching via `org.switch()` + reactive `current_org`

### Phase 3: Components (Headless-First)

- [ ] Create `SignInForm.svelte` with snippet-based headless API + default UI fallback
- [ ] Create `SignUpForm.svelte` with snippet-based headless API + default UI fallback
- [ ] Create `OAuthButton.svelte`
- [ ] Create `AuthGuard.svelte`

### Phase 4: Documentation & Testing

- [ ] Update package exports (`package.json` exports map)
- [ ] Add JSDoc comments to all public APIs
- [ ] Create example app integration (migrate example-app to new API)
- [ ] Write tests for route handlers
- [ ] Write tests for guards
- [ ] Write tests for client error handling

---

## Migration Path

For existing apps using the manual integration:

1. **Install update**: Update `@delightstack/auth`
2. **Create config**: Add `src/lib/auth.ts` with `defineAuthConfig()`
3. **Update hooks**: Replace ~200 lines of manual JWT handling with `createAuthHandle()`
4. **Update types**: Extend `App.Locals` with `AuthLocals`
5. **Update routes**: Replace manual `/api/auth/*` routes (now handled automatically)
6. **Update load functions**: Use `requireAuth()` / `requirePermission()` guards (optional)
7. **Update components**: Replace custom forms with provided components (optional)

---

## Design Decisions (Resolved)

These were previously open questions. Decisions are documented here.

### 1. Session storage — No alternative stores needed

JWTs are stateless by design, and the Durable Object handles session revocation. Adding Redis/KV would mean supporting a second deployment topology with no clear user. If needed later, abstract behind an interface.

### 2. CSRF protection — Yes, built-in and on by default

The handler verifies `Origin`/`Referer` headers on all `POST`/`PATCH`/`DELETE` requests, matching the request host. This is what SvelteKit does for form actions. No tokens needed. Configurable via `csrf` in `AuthConfig`.

### 3. Rate limiting — Expose configuration

The existing rate limiter in `AuthDatabaseServer` stays as-is. The config exposes `rate_limiting` to tune thresholds per action type (sign-in, sign-up, magic link, password reset).

### 4. Lifecycle hooks — Config callbacks, not HTTP webhooks

Expanded beyond `onSignIn`/`onSignUp` to cover: `onSignOut`, `onPasswordReset`, `onEmailVerified`, `onOrgJoined`. These are config callbacks, not external HTTP webhooks — no infrastructure needed.

### 5. Multi-tenancy org switching — Client method + reactive state

`authClient.org.switch(org_id)` sets the org cookie server-side and returns the updated session. The reactive state exposes `current_org` (with full name/role, not just ID) as a derived value.

---

## References

- [Better Auth SvelteKit Integration](https://www.better-auth.com/docs/integrations/svelte-kit)
- [Auth.js SvelteKit](https://authjs.dev/reference/sveltekit)
- [Lucia Auth](https://lucia-auth.com/) (deprecated but influential)
- [SvelteKit Auth Docs](https://svelte.dev/docs/kit/auth)
