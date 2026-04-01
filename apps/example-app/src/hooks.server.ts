import type { Handle, HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { createAuthHandle, type AuthServer } from '@delightstack/auth/server';
import type { AuthLocals } from '@delightstack/auth/server';
import { createWebsocketHandle } from '@delightstack/websocket/server';
import { createDatabaseHandle, defineRoute } from '@delightstack/database/server';
import { createBillingHandle } from '@delightstack/stripe/server';
import { createAiHandle } from '@delightstack/ai/server';
import { createImageHandle } from '@delightstack/images';
import { DelightError } from '@delightstack/utilities';
import { env } from '$env/dynamic/private';
import { building, dev } from '$app/environment';
import { personTable, postTable } from '$lib/schema';

// ---------------------------------------------------------------------------
// 1. Auth — JWT sessions, org resolution, /api/auth/* routes
// ---------------------------------------------------------------------------
const authHandle = createAuthHandle({
	config: {
		secret: env.JWT_KEY_SECRET ?? 'dev-secret-change-me-in-production-min-64-chars-long-0123456789abcdef',
		issuer: 'foreverfamily',
		permissions: ['admin', 'editor', 'viewer'] as const,
		oauth_scopes: [] as const,
		entitlements: ['ai', 'images'] as const,
		dev,
		cookies: {
			session_name: 'ff-session',
			preferences_name: 'ff-pref',
			org_state_prefix: 'ff-org-',
		},
	},
	getAuthServer: (event) => {
		const auth = (event.platform as App.Platform | undefined)?.env?.AUTH;
		if (!auth) return undefined as unknown as AuthServer;
		return auth.get(auth.idFromName('main')) as unknown as AuthServer;
	},
	building,
});

// ---------------------------------------------------------------------------
// 2. WebSocket — upgrade requests to Durable Object
// ---------------------------------------------------------------------------
const websocketHandle = createWebsocketHandle({
	getWebsocket: (event) => {
		const locals = event.locals as AuthLocals & App.Locals;
		if (!locals.org_id) return undefined;
		const platform = event.platform as App.Platform | undefined;
		if (!platform) return undefined;
		return platform.env.WS.get(
			platform.env.WS.idFromName(locals.org_id),
		);
	},
});

// ---------------------------------------------------------------------------
// 3. Image CDN — serves processed images from R2
// ---------------------------------------------------------------------------
const imageHandle = createImageHandle({
	bucket: (event) => (event.platform as App.Platform)?.env?.R2,
});

// ---------------------------------------------------------------------------
// 4. Database — declarative CRUD routes for person & post
// ---------------------------------------------------------------------------
const personRoute = defineRoute({
	entity: 'person',
	table: personTable,
	hooks: {
		beforeCreate: ({ event }) => {
			if (!event.locals.session) throw DelightError.unauthorized();
		},
		beforeUpdate: ({ event }) => {
			if (!event.locals.session) throw DelightError.unauthorized();
		},
		beforeDelete: ({ event }) => {
			if (!event.locals.session) throw DelightError.unauthorized();
		},
	},
});

const postRoute = defineRoute({
	entity: 'post',
	table: postTable,
	hooks: {
		beforeCreate: ({ data, event }) => {
			if (!event.locals.session) throw DelightError.unauthorized();
			return { ...data, author_id: event.locals.user!.id };
		},
		beforeUpdate: ({ event }) => {
			if (!event.locals.session) throw DelightError.unauthorized();
		},
		beforeDelete: ({ event }) => {
			if (!event.locals.session) throw DelightError.unauthorized();
		},
	},
});

const databaseHandle = createDatabaseHandle({
	getDatabase: (event) => event.locals.db,
	routes: [personRoute, postRoute],
	sync: true,
});

// ---------------------------------------------------------------------------
// 5. Billing — Stripe subscription routes at /api/billing/*
//    Disabled when STRIPE_SECRET_KEY / PUBLIC_STRIPE_PUBLISHABLE_KEY are not set.
// ---------------------------------------------------------------------------
const has_stripe = env.STRIPE_SECRET_KEY?.startsWith('sk_') && env.PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith('pk_');

const billingHandle: Handle = has_stripe
	? createBillingHandle({
			config: {
				secret_key: env.STRIPE_SECRET_KEY,
				publishable_key: env.PUBLIC_STRIPE_PUBLISHABLE_KEY,
				billing_scope: 'org',
				plans: [
					{
						id: 'free',
						name: 'Free',
						description: 'Basic family management for small families',
						lookup_key: 'free',
						amount: 0,
						interval: 'month',
					},
					{
						id: 'family-pro',
						name: 'Family Pro',
						description: 'AI-powered writing, image uploads, and more',
						lookup_key: 'family-pro',
						amount: 499,
						interval: 'month',
						entitlements: ['ai', 'images'],
					},
				],
				entitlements: ['ai', 'images'] as const,
				dev,
			},
			getAuthServer: (event) => {
				const auth = (event.platform as App.Platform | undefined)?.env?.AUTH;
				if (!auth) return undefined;
				return auth.get(auth.idFromName('main')) as unknown as {
					updateOrg(id: string, data: { plan?: number; json?: string }): unknown;
				};
			},
			building,
		})
	: ({ event, resolve }) => resolve(event);

if (!has_stripe && dev) {
	console.warn('[@delightstack/stripe] Billing disabled — set STRIPE_SECRET_KEY and PUBLIC_STRIPE_PUBLISHABLE_KEY to enable.');
}

// ---------------------------------------------------------------------------
// 6. AI — completion, streaming, and embedding endpoints at /api/ai/*
// ---------------------------------------------------------------------------
const aiHandle = createAiHandle({
	getAi: (event) => (event.locals.db as unknown as { ai: unknown })?.ai,
	authorize: (event) => !!event.locals.session,
});

// ---------------------------------------------------------------------------
// 7. App — platform bindings (DB, KV, R2)
// ---------------------------------------------------------------------------
const appHandle: Handle = async ({ event, resolve }) => {
	const platform = event.platform as App.Platform | undefined;
	if (!platform) return resolve(event);

	const locals = event.locals as AuthLocals & App.Locals;
	const penv = platform.env ?? {};

	event.locals.kv = penv.KV;
	event.locals.r2 = penv.R2;

	// Lazy org database durable object
	const org_id = locals.org_id;
	let _cached_db: App.Locals['db'];
	Object.assign(event.locals, {
		get db() {
			if (!_cached_db) {
				if (!org_id || !penv.DB) return undefined;
				const db_binding = locals.org?.db
					? penv.DB.idFromString(locals.org.db)
					: penv.DB.idFromName(org_id);
				_cached_db = penv.DB.get(db_binding);
			}
			return _cached_db;
		},
	});

	return resolve(event);
};

// ---------------------------------------------------------------------------
// Compose all handles
// ---------------------------------------------------------------------------
export const handle = sequence(
	authHandle,
	appHandle,
	websocketHandle,
	imageHandle,
	databaseHandle,
	billingHandle,
	aiHandle,
);

export const handleError: HandleServerError = ({ error }) => {
	const err = DelightError.from(error);
	return { message: err.message, status: err.status };
};
