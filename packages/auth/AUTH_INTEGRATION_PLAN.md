# Delightstack Auth - SvelteKit Integration Plan

## Overview

This document outlines the plan to create a streamlined SvelteKit authentication integration for `@delightstack/auth`, inspired by [better-auth's SvelteKit integration](https://www.better-auth.com/docs/integrations/svelte-kit). The goal is to enable developers to add authentication to their SvelteKit apps by calling a single handler function in their server hooks.

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
  - Email verification (`createEmailVerficationToken`, `verifyEmail`)
  - User/org management
  - Third-party OAuth application support (for being an OAuth provider)
- `jwt.server.ts` - JWT generation and verification utilities
- `auth.sql.schema.ts` - SQLite schema definitions
- `oauth.helper.ts` - OAuth token exchange utilities

**Types (`packages/auth/types/`):**
- `auth.type.ts` - Session tokens, permissions, sign-in schemas
- `oauth.type.ts` - OAuth configurations, tokens, applications
- `meta.type.ts` - Common metadata types

**Client-side:**
- `SignInForm.svelte` (deleted) - Was a Svelte 5 component for sign-in/sign-up
- `AuthState` class exists in example-app but not in the auth package

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
2. **Automatic route handling** for `/api/auth/*` endpoints
3. **Reactive client** with Svelte 5 runes
4. **Type-safe** throughout
5. **Cloudflare-compatible** (Durable Objects, Workers)
6. **Configurable** with sensible defaults

### File Structure

```
packages/auth/
├── index.ts                    # Main exports
├── types/                      # Existing types
├── server/
│   ├── index.ts               # Server exports
│   ├── auth.db.server.ts      # Existing Durable Object
│   ├── auth.sql.schema.ts     # Existing schema
│   ├── jwt.server.ts          # Existing JWT utilities
│   ├── oauth.helper.ts        # Existing OAuth utilities
│   ├── auth.handler.ts        # NEW: SvelteKit handler
│   ├── auth.config.ts         # NEW: Configuration types
│   └── auth.routes.ts         # NEW: Route handlers
├── client/
│   ├── index.ts               # Client exports
│   ├── auth.client.ts         # NEW: Client auth instance
│   ├── auth.state.svelte.ts   # NEW: Reactive auth state
│   └── components/
│       ├── SignInForm.svelte  # NEW: Sign-in component
│       ├── SignUpForm.svelte  # NEW: Sign-up component
│       └── OAuthButton.svelte # NEW: OAuth provider button
└── sveltekit/
    ├── index.ts               # SvelteKit-specific exports
    └── cookies.ts             # Cookie handling utilities
```

---

## Detailed Specifications

### 1. Server Configuration (`auth.config.ts`)

```typescript
import type { UserPermissionMap, OauthCapabilityMap } from '../types';

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
  permissionMap: PermissionMap;

  /**
   * OAuth capability map for bitwise encoding
   */
  oauthCapabilityMap: CapabilityMap;

  /**
   * Cookie configuration
   */
  cookies?: {
    /** Session cookie name @default 'auth-session' */
    sessionName?: string;
    /** Org cookie name @default 'auth-org' */
    orgName?: string;
    /** Cookie path @default '/' */
    path?: string;
    /** Secure cookies (HTTPS only) @default true in production */
    secure?: boolean;
    /** SameSite policy @default 'lax' */
    sameSite?: 'strict' | 'lax' | 'none';
  };

  /**
   * Session configuration
   */
  session?: {
    /** Session duration in seconds @default 3600 (1 hour) */
    expiresIn?: number;
    /** Refresh threshold in seconds @default 600 (10 minutes) */
    refreshThreshold?: number;
  };

  /**
   * OAuth providers configuration
   */
  oauth?: {
    [vendor: string]: {
      clientId: string;
      clientSecret: string;
      authorizationUrl: string;
      accessTokenUrl: string;
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
      type: 'magic-link' | 'verification' | 'password-reset';
    }) => Promise<void>;
    /** Base URL for email links @default derived from request origin */
    baseUrl?: string;
  };

  /**
   * Base path for auth API routes @default '/api/auth'
   */
  basePath?: string;

  /**
   * Callback when user signs in (for custom logic)
   */
  onSignIn?: (user: { id: string; email: string; name?: string }) => Promise<void>;

  /**
   * Callback when user signs up (for custom logic)
   */
  onSignUp?: (user: { id: string; email: string; name?: string }) => Promise<void>;
}

export function defineAuthConfig<
  P extends UserPermissionMap,
  C extends OauthCapabilityMap,
>(config: AuthConfig<P, C>): AuthConfig<P, C> {
  return {
    basePath: '/api/auth',
    cookies: {
      sessionName: 'auth-session',
      orgName: 'auth-org',
      path: '/',
      sameSite: 'lax',
      ...config.cookies,
    },
    session: {
      expiresIn: 3600,
      refreshThreshold: 600,
      ...config.session,
    },
    ...config,
  };
}
```

### 2. SvelteKit Handler (`auth.handler.ts`)

```typescript
import type { Handle, RequestEvent } from '@sveltejs/kit';
import type { AuthConfig } from './auth.config';
import type { AuthDatabaseServer } from './auth.db.server';
import type { SessionToken, UserSessionMeta } from '../types';

export interface SvelteKitHandlerOptions<Config extends AuthConfig> {
  /** The auth configuration */
  config: Config;

  /** SvelteKit event */
  event: RequestEvent;

  /** SvelteKit resolve function */
  resolve: Parameters<Handle>[0]['resolve'];

  /** Get the auth Durable Object instance */
  getAuthDO: () => AuthDatabaseServer;

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
  orgId: string | null;

  /** User session metadata */
  meta: UserSessionMeta;

  /** The auth database instance */
  auth: AuthDatabaseServer;
}

export async function svelteKitHandler<Config extends AuthConfig>(
  options: SvelteKitHandlerOptions<Config>
): Promise<Response> {
  // Implementation will:
  // 1. Skip during static builds
  // 2. Extract JWT from cookies/headers/query
  // 3. Decode and validate JWT
  // 4. Auto-refresh expired tokens
  // 5. Populate event.locals with auth data
  // 6. Handle /api/auth/* routes if matched
  // 7. Call resolve() for non-auth routes
}
```

### 3. Auth Routes (`auth.routes.ts`)

The handler will automatically handle these routes under the configured `basePath`:

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/signin/email` | Email + password sign-in |
| POST | `/signin/email/magic` | Request magic link |
| GET | `/signin/email/verify` | Verify magic link token |
| POST | `/signup/email` | Email sign-up |
| GET | `/signin/:vendor` | Initiate OAuth flow |
| GET | `/signin/:vendor/callback` | OAuth callback |
| POST | `/signout` | Sign out (revoke session) |
| POST | `/session/refresh` | Refresh session token |
| GET | `/session` | Get current session |
| POST | `/password/reset` | Request password reset |
| POST | `/password/reset/confirm` | Confirm password reset |
| POST | `/email/verify` | Request email verification |
| GET | `/email/verify/confirm` | Confirm email verification |
| GET | `/user` | Get current user |
| PATCH | `/user` | Update current user |

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

### 4. Client Auth Instance (`auth.client.ts`)

```typescript
import type { AuthConfig } from '../server/auth.config';

export interface AuthClientConfig {
  /** Base path for auth API @default '/api/auth' */
  basePath?: string;

  /** Fetch implementation (for custom fetch) */
  fetch?: typeof fetch;
}

export function createAuthClient(config: AuthClientConfig = {}) {
  const basePath = config.basePath || '/api/auth';
  const fetchFn = config.fetch || fetch;

  return {
    /**
     * Sign in with email and password
     */
    signIn: {
      email: async (data: { email: string; password: string }) => {
        const res = await fetchFn(`${basePath}/signin/email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        return handleResponse(res);
      },

      /**
       * Request magic link email
       */
      emailMagicLink: async (data: { email: string }) => {
        const res = await fetchFn(`${basePath}/signin/email/magic`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        return handleResponse(res);
      },

      /**
       * Initiate OAuth sign-in (redirects to provider)
       */
      oauth: (vendor: string, options?: { redirectTo?: string }) => {
        const params = new URLSearchParams();
        if (options?.redirectTo) params.set('redirect', options.redirectTo);
        window.location.href = `${basePath}/signin/${vendor}?${params}`;
      },
    },

    /**
     * Sign up with email
     */
    signUp: {
      email: async (data: { name: string; email: string; password?: string }) => {
        const res = await fetchFn(`${basePath}/signup/email`, {
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
      const res = await fetchFn(`${basePath}/signout`, { method: 'POST' });
      return handleResponse(res);
    },

    /**
     * Get current session
     */
    getSession: async () => {
      const res = await fetchFn(`${basePath}/session`);
      return handleResponse(res);
    },

    /**
     * Refresh session token
     */
    refreshSession: async () => {
      const res = await fetchFn(`${basePath}/session/refresh`, { method: 'POST' });
      return handleResponse(res);
    },

    /**
     * Password management
     */
    password: {
      reset: async (email: string) => {
        const res = await fetchFn(`${basePath}/password/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        return handleResponse(res);
      },

      confirm: async (token: string, password: string) => {
        const res = await fetchFn(`${basePath}/password/reset/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password }),
        });
        return handleResponse(res);
      },
    },

    /**
     * Email verification
     */
    email: {
      requestVerification: async () => {
        const res = await fetchFn(`${basePath}/email/verify`, { method: 'POST' });
        return handleResponse(res);
      },
    },

    /**
     * User management
     */
    user: {
      get: async () => {
        const res = await fetchFn(`${basePath}/user`);
        return handleResponse(res);
      },

      update: async (data: { name?: string; image?: string }) => {
        const res = await fetchFn(`${basePath}/user`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        return handleResponse(res);
      },
    },

    /**
     * Create a reactive session store (Svelte 5)
     */
    useSession: () => {
      // Returns a Svelte 5 reactive state
      // See auth.state.svelte.ts
    },
  };
}
```

### 5. Reactive Auth State (`auth.state.svelte.ts`)

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
  isLoading: boolean;
  isAuthenticated: boolean;
  orgs: Array<{
    id: string;
    name: string;
    role: number;
  }>;
  currentOrgId: string | null;
}

/**
 * Create reactive auth state using Svelte 5 runes
 * This should be called from a .svelte.ts file
 */
export function createAuthState(initialData?: Partial<AuthSession>) {
  let session = $state<SessionToken<'auth'> | null>(initialData?.session ?? null);
  let isLoading = $state(false);
  let currentOrgId = $state<string | null>(initialData?.currentOrgId ?? null);

  const user = $derived(
    session
      ? {
          id: session.uid,
          name: session.name,
          email: session.email,
          verified: session.verified,
        }
      : null
  );

  const isAuthenticated = $derived(!!session);

  const orgs = $derived(
    session
      ? Object.entries(session.org).map(([id, org]) => ({
          id,
          name: org.name,
          role: org.role,
        }))
      : []
  );

  return {
    get user() { return user; },
    get session() { return session; },
    get isLoading() { return isLoading; },
    get isAuthenticated() { return isAuthenticated; },
    get orgs() { return orgs; },
    get currentOrgId() { return currentOrgId; },

    setSession(newSession: SessionToken<'auth'> | null) {
      session = newSession;
    },

    setLoading(loading: boolean) {
      isLoading = loading;
    },

    setCurrentOrg(orgId: string | null) {
      currentOrgId = orgId;
    },
  };
}
```

### 6. Svelte Components

#### SignInForm.svelte

```svelte
<script lang="ts">
  import type { AuthClientConfig } from '../auth.client';

  interface Props {
    /** Auth client configuration */
    client?: AuthClientConfig;
    /** Redirect URL after sign-in */
    redirectTo?: string;
    /** Allow magic link sign-in */
    allowMagicLink?: boolean;
    /** OAuth providers to show */
    oauthProviders?: Array<'google' | 'github' | 'microsoft'>;
    /** Callback on successful sign-in */
    onSuccess?: () => void;
    /** Callback on error */
    onError?: (error: Error) => void;
  }

  let {
    client = {},
    redirectTo = '/dashboard',
    allowMagicLink = true,
    oauthProviders = [],
    onSuccess,
    onError,
  }: Props = $props();

  let email = $state('');
  let password = $state('');
  let isLoading = $state(false);
  let error = $state<string | null>(null);
  let magicLinkSent = $state(false);
</script>

<form onsubmit={handleSubmit}>
  <input type="email" bind:value={email} placeholder="Email" required />
  <input type="password" bind:value={password} placeholder="Password" />

  {#if error}
    <p class="error">{error}</p>
  {/if}

  <button type="submit" disabled={isLoading}>
    {isLoading ? 'Signing in...' : 'Sign In'}
  </button>

  {#if allowMagicLink}
    <button type="button" onclick={handleMagicLink} disabled={isLoading}>
      Sign in with Magic Link
    </button>
  {/if}

  {#each oauthProviders as provider}
    <button type="button" onclick={() => handleOAuth(provider)}>
      Continue with {provider}
    </button>
  {/each}
</form>
```

#### SignUpForm.svelte

```svelte
<script lang="ts">
  interface Props {
    redirectTo?: string;
    requirePassword?: boolean;
    oauthProviders?: Array<'google' | 'github' | 'microsoft'>;
    onSuccess?: () => void;
    onError?: (error: Error) => void;
  }

  let {
    redirectTo = '/dashboard',
    requirePassword = false,
    oauthProviders = [],
    onSuccess,
    onError,
  }: Props = $props();

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let isLoading = $state(false);
  let error = $state<string | null>(null);
</script>

<form onsubmit={handleSubmit}>
  <input type="text" bind:value={name} placeholder="Name" required />
  <input type="email" bind:value={email} placeholder="Email" required />
  {#if requirePassword}
    <input type="password" bind:value={password} placeholder="Password" required />
  {/if}

  {#if error}
    <p class="error">{error}</p>
  {/if}

  <button type="submit" disabled={isLoading}>
    {isLoading ? 'Creating account...' : 'Create Account'}
  </button>

  {#each oauthProviders as provider}
    <button type="button" onclick={() => handleOAuth(provider)}>
      Continue with {provider}
    </button>
  {/each}
</form>
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
  permissionMap: PERMISSIONS,
  oauthCapabilityMap: OAUTH_CAPABILITIES,

  oauth: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      accessTokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: ['openid', 'email', 'profile'],
    },
  },

  email: {
    sendEmail: async ({ to, subject, html }) => {
      await resend.emails.send({ from: 'noreply@myapp.com', to, subject, html });
    },
  },
});
```

### 2. Hooks Setup (`src/hooks.server.ts`)

```typescript
import type { Handle } from '@sveltejs/kit';
import { svelteKitHandler } from '@delightstack/auth/sveltekit';
import { authConfig } from '$lib/auth';
import { building } from '$app/environment';

export const handle: Handle = async ({ event, resolve }) => {
  return svelteKitHandler({
    event,
    resolve,
    config: authConfig,
    building,
    getAuthDO: () => {
      const id = event.platform!.env.AUTH.idFromName('main');
      return event.platform!.env.AUTH.get(id);
    },
  });
};
```

### 3. Client Setup (`src/lib/auth.client.ts`)

```typescript
import { createAuthClient } from '@delightstack/auth/client';

export const authClient = createAuthClient();
```

### 4. Using in Components

```svelte
<script lang="ts">
  import { authClient } from '$lib/auth.client';
  import { SignInForm } from '@delightstack/auth/client/components';

  const session = authClient.useSession();
</script>

{#if $session.isAuthenticated}
  <p>Welcome, {$session.user?.name}!</p>
  <button onclick={() => authClient.signOut()}>Sign Out</button>
{:else}
  <SignInForm
    oauthProviders={['google']}
    allowMagicLink={true}
    redirectTo="/dashboard"
  />
{/if}
```

### 5. Protected Routes (`src/routes/dashboard/+layout.server.ts`)

```typescript
import { redirect } from '@sveltejs/kit';

export async function load({ locals }) {
  if (!locals.session) {
    throw redirect(302, '/signin?redirect=/dashboard');
  }

  return {
    user: locals.user,
  };
}
```

### 6. Type-safe Locals (`src/app.d.ts`)

```typescript
import type { AuthLocals } from '@delightstack/auth/sveltekit';
import type { AuthDatabaseServer } from '@delightstack/auth/server';

declare global {
  namespace App {
    interface Locals extends AuthLocals {
      auth: AuthDatabaseServer;
    }
  }
}
```

---

## Supported Sign-In Methods

Based on `AuthDatabaseServer`, the following methods are supported:

| Method | Description | Server Method |
|--------|-------------|---------------|
| Email + Password | Traditional email/password | `signInWithEmail()` |
| Magic Link | Passwordless email link | `createEmailSignInToken()` + `signInWithEmailToken()` |
| OAuth | Google, GitHub, etc. | `signInWithOauth()` |
| Email Sign-up | Create new account | `signUpWithEmail()` |

---

## Implementation Tasks

### Phase 1: Core Server Handler
- [ ] Create `auth.config.ts` with configuration types
- [ ] Create `auth.handler.ts` with `svelteKitHandler`
- [ ] Create `auth.routes.ts` with route handlers
- [ ] Create `sveltekit/cookies.ts` for cookie utilities
- [ ] Add type definitions for `App.Locals`

### Phase 2: Client Library
- [ ] Create `auth.client.ts` with `createAuthClient`
- [ ] Create `auth.state.svelte.ts` with reactive state
- [ ] Add `useSession` hook integration

### Phase 3: Components
- [ ] Create `SignInForm.svelte`
- [ ] Create `SignUpForm.svelte`
- [ ] Create `OAuthButton.svelte`
- [ ] Add unstyled/headless variants

### Phase 4: Documentation & Testing
- [ ] Update package exports
- [ ] Add JSDoc comments
- [ ] Create example app integration
- [ ] Write tests

---

## Migration Path

For existing apps using the manual integration:

1. **Install update**: Update `@delightstack/auth`
2. **Create config**: Add `src/lib/auth.ts` with `defineAuthConfig`
3. **Update hooks**: Replace manual JWT handling with `svelteKitHandler`
4. **Update types**: Add `AuthLocals` to `App.Locals`
5. **Update components**: Replace custom forms with provided components (optional)
6. **Remove routes**: Delete manual `/api/auth/*` routes (handled automatically)

---

## Open Questions

1. **Session storage**: Should we support alternative session stores (Redis, KV)?
2. **CSRF protection**: Should we add built-in CSRF tokens?
3. **Rate limiting**: Is the existing rate limiting sufficient or should we expose configuration?
4. **Webhooks**: Should we emit events for auth actions (sign-in, sign-up, etc.)?
5. **Multi-tenancy**: How should org switching work in the client?

---

## References

- [Better Auth SvelteKit Integration](https://www.better-auth.com/docs/integrations/svelte-kit)
- [Auth.js SvelteKit](https://authjs.dev/reference/sveltekit)
- [Lucia Auth](https://lucia-auth.com/) (deprecated but influential)
- [SvelteKit Auth Docs](https://svelte.dev/docs/kit/auth)

Sources:
- [SvelteKit Integration | Better Auth](https://www.better-auth.com/docs/integrations/svelte-kit)
- [SvelteKit Example | Better Auth](https://www.better-auth.com/docs/examples/svelte-kit)
- [Adding Better Auth to your Svelte 5 project](https://awingender.com/blog/better-auth-svelte-5-authentication/)
