# Delightstack Auth — SvelteKit Integration Plan

## Overview

This document specifies the SvelteKit integration layer for `@delightstack/auth`. The package contains a complete `AuthDatabaseServer` Durable Object with 44+ methods. This integration provides:

- A single `createAuthHandle()` call in `hooks.server.ts` that handles JWT decode/refresh, populates `event.locals`, and routes all `/api/auth/*` requests
- A guard factory (`createAuthGuards`) for protecting routes with auth/org/permission checks
- A reactive `AuthClient` class (Svelte 5 runes) that holds both auth state and API methods, with SSR hydration and auto-refresh
- Headless-first Svelte components for sign-in, sign-up, OAuth, and conditional rendering

The goal is to replace the ~300 lines of manual boilerplate in `hooks.server.ts` and the ~80 scattered route files with a single handler factory and a typed client.

### Naming Conventions

- **camelCase** for all functions and methods (callable things): `createAuthHandle()`, `defineAuthConfig()`
- **snake_case** for all properties and fields (non-callable things): `base_path`, `client_id`, `session_name`
- Rationale: visual distinction between callable and non-callable; snake_case matches SQLite column names on the backend

## Current State

### What Exists

**Server-side (`packages/auth/server/`):**

- `auth.db.server.ts` — Complete `AuthDatabaseServer` Durable Object class with 44+ methods:
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
  - OAuth account linking (`connectOauthAccount`, `disconnectOauthAccount`, `listOauthAccounts`)
  - Third-party OAuth application support (for being an OAuth provider)
  - Private in-memory token-bucket rate limiter (hardcoded per action)
- `jwt.server.ts` — JWT generation (`generateJwt`) and verification (`decodeJwt`, `extractJwtRefreshToken`)
- `auth.sql.schema.ts` — SQLite schema definitions (15+ tables)
- `oauth.helper.ts` — OAuth token exchange utilities (`getOauthToken`)

**Types (`packages/auth/types/`):**

- `auth.type.ts` — SessionToken (discriminated union), permission encoding/decoding, Zod schemas
- `oauth.type.ts` — OAuth configurations, tokens, applications, capability encoding
- `meta.type.ts` — Common metadata types (Meta, MetaDate, MetaId)

**Utilities (`packages/utilities/`):**

- `error.helper.ts` — `ApiError` class, `apiError()` factory, `parseSchema()` for Zod validation

### Current Integration Pattern (Example App)

```typescript
// hooks.server.ts — ~300 lines of manual JWT/cookie/DO handling
export const handle: Handle = async ({ event, resolve }) => {
	// 1. Extract JWT from cookies/headers/query
	// 2. Decode and verify JWT manually
	// 3. Refresh expired tokens manually
	// 4. Resolve org ID from URL/headers/cookies
	// 5. Set up auth Durable Object connection
	// 6. Create AuthState instance
	// 7. Call resolve(event)
	// 8. Intercept 500 JSON responses and normalize errors
};
```

---

## Proposed Architecture

### File Structure

```
packages/auth/
├── index.ts                    # Re-exports types + client
├── types/
│   ├── index.ts               # Existing re-exports
│   ├── auth.type.ts           # Existing (SessionToken, schemas, permissions)
│   ├── oauth.type.ts          # Existing (OauthConfig, OauthToken, OauthApplication)
│   ├── meta.type.ts           # Existing (Meta, MetaDate, MetaId)
│   └── error.type.ts          # NEW: AuthErrorCode mapping + resolveErrorCode()
├── server/
│   ├── index.ts               # Server exports (existing + new)
│   ├── auth.db.server.ts      # Existing Durable Object
│   ├── auth.sql.schema.ts     # Existing schema
│   ├── jwt.server.ts          # Existing JWT utilities
│   ├── oauth.helper.ts        # Existing OAuth utilities
│   ├── auth.config.ts         # NEW: AuthConfig type + defineAuthConfig()
│   ├── auth.handler.ts        # NEW: createAuthHandle() factory
│   └── auth.routes.ts         # NEW: Route handler map + implementations
├── client/
│   ├── index.ts               # Client exports
│   ├── auth.client.svelte.ts  # NEW: AuthClient reactive class
│   └── components/
│       ├── SignInForm.svelte   # NEW: Headless-first sign-in
│       ├── SignUpForm.svelte   # NEW: Headless-first sign-up
│       ├── OAuthButton.svelte  # NEW: OAuth provider button
│       └── AuthGuard.svelte   # NEW: Conditional rendering
└── sveltekit/
    ├── index.ts               # SvelteKit-specific exports
    ├── cookies.ts             # NEW: Cookie handling utilities
    └── guards.ts              # NEW: createAuthGuards() factory
```

---

## Detailed Specifications

### 1. Typed Errors (`types/error.type.ts`)

Maps known `ApiError` detail/message strings from the DO to typed error codes. Does NOT introduce a new response wrapper — errors use the `ApiErrorData` shape (existing), successes use plain typed JSON.

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
 * Maps known ApiError detail/message strings to AuthErrorCode.
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
	'Password is too common': 'weak_password',
	'Password must be at least 8 characters': 'weak_password',
	'Invitation has been deleted or is expired': 'invitation_expired',
	'account has been deleted': 'user_deleted',
};

/** Resolves an AuthErrorCode from an ApiError's detail or message string */
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
```

### 2. Server Configuration (`server/auth.config.ts`)

```typescript
import type { UserPermissionMap, OauthCapabilityMap, UserSessionMeta } from '../types';
import type { AuthOperationResult } from './auth.db.server';

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

		onSignOut?: (ctx: { user_id: string; session_id: string }) => Promise<void>;

		onPasswordReset?: (ctx: { user_id: string; email: string }) => Promise<void>;
		onEmailVerified?: (ctx: { user_id: string; email: string }) => Promise<void>;
		onOrgJoined?: (ctx: { user_id: string; org_id: string }) => Promise<void>;
	};
}

export function defineAuthConfig<
	P extends UserPermissionMap,
	C extends OauthCapabilityMap,
>(config: AuthConfig<P, C>): AuthConfig<P, C> {
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
```

### 3. SvelteKit Handler Factory (`server/auth.handler.ts`)

```typescript
import type { Handle, RequestEvent } from '@sveltejs/kit';
import type { AuthConfig } from './auth.config';
import type { AuthDatabaseServer } from './auth.db.server';
import type { SessionToken, UserSessionMeta } from '../types';

/** Generic auth server type — the subset of AuthDatabaseServer used by the handler */
export type AuthServer = DurableObjectStub<
	Omit<
		AuthDatabaseServer,
		'alarm' | 'webSocketMessage' | 'webSocketClose' | 'webSocketError' | 'fetch' | 'Rpc'
	>
>;

export interface AuthHandleOptions<Config extends AuthConfig> {
	/** The auth configuration */
	config: Config;

	/**
	 * Get the auth server instance.
	 * Returns a DurableObjectStub or compatible RPC interface.
	 */
	getAuthServer: (event: RequestEvent) => AuthServer;

	/** Whether the app is building (static build step) @default false */
	building?: boolean;
}

export interface AuthLocals {
	/** The decoded session token (null if not authenticated) */
	session: SessionToken<'auth'> | null;

	/** The raw JWT string (null if not authenticated) */
	jwt: string | null;

	/** Convenience user accessor (null if not authenticated) */
	user: {
		id: string;
		name: string;
		email: string;
		verified: boolean;
		user_auth_id: string;
		user_session_id: string;
	} | null;

	/** The current organization ID */
	org_id: string | null;

	/** Current org info from the session token */
	org: {
		id: string;
		name: string;
		role: number;
		db?: string;
		plan?: number;
	} | null;

	/** User session metadata (IP, geo, user agent) */
	meta: UserSessionMeta;

	/** The auth server instance */
	auth: AuthServer;
}

/**
 * Creates a SvelteKit Handle function for authentication.
 * Composable with SvelteKit's sequence().
 *
 * Implementation steps:
 * 1. Skip during static builds (building === true)
 * 2. Parse UserSessionMeta from request (IP, CF geo headers, user agent)
 * 3. Extract JWT from: cookie > Authorization header > ?auth= query param
 * 4. Decode JWT with decodeJwt(). On 'auth/expired', refresh via auth.refreshSession()
 * 5. Set/clear session cookie based on JWT state
 * 6. Resolve org_id from: URL params > ?org= query > Org-ID header > cookie > auto-select
 * 7. Populate event.locals with AuthLocals (lazy auth getter for DO proxy in dev)
 * 8. Verify CSRF on POST/PATCH/DELETE (Origin/Referer check) if enabled
 * 9. If URL matches base_path + route, dispatch to auth.routes.ts and return Response
 * 10. Otherwise call resolve(event)
 * 11. Post-resolve: intercept 500 JSON responses and normalize via ApiError.from()
 */
export function createAuthHandle<Config extends AuthConfig>(
	options: AuthHandleOptions<Config>,
): Handle {
	return async ({ event, resolve }) => {
		// ...implementation...
	};
}
```

### 4. Auth Routes (`server/auth.routes.ts`)

All route handlers follow this interface:

```typescript
import { z } from 'zod/v4';
import { ApiError, parseSchema } from '@delightstack/utilities';
import type { AuthConfig } from './auth.config';
import type { AuthLocals, AuthServer } from './auth.handler';
import type { RequestEvent } from '@sveltejs/kit';
import { resolveErrorCode } from '../types/error.type';

interface AuthRouteContext {
	event: RequestEvent;
	config: AuthConfig;
	auth: AuthServer;
	locals: AuthLocals;
	meta: UserSessionMeta;
}

type AuthRouteHandler = (ctx: AuthRouteContext) => Promise<Response>;
```

**Error handling pattern** (used by all route handlers):

```typescript
async function handleRoute(
	ctx: AuthRouteContext,
	fn: () => Promise<Response>,
): Promise<Response> {
	try {
		return await fn();
	} catch (error) {
		const apiErr = ApiError.from(error);
		const code = resolveErrorCode({ detail: apiErr.detail, message: apiErr.messageText });
		return new Response(
			JSON.stringify({
				code,
				message: apiErr.messageText,
				status: apiErr.status,
				detail: apiErr.detail,
				errors: apiErr.errors.length ? apiErr.errors : undefined,
			}),
			{
				status: apiErr.status || 500,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	}
}
```

**Request body validation** — all routes that accept a body validate with Zod:

```typescript
// Using imported Zod schemas (EmailPasswordSignIn, EmailSignUp, etc.)
const body = parseSchema(EmailPasswordSignIn, await request.json());

// Or inline schemas for simple cases
const body = parseSchema(z.object({ email: z.email() }), await request.json());
```

**Hook dispatch** — after successful sign-in/sign-up operations:

```typescript
const is_new_user = result.type === 'signup';
if (is_new_user && config.hooks?.onSignUp) {
	await config.hooks.onSignUp({ result, method, meta });
}
if (config.hooks?.onSignIn) {
	await config.hooks.onSignIn({ result, method, is_new_user, meta });
}
```

#### Authentication Routes

| Method | Route                      | Body Validation              | DO Method                     | Success Response               |
| ------ | -------------------------- | ---------------------------- | ----------------------------- | ------------------------------ |
| POST   | `/signin/email`            | `EmailPasswordSignIn`        | `signInWithEmail()`           | `{ jwt, decoded_jwt, org_id }` |
| POST   | `/signin/email/magic`      | `z.object({ email })`        | `createEmailSignInToken()`    | `204 No Content`               |
| GET    | `/signin/email/verify`     | `?token=` query param        | `signInWithEmailToken()`      | `302 redirect`                 |
| POST   | `/signup/email`            | `EmailSignUp`                | `signUpWithEmail()`           | `{ jwt, decoded_jwt }`         |
| GET    | `/signin/:vendor`          | `?redirect=` optional        | — (build OAuth URL, redirect) | `302 redirect`                 |
| GET    | `/signin/:vendor/callback` | `?code=&state=` query params | `signInWithOauth()`           | `302 redirect`                 |
| POST   | `/signout`                 | —                            | `revokeSession(jti)`          | `204 No Content`               |

#### Session Routes

| Method | Route              | DO Method          | Success Response                           |
| ------ | ------------------ | ------------------ | ------------------------------------------ |
| GET    | `/session`         | — (from JWT)       | `{ session, user, org_id }`                |
| POST   | `/session/refresh` | `refreshSession()` | `{ jwt, decoded_jwt, org_id }`             |
| GET    | `/session/list`    | `listSessions()`   | `{ list: UserSession[], count, has_more }` |
| DELETE | `/session/:id`     | `revokeSession()`  | `204 No Content`                           |

#### Password Routes

| Method | Route                     | Body Validation                  | DO Method                      | Success Response       |
| ------ | ------------------------- | -------------------------------- | ------------------------------ | ---------------------- |
| POST   | `/password/reset`         | `z.object({ email: z.email() })` | `createPasswordResetToken()`   | `204 No Content`       |
| POST   | `/password/reset/confirm` | `z.object({ token, password })`  | `resetPassword()`              | `{ jwt, decoded_jwt }` |
| PATCH  | `/password`               | `z.object({ password })`         | `updateSignInMethodPassword()` | `{ jwt, decoded_jwt }` |
| POST   | `/password/check`         | `z.object({ password })`         | `checkPasswordStrength()`      | `{ strong: true }`     |

#### Email Routes

| Method | Route                   | DO Method                          | Success Response         |
| ------ | ----------------------- | ---------------------------------- | ------------------------ |
| POST   | `/email/verify`         | `createEmailVerficationToken()`    | `204 No Content`         |
| GET    | `/email/verify/confirm` | `verifyEmail()`                    | `302 redirect`           |
| GET    | `/email/check`          | `checkEmailAvailability()` (catch) | `{ available: boolean }` |

**Email availability note:** `checkEmailAvailability()` throws on failure. Route handler catches and returns `{ available: false }` for "already in use", re-throws rate limit or other errors:

```typescript
try {
	auth.checkEmailAvailability({ email, ip_address: meta.ip_address });
	return json({ available: true });
} catch (error) {
	const apiErr = ApiError.from(error);
	if (apiErr.messageText?.includes('already in use')) {
		return json({ available: false });
	}
	throw error;
}
```

#### User Routes

| Method | Route                      | Body Validation | DO Method              | Success Response            |
| ------ | -------------------------- | --------------- | ---------------------- | --------------------------- |
| GET    | `/user`                    | —               | `getUser()`            | `User`                      |
| PATCH  | `/user`                    | `UpdateUser`    | `updateUser()`         | `User`                      |
| DELETE | `/user`                    | —               | `markUserDeleted()`    | `204 No Content`            |
| GET    | `/user/signin-methods`     | —               | `listSignInMethods()`  | `{ list, count, has_more }` |
| DELETE | `/user/signin-methods/:id` | —               | `revokeSignInMethod()` | `204 No Content`            |

#### Organization Routes

| Method | Route                     | Body Validation                          | DO Method                 | Success Response               |
| ------ | ------------------------- | ---------------------------------------- | ------------------------- | ------------------------------ |
| POST   | `/org`                    | `z.object({ name: z.string() })`         | `createOrg()`             | `{ org_id, jwt, decoded_jwt }` |
| POST   | `/org/switch`             | `z.object({ org_id: z.string() })`       | — (set cookie, refresh)   | `{ jwt, decoded_jwt, org_id }` |
| PATCH  | `/org/:id`                | `z.object({ name, owner_id }).partial()` | `updateOrg()`             | `204 No Content`               |
| DELETE | `/org/:id`                | —                                        | `markOrgDeleted()`        | `204 No Content`               |
| GET    | `/org/:id/users`          | —                                        | `listOrgUsers()`          | `{ list, count, has_more }`    |
| PATCH  | `/org/:id/users/:user_id` | `z.object({ permission })`               | `updateUserPermission()`  | `204 No Content`               |
| DELETE | `/org/:id/users/:user_id` | —                                        | `updateUserPermission(0)` | `204 No Content`               |

#### Invitation Routes

| Method | Route                    | Body Validation                                                   | DO Method                | Success Response               |
| ------ | ------------------------ | ----------------------------------------------------------------- | ------------------------ | ------------------------------ |
| GET    | `/invitation`            | — (requires org_id)                                               | `listInvitations()`      | `{ list, count, has_more }`    |
| GET    | `/invitation/:id`        | —                                                                 | `getInvitationIfValid()` | invitation object              |
| POST   | `/invitation`            | `z.object({ email?, permission, max_redemptions?, expires_at? })` | `createInvitation()`     | invitation (201)               |
| PATCH  | `/invitation/:id`        | `z.object({ permission?, max_redemptions? })`                     | `updateInvitation()`     | invitation                     |
| DELETE | `/invitation/:id`        | —                                                                 | `deleteInvitation()`     | `204 No Content`               |
| POST   | `/invitation/:id/accept` | —                                                                 | `acceptInvitation()`     | `{ jwt, decoded_jwt, org_id }` |

#### OAuth Account Linking Routes

For users linking external OAuth accounts (e.g., Google Drive) to their existing account.

| Method | Route                     | DO Method                  | Success Response            |
| ------ | ------------------------- | -------------------------- | --------------------------- |
| GET    | `/oauth/:vendor`          | — (build OAuth URL)        | `302 redirect`              |
| GET    | `/oauth/:vendor/callback` | `connectOauthAccount()`    | `302 redirect`              |
| GET    | `/oauth/accounts`         | `listOauthAccounts()`      | `{ list, count, has_more }` |
| DELETE | `/oauth/accounts/:id`     | `disconnectOauthAccount()` | `204 No Content`            |

#### OAuth Application / Provider Routes

For apps that want to BE an OAuth provider (third-party app management, authorization codes, token exchange).

| Method | Route                                      | DO Method                                   | Success Response            |
| ------ | ------------------------------------------ | ------------------------------------------- | --------------------------- |
| GET    | `/oauth/application`                       | `listOauthApplications()`                   | `{ list, count, has_more }` |
| POST   | `/oauth/application`                       | `createOauthApplication()`                  | application (201)           |
| GET    | `/oauth/application/:id`                   | `getOauthApplication()`                     | application                 |
| PATCH  | `/oauth/application/:id`                   | `updateOauthApplication()`                  | application                 |
| DELETE | `/oauth/application/:id`                   | `deleteOauthApplication()`                  | `204 No Content`            |
| POST   | `/oauth/application/:id/secret`            | `createOauthApplicationSecret()`            | `{ secret, id }` (201)      |
| DELETE | `/oauth/application/:id/secret/:secret_id` | `deleteOauthApplicationSecret()`            | `204 No Content`            |
| POST   | `/oauth/application/:id/revoke`            | `revokeAuthorizedOauthApplication()`        | `204 No Content`            |
| GET    | `/oauth/authorize`                         | — (consent page data)                       | consent JSON                |
| POST   | `/oauth/authorize`                         | `createOauthApplicationAuthorizationCode()` | `{ code, redirect_url }`    |
| POST   | `/oauth/token`                             | `createOauthApplicationToken()`             | `{ access_token, ... }`     |

### 5. Route Guards (`sveltekit/guards.ts`)

Guards need access to `permission_map` for permission checking. Solution: a factory function.

```typescript
import { redirect } from '@sveltejs/kit';
import type { ServerLoadEvent } from '@sveltejs/kit';
import type { AuthLocals } from '../server/auth.handler';
import type { AuthConfig } from '../server/auth.config';
import { decodePermissions } from '../types';

interface GuardOptions {
	/** URL to redirect unauthenticated users to @default '/signin' */
	redirect_to?: string;
}

/**
 * Creates typed auth guard functions bound to your permission_map.
 */
export function createAuthGuards<Config extends AuthConfig>(config: Config) {
	type Permission = keyof Config['permission_map'] & string;

	function requireAuth<T>(
		loadFn: (event: ServerLoadEvent & { locals: AuthLocals }) => T | Promise<T>,
		options?: GuardOptions,
	): (event: ServerLoadEvent) => Promise<T> {
		return async (event) => {
			const locals = event.locals as AuthLocals;
			if (!locals.session) {
				const target = options?.redirect_to ?? '/signin';
				const return_to = encodeURIComponent(event.url.pathname + event.url.search);
				throw redirect(302, `${target}?redirect=${return_to}`);
			}
			return loadFn(event as ServerLoadEvent & { locals: AuthLocals });
		};
	}

	function requireOrg<T>(
		loadFn: (
			event: ServerLoadEvent & {
				locals: AuthLocals & { org_id: string; org: NonNullable<AuthLocals['org']> };
			},
		) => T | Promise<T>,
		options?: GuardOptions,
	): (event: ServerLoadEvent) => Promise<T> {
		return async (event) => {
			const locals = event.locals as AuthLocals;
			if (!locals.session) {
				throw redirect(302, options?.redirect_to ?? '/signin');
			}
			if (!locals.org_id || !locals.org) {
				throw redirect(302, '/org/select');
			}
			return loadFn(event as any);
		};
	}

	function requirePermission<T>(
		permission: Permission,
		loadFn: (event: ServerLoadEvent & { locals: AuthLocals }) => T | Promise<T>,
		options?: GuardOptions & { forbidden_redirect?: string },
	): (event: ServerLoadEvent) => Promise<T> {
		return async (event) => {
			const locals = event.locals as AuthLocals;
			if (!locals.session) {
				throw redirect(302, options?.redirect_to ?? '/signin');
			}
			if (!locals.org_id || !locals.org) {
				throw redirect(302, '/org/select');
			}
			const permissions = decodePermissions(config.permission_map, locals.org.role);
			if (!permissions.includes(permission)) {
				throw redirect(302, options?.forbidden_redirect ?? '/403');
			}
			return loadFn(event as ServerLoadEvent & { locals: AuthLocals });
		};
	}

	return { requireAuth, requireOrg, requirePermission };
}
```

### 6. AuthClient Class (`client/auth.client.svelte.ts`)

A single reactive class combining auth state AND API methods. Uses Svelte 5 `$state()` / `$derived()` runes. State properties are at the top level; all API operations are nested under `.api`.

```typescript
import type { SessionToken, UserSession, UserSignInMethod, OauthAccount } from '../types';
import { resolveErrorCode, type AuthErrorCode } from '../types/error.type';

/** Error shape returned by AuthClient API methods */
export interface AuthClientError {
	code: AuthErrorCode;
	message: string;
	status: number;
	detail?: string;
}

/** Typed result from API methods */
export type AuthResult<T> = { ok: true; data: T } | { ok: false; error: AuthClientError };

/** Serialized form for SSR hydration */
export interface AuthClientData {
	jwt: string | null;
	session: SessionToken<'auth'> | null;
	org_id: string | null;
}

export class AuthClient {
	// -- Reactive state (Svelte 5 class runes) --
	jwt = $state<string | null>(null);
	session = $state<SessionToken<'auth'> | null>(null);
	private _org_id = $state<string | null>(null);

	// -- Derived state properties (match existing AuthState API) --
	signed_in = $derived(!!this.session);
	signed_out = $derived(!this.session);

	id = $derived(this.session?.uid ?? null);
	name = $derived(this.session?.name ?? null);
	email = $derived(this.session?.email ?? null);
	verified = $derived(this.session?.verified ?? false);

	user_auth_id = $derived(this.session?.sub ?? null);
	user_session_id = $derived(this.session?.jti ?? null);

	org_id = $derived(this._org_id);
	org = $derived.by(() => {
		if (!this.session || !this._org_id) return null;
		const org = this.session.org[this._org_id];
		if (!org) return null;
		return {
			id: this._org_id,
			name: org.name,
			role: org.role,
			db: org.db,
			plan: org.plan,
		};
	});

	orgs = $derived.by(() => {
		if (!this.session) return [];
		return Object.entries(this.session.org).map(([id, o]) => ({
			id,
			name: o.name,
			role: o.role,
			db: o.db,
			plan: o.plan,
		}));
	});

	org_ids = $derived(this.orgs.map((o) => o.id));
	token = $derived(this.session);

	// -- Config --
	private base_path: string;
	private refresh_threshold_ms: number;
	private refresh_timer: ReturnType<typeof setTimeout> | null = null;
	private fetchFn: typeof fetch;

	constructor(
		data?: AuthClientData,
		options?: { base_path?: string; refresh_threshold_ms?: number; fetch?: typeof fetch },
	) {
		this.jwt = data?.jwt ?? null;
		this.session = data?.session ?? null;
		this._org_id = data?.org_id ?? null;
		this.base_path = options?.base_path ?? '/api/auth';
		this.refresh_threshold_ms = options?.refresh_threshold_ms ?? 600_000;
		this.fetchFn = options?.fetch ?? fetch;

		if (this.session) this.startAutoRefresh();
	}

	// -- Hydration --
	toJSON(): AuthClientData {
		return { jwt: this.jwt, session: this.session, org_id: this._org_id };
	}

	static from(data: AuthClientData, options?: { base_path?: string }): AuthClient {
		return new AuthClient(data, options);
	}

	// -- Permission checking --
	isAllowed(permission: string, permission_map?: Record<string, number>): boolean {
		if (!this.org || !permission_map) return false;
		const bit = permission_map[permission];
		if (bit === undefined) return false;
		return (this.org.role & (1 << bit)) !== 0;
	}

	// -- All API methods nested under .api --
	api = {
		signIn: {
			email: async (data: {
				email: string;
				password: string;
			}): Promise<
				AuthResult<{ jwt: string; decoded_jwt: SessionToken<'auth'>; org_id?: string }>
			> => {
				return this.post('/signin/email', data);
			},
			emailMagicLink: async (data: { email: string }): Promise<AuthResult<void>> => {
				const res = await this.fetchFn(`${this.base_path}/signin/email/magic`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(data),
				});
				if (!res.ok) return { ok: false, error: await this.parseError(res) };
				return { ok: true, data: undefined };
			},
			oauth: (vendor: string, options?: { redirect_to?: string }) => {
				const params = new URLSearchParams();
				if (options?.redirect_to) params.set('redirect', options.redirect_to);
				window.location.href = `${this.base_path}/signin/${vendor}?${params}`;
			},
		},

		signUp: {
			email: async (data: {
				name: string;
				email: string;
				password?: string;
				org_name?: string;
				invitation_id?: string;
			}): Promise<AuthResult<{ jwt: string; decoded_jwt: SessionToken<'auth'> }>> => {
				return this.post('/signup/email', data);
			},
		},

		signOut: async (): Promise<AuthResult<void>> => {
			const res = await this.fetchFn(`${this.base_path}/signout`, { method: 'POST' });
			if (!res.ok) return { ok: false, error: await this.parseError(res) };
			this.jwt = null;
			this.session = null;
			this._org_id = null;
			this.stopAutoRefresh();
			return { ok: true, data: undefined };
		},

		session: {
			get: async (): Promise<
				AuthResult<{
					session: SessionToken<'auth'>;
					user: { id: string; name: string; email: string; verified: boolean };
					org_id: string | null;
				}>
			> => {
				return this.get('/session');
			},
			refresh: async (): Promise<
				AuthResult<{ jwt: string; decoded_jwt: SessionToken<'auth'>; org_id?: string }>
			> => {
				const result = await this.post<{
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
					org_id?: string;
				}>('/session/refresh', undefined);
				if (result.ok) {
					this.jwt = result.data.jwt;
					this.session = result.data.decoded_jwt;
					if (result.data.org_id) this._org_id = result.data.org_id;
					this.startAutoRefresh();
				}
				return result;
			},
			list: async (): Promise<
				AuthResult<{ list: UserSession[]; count: number; has_more: boolean }>
			> => {
				return this.get('/session/list');
			},
			revoke: async (session_id: string): Promise<AuthResult<void>> => {
				return this.del(`/session/${session_id}`);
			},
		},

		password: {
			reset: async (email: string): Promise<AuthResult<void>> => {
				const res = await this.fetchFn(`${this.base_path}/password/reset`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ email }),
				});
				if (!res.ok) return { ok: false, error: await this.parseError(res) };
				return { ok: true, data: undefined };
			},
			confirmReset: async (
				token: string,
				password: string,
			): Promise<AuthResult<{ jwt: string; decoded_jwt: SessionToken<'auth'> }>> => {
				return this.post('/password/reset/confirm', { token, password });
			},
			change: async (
				password: string,
			): Promise<AuthResult<{ jwt: string; decoded_jwt: SessionToken<'auth'> }>> => {
				return this.patch('/password', { password });
			},
			checkStrength: async (
				password: string,
			): Promise<AuthResult<{ strong: boolean }>> => {
				return this.post('/password/check', { password });
			},
		},

		email: {
			requestVerification: async (): Promise<AuthResult<void>> => {
				const res = await this.fetchFn(`${this.base_path}/email/verify`, {
					method: 'POST',
				});
				if (!res.ok) return { ok: false, error: await this.parseError(res) };
				return { ok: true, data: undefined };
			},
			checkAvailability: async (
				email: string,
			): Promise<AuthResult<{ available: boolean }>> => {
				const params = new URLSearchParams({ email });
				return this.get(`/email/check?${params}`);
			},
		},

		user: {
			get: async (): Promise<
				AuthResult<{ id: string; name: string; image?: string; created_at: number }>
			> => {
				return this.get('/user');
			},
			update: async (data: {
				name?: string;
				image?: string;
			}): Promise<
				AuthResult<{ id: string; name: string; image?: string; created_at: number }>
			> => {
				return this.patch('/user', data);
			},
			delete: async (): Promise<AuthResult<void>> => {
				return this.del('/user');
			},
			listSignInMethods: async (): Promise<
				AuthResult<{ list: UserSignInMethod[]; count: number; has_more: boolean }>
			> => {
				return this.get('/user/signin-methods');
			},
			removeSignInMethod: async (method_id: string): Promise<AuthResult<void>> => {
				return this.del(`/user/signin-methods/${method_id}`);
			},
		},

		org: {
			create: async (data: {
				name: string;
			}): Promise<
				AuthResult<{ org_id: string; jwt: string; decoded_jwt: SessionToken<'auth'> }>
			> => {
				return this.post('/org', data);
			},
			switch: async (
				org_id: string,
			): Promise<
				AuthResult<{ jwt: string; decoded_jwt: SessionToken<'auth'>; org_id: string }>
			> => {
				const result = await this.post<{
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
					org_id: string;
				}>('/org/switch', { org_id });
				if (result.ok) {
					this.jwt = result.data.jwt;
					this.session = result.data.decoded_jwt;
					this._org_id = result.data.org_id;
				}
				return result;
			},
			update: async (
				org_id: string,
				data: { name?: string; owner_id?: string },
			): Promise<AuthResult<void>> => {
				return this.patch(`/org/${org_id}`, data);
			},
			delete: async (org_id: string): Promise<AuthResult<void>> => {
				return this.del(`/org/${org_id}`);
			},
			listUsers: async (
				org_id: string,
			): Promise<
				AuthResult<{
					list: Array<{ id: string; name: string; permission: number; image?: string }>;
					count: number;
					has_more: boolean;
				}>
			> => {
				return this.get(`/org/${org_id}/users`);
			},
			updateUserPermission: async (
				org_id: string,
				user_id: string,
				permission: number | string[],
			): Promise<AuthResult<void>> => {
				return this.patch(`/org/${org_id}/users/${user_id}`, { permission });
			},
			removeUser: async (org_id: string, user_id: string): Promise<AuthResult<void>> => {
				return this.del(`/org/${org_id}/users/${user_id}`);
			},
		},

		invitation: {
			list: async (): Promise<
				AuthResult<{ list: Array<object>; count: number; has_more: boolean }>
			> => {
				return this.get('/invitation');
			},
			get: async (id: string): Promise<AuthResult<object>> => {
				return this.get(`/invitation/${id}`);
			},
			create: async (data: {
				email?: string;
				permission: number;
				max_redemptions?: number;
				expires_at?: number;
			}): Promise<AuthResult<object>> => {
				return this.post('/invitation', data);
			},
			update: async (
				id: string,
				data: { permission?: number; max_redemptions?: number },
			): Promise<AuthResult<object>> => {
				return this.patch(`/invitation/${id}`, data);
			},
			delete: async (id: string): Promise<AuthResult<void>> => {
				return this.del(`/invitation/${id}`);
			},
			accept: async (
				id: string,
			): Promise<
				AuthResult<{ jwt: string; decoded_jwt: SessionToken<'auth'>; org_id: string }>
			> => {
				const result = await this.post<{
					jwt: string;
					decoded_jwt: SessionToken<'auth'>;
					org_id: string;
				}>(`/invitation/${id}/accept`, undefined);
				if (result.ok) {
					this.jwt = result.data.jwt;
					this.session = result.data.decoded_jwt;
					this._org_id = result.data.org_id;
				}
				return result;
			},
		},

		oauth: {
			connect: (
				vendor: string,
				options?: { redirect_to?: string; capabilities?: string[] },
			) => {
				const params = new URLSearchParams();
				if (options?.redirect_to) params.set('redirect', options.redirect_to);
				if (options?.capabilities)
					params.set('capabilities', options.capabilities.join(','));
				window.location.href = `${this.base_path}/oauth/${vendor}?${params}`;
			},
			listAccounts: async (): Promise<
				AuthResult<{ list: OauthAccount[]; count: number; has_more: boolean }>
			> => {
				return this.get('/oauth/accounts');
			},
			disconnectAccount: async (id: string): Promise<AuthResult<void>> => {
				return this.del(`/oauth/accounts/${id}`);
			},
		},
	};

	// -- Auto-refresh --
	private startAutoRefresh() {
		this.stopAutoRefresh();
		if (!this.session) return;
		const expires_at_ms = this.session.exp * 1000;
		const refresh_at_ms = expires_at_ms - this.refresh_threshold_ms;
		const delay = Math.max(refresh_at_ms - Date.now(), 0);
		this.refresh_timer = setTimeout(async () => {
			const result = await this.api.session.refresh();
			if (result.ok) this.startAutoRefresh();
		}, delay);
	}

	private stopAutoRefresh() {
		if (this.refresh_timer) {
			clearTimeout(this.refresh_timer);
			this.refresh_timer = null;
		}
	}

	destroy() {
		this.stopAutoRefresh();
	}

	// -- Internal fetch helpers --
	private async post<T>(path: string, body: unknown): Promise<AuthResult<T>> {
		const res = await this.fetchFn(`${this.base_path}${path}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});
		return this.handleResponse<T>(res);
	}

	private async get<T>(path: string): Promise<AuthResult<T>> {
		const res = await this.fetchFn(`${this.base_path}${path}`);
		return this.handleResponse<T>(res);
	}

	private async patch<T>(path: string, body: unknown): Promise<AuthResult<T>> {
		const res = await this.fetchFn(`${this.base_path}${path}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		return this.handleResponse<T>(res);
	}

	private async del<T = void>(path: string): Promise<AuthResult<T>> {
		const res = await this.fetchFn(`${this.base_path}${path}`, { method: 'DELETE' });
		return this.handleResponse<T>(res);
	}

	private async handleResponse<T>(res: Response): Promise<AuthResult<T>> {
		if (res.status === 204) return { ok: true, data: undefined as T };
		if (!res.ok) return { ok: false, error: await this.parseError(res) };
		return { ok: true, data: (await res.json()) as T };
	}

	private async parseError(res: Response): Promise<AuthClientError> {
		try {
			const body = await res.json();
			return {
				code:
					body.code ?? resolveErrorCode({ detail: body.detail, message: body.message }),
				message: body.message ?? 'Unknown error',
				status: body.status ?? res.status,
				detail: body.detail,
			};
		} catch {
			return { code: 'unknown', message: res.statusText, status: res.status };
		}
	}
}
```

### 7. Svelte Components (Headless-First)

Components are headless by default — they expose state and actions via Svelte 5 snippets, and optionally render default UI when no snippet is provided.

#### SignInForm.svelte

```svelte
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { AuthClientError, AuthClient } from '../auth.client.svelte';

	interface SignInState {
		email: string;
		password: string;
		is_loading: boolean;
		error: AuthClientError | null;
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
		/** The AuthClient instance */
		auth: AuthClient;
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
		onError?: (error: AuthClientError) => void;
	}

	let {
		auth,
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
	let error = $state<AuthClientError | null>(null);
	let magic_link_sent = $state(false);

	async function handleSubmit() {
		is_loading = true;
		error = null;
		const result = await auth.api.signIn.email({ email, password });
		is_loading = false;
		if (result.ok) {
			onSuccess?.();
			window.location.href = redirect_to;
		} else {
			error = result.error;
			onError?.(result.error);
		}
	}

	async function handleMagicLink() {
		is_loading = true;
		error = null;
		const result = await auth.api.signIn.emailMagicLink({ email });
		is_loading = false;
		if (result.ok) {
			magic_link_sent = true;
		} else {
			error = result.error;
			onError?.(result.error);
		}
	}

	function handleOAuth(vendor: string) {
		auth.api.signIn.oauth(vendor, { redirect_to });
	}
</script>

{#if children}
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

Same headless pattern. Calls `auth.api.signUp.email()`.

#### AuthGuard.svelte

```svelte
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { AuthClient } from '../auth.client.svelte';

	interface Props {
		auth: AuthClient;
		children: Snippet;
		fallback?: Snippet;
		loading?: Snippet;
	}

	let { auth, children, fallback, loading }: Props = $props();
</script>

{#if auth.signed_in}
	{@render children()}
{:else if fallback}
	{@render fallback()}
{/if}
```

---

## Usage Examples

### 1. Server Config (`src/lib/server/auth.config.ts`)

```typescript
import { defineAuthConfig } from '@delightstack/auth/server';
import { dev } from '$app/environment';

export const PERMISSIONS = {
	'org:read': 0,
	'org:write': 1,
	'org:admin': 2,
	'profile:read': 3,
	'profile:write': 4,
} as const;

export const OAUTH_CAPABILITIES = {
	profile: 0,
	email: 1,
} as const;

export const authConfig = defineAuthConfig({
	secret: '', // Set at runtime from platform.env
	issuer: 'my-app',
	permission_map: PERMISSIONS,
	oauth_capability_map: OAUTH_CAPABILITIES,
	dev,

	oauth: {
		google: {
			client_id: '', // Set at runtime from platform.env
			client_secret: '', // Set at runtime from platform.env
			authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth',
			access_token_url: 'https://oauth2.googleapis.com/token',
			scopes: ['openid', 'email', 'profile'],
		},
	},

	email: {
		sendEmail: async ({ to, subject, html, text }) => {
			// Implement with your email provider (Resend, SES, etc.)
		},
	},

	hooks: {
		onSignUp: async ({ result, method }) => {
			// Analytics, welcome email, provisioning, etc.
		},
	},
});
```

### 2. Hooks Setup (`src/hooks.server.ts`)

```typescript
import { sequence } from '@sveltejs/kit/hooks';
import { createAuthHandle } from '@delightstack/auth/server';
import { authConfig } from '$lib/server/auth.config';
import { building, dev } from '$app/environment';

const authHandle = createAuthHandle({
	config: authConfig,
	building,
	getAuthServer: (event) => {
		const env = event.platform!.env;
		const id = env.AUTH.idFromName('main');
		return env.AUTH.get(id);
	},
});

export const handle = sequence(authHandle, myOtherHandle);
```

### 3. Guards Setup (`src/lib/server/guards.ts`)

```typescript
import { createAuthGuards } from '@delightstack/auth/sveltekit';
import { authConfig } from './auth.config';

export const { requireAuth, requireOrg, requirePermission } =
	createAuthGuards(authConfig);
```

### 4. Auth State Hydration

**`src/routes/+layout.server.ts`:**

```typescript
import type { AuthLocals } from '@delightstack/auth/server';

export async function load({ locals }) {
	const authLocals = locals as AuthLocals;
	return {
		auth: {
			jwt: authLocals.jwt,
			session: authLocals.session,
			org_id: authLocals.org_id,
		},
	};
}
```

**`src/routes/+layout.ts`:**

```typescript
import { AuthClient } from '@delightstack/auth/client';

export async function load({ data }) {
	const auth = new AuthClient(data.auth);
	return { auth };
}
```

### 5. Type-safe Locals (`src/app.d.ts`)

```typescript
import type { AuthLocals } from '@delightstack/auth/server';

declare global {
	namespace App {
		interface Locals extends AuthLocals {}
	}
}
```

### 6. Client Usage in Components

```svelte
<script lang="ts">
	let { data } = $props();
	const auth = data.auth;
</script>

{#if auth.signed_in}
	<p>Welcome, {auth.name}!</p>

	{#if auth.org}
		<p>Current org: {auth.org.name}</p>
	{/if}

	{#each auth.orgs as org}
		<button onclick={() => auth.api.org.switch(org.id)}>
			{org.name}
		</button>
	{/each}

	<button onclick={() => auth.api.signOut()}>Sign Out</button>
{:else}
	<a href="/signin">Sign In</a>
{/if}
```

### 7. Headless Sign-In (Custom UI)

```svelte
<script lang="ts">
	import { SignInForm } from '@delightstack/auth/client/components';
	import { Input, Button } from '@delightstack/components';

	let { data } = $props();
</script>

<SignInForm auth={data.auth} oauth_providers={['google']} redirect_to="/dashboard">
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
					<p>Please try again later</p>
				{/if}
			{/if}

			<Button onclick={ctx.handleSubmit} disabled={ctx.is_loading}>
				{ctx.is_loading ? 'Signing in...' : 'Sign In'}
			</Button>
		</div>
	{/snippet}
</SignInForm>
```

### 8. Protected Routes with Guards

```typescript
// src/routes/dashboard/+layout.server.ts
import { requireAuth } from '$lib/server/guards';

export const load = requireAuth(({ locals }) => {
	return { user: locals.user };
});
```

```typescript
// src/routes/admin/+layout.server.ts
import { requirePermission } from '$lib/server/guards';

export const load = requirePermission('org:admin', ({ locals }) => {
	return { user: locals.user };
});
```

---

## Supported Sign-In Methods

| Method           | Description                | Server Method                                         |
| ---------------- | -------------------------- | ----------------------------------------------------- |
| Email + Password | Traditional email/password | `signInWithEmail()`                                   |
| Magic Link       | Passwordless email link    | `createEmailSignInToken()` + `signInWithEmailToken()` |
| OAuth            | Google, GitHub, etc.       | `signInWithOauth()`                                   |
| Email Sign-up    | Create new account         | `signUpWithEmail()`                                   |

---

## Implementation Tasks

### Phase 1: Core Server Handler

- [x] Create `types/error.type.ts` with `AuthErrorCode`, `AUTH_ERROR_MAP`, `resolveErrorCode()`
- [x] Create `server/auth.config.ts` with `AuthConfig` types and `defineAuthConfig()`
- [x] Create `sveltekit/cookies.ts` for cookie read/write/delete utilities
- [x] Create `server/auth.handler.ts` with `createAuthHandle()`:
  - JWT extraction (cookie > Authorization header > ?auth= query)
  - JWT decode/verify + auto-refresh on `auth/expired`
  - Meta extraction (IP, CF geo headers, user agent)
  - Org ID resolution (URL params > headers > cookies > auto-select)
  - CSRF check (Origin/Referer on POST/PATCH/DELETE)
  - AuthLocals population (lazy DO getter for dev proxy)
  - Route dispatch to `auth.routes.ts`
  - Post-resolve 500 normalization via `ApiError.from()`
- [x] Create `server/auth.routes.ts` with all route handlers:
  - Authentication (signin/email, signin/email/magic, signin/email/verify, signup/email, signin/:vendor, signin/:vendor/callback, signout)
  - Session (get, refresh, list, revoke)
  - Password (reset, reset/confirm, change, check)
  - Email (verify, verify/confirm, check)
  - User (get, update, delete, signin-methods)
  - Organization (create, switch, update, delete, users, permissions)
  - Invitation (list, get, create, update, delete, accept)
  - OAuth account linking (connect, callback, list, disconnect)
  - OAuth application (CRUD, secrets, authorize, token)
- [x] Add type definitions for `App.Locals` via `AuthLocals`

### Phase 2: Guards

- [x] Create `sveltekit/guards.ts` with `createAuthGuards()` factory
- [x] Create `sveltekit/index.ts` exporting guards + cookies

### Phase 3: Client Library

- [x] Create `client/auth.client.svelte.ts` with `AuthClient` class:
  - Reactive state (`$state`, `$derived`, `$derived.by`)
  - `.api` namespace with all method groups
  - Auto-refresh timer
  - `toJSON()` / `static from()` hydration
  - `isAllowed()` permission check
  - `destroy()` cleanup
- [x] Create `client/index.ts` exporting `AuthClient`

### Phase 4: Components (Headless-First)

- [x] Create `client/components/SignInForm.svelte`
- [x] Create `client/components/SignUpForm.svelte`
- [x] Create `client/components/OAuthButton.svelte`
- [x] Create `client/components/AuthGuard.svelte`

### Phase 5: Packaging & Testing

- [x] Update `package.json` exports map (`@delightstack/auth/server`, `/client`, `/client/components`, `/sveltekit`)
- [x] Add JSDoc comments to all public APIs
- [x] Migrate example-app to new API
- [x] Write tests for route handlers
- [x] Write tests for guards
- [x] Write tests for client error handling

---

## Migration Path

1. **Update package**: Update `@delightstack/auth`
2. **Create server config**: `src/lib/server/auth.config.ts` with `defineAuthConfig()`
3. **Create guards**: `src/lib/server/guards.ts` with `createAuthGuards(authConfig)`
4. **Replace hooks.server.ts**: Replace ~300 lines of manual JWT/cookie/DO handling with `createAuthHandle()`
5. **Update app.d.ts**: `interface Locals extends AuthLocals {}`
6. **Remove manual route files**: Delete all `(auth)/signin/`, `(auth)/signup/`, `(auth)/signout/`, `(auth)/account/session/`, `(auth)/account/reset-password/`, etc. — now handled by the handler
7. **Update layout hydration**:
   - `+layout.server.ts`: return `{ auth: { jwt, session, org_id } }`
   - `+layout.ts`: `const auth = new AuthClient(data.auth)`
8. **Replace AuthState usage**: `authState.signed_in` → `auth.signed_in`, `authState.orgID` → `auth.org_id`, etc.
9. **Update protected routes**: Replace manual `if (!locals.authState.id)` with `requireAuth()` / `requirePermission()`
10. **Update client API calls**: Replace manual `fetch('/signin')` with `auth.api.signIn.email()`
11. **Update components**: Replace custom forms with `SignInForm` / `SignUpForm` (optional)

---

## Design Decisions (Resolved)

### 1. Session storage — JWT only, no additional stores

JWTs are stateless by design. The Durable Object handles session revocation via its SQLite database. No Redis/KV needed.

### 2. CSRF protection — Origin/Referer check, on by default

The handler verifies `Origin`/`Referer` headers on all `POST`/`PATCH`/`DELETE` requests, matching the request host. Same approach as SvelteKit form actions. No CSRF tokens needed.

### 3. Rate limiting — DO-internal, not configurable

The `AuthDatabaseServer` has a private in-memory token-bucket rate limiter with hardcoded thresholds per action (signin 5/10s, signup 3/10s, magic link 3/60s, password reset 2/60s, email check 10/10s). These are sensible defaults and cannot be tuned externally. If tuning is needed, it must be done in the DO itself.

### 4. Error handling — ApiError throughout, no new wrapper

The DO throws `ApiError`. Route handlers catch with try/catch, normalize via `ApiError.from()`, attach an `AuthErrorCode` where possible via `resolveErrorCode()`. Success responses are plain typed JSON. The HTTP status code indicates success/failure. The client's `AuthResult<T>` provides a typed wrapper for ergonomic consumption.

### 5. AuthClient — Single reactive class, not split functions

Combining `createAuthState()` and `createAuthClient()` into a single `AuthClient` class solves the runes-in-.ts-file issue and provides a clean API. State properties at the top level, API methods nested under `.api`.

### 6. `is_new_user` derivation — From `AuthOperationResult.type`

`AuthOperationResult.type === 'signup'` reliably indicates a new user for both email and OAuth sign-ups. This is the source of truth for lifecycle hooks.

### 7. Guard factory pattern

`createAuthGuards(config)` is called once with the config and returns bound guard functions with access to `permission_map`. Keeps route files clean.

### 8. Cookie `secure` default — From `$app/environment`

Uses `!dev` from `$app/environment` passed via `config.dev`. In dev mode, cookies are not secure (HTTP works). In production, cookies are secure (HTTPS only). `httpOnly: true` is always the default.

### 9. Lifecycle hooks — Config callbacks, not HTTP webhooks

Hooks run in-process after auth operations: `onSignIn`, `onSignUp`, `onSignOut`, `onPasswordReset`, `onEmailVerified`, `onOrgJoined`. These are config callbacks, not external webhooks.

---

## References

- [Better Auth SvelteKit Integration](https://www.better-auth.com/docs/integrations/svelte-kit)
- [Auth.js SvelteKit](https://authjs.dev/reference/sveltekit)
- [Lucia Auth](https://lucia-auth.com/) (deprecated but influential)
- [SvelteKit Auth Docs](https://svelte.dev/docs/kit/auth)
