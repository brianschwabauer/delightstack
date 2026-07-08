import type { Handle, HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { createAuthHandle, type AuthServer } from '@delightstack/auth/server';
import type { AuthLocals } from '@delightstack/auth/server';
import { createWebsocketHandle } from '@delightstack/websocket/server';
import { createDatabaseHandle } from '@delightstack/database/server';
import { tables } from '$lib/schema';
import { plans, entitlements as billingEntitlements } from '$lib/plans';
import { createBillingHandle } from '@delightstack/stripe/server';
import { createAiHandle } from '@delightstack/ai/server';
import { createImageHandle } from '@delightstack/images';
import { DelightError, createDevHandle } from '@delightstack/utilities';
import { env } from '$env/dynamic/private';
import { env as public_env } from '$env/dynamic/public';
import { building, dev } from '$app/environment';

// ---------------------------------------------------------------------------
// 1. Auth — JWT sessions, org resolution, /api/auth/* routes
// ---------------------------------------------------------------------------
const authHandle = createAuthHandle({
	config: {
		secret:
			env.JWT_KEY_SECRET ??
			'dev-secret-change-me-in-production-min-64-chars-long-0123456789abcdef',
		issuer: 'delightstack',
		permissions: ['admin', 'editor', 'viewer'] as const,
		oauth_scopes: [] as const,
		entitlements: ['ai', 'images'] as const,
		dev,
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
		return platform.env.WS.get(platform.env.WS.idFromName(locals.org_id));
	},
});

// ---------------------------------------------------------------------------
// 3. Image CDN — serves processed images from R2
// ---------------------------------------------------------------------------
const imageHandle = createImageHandle({
	bucket: (event) => {
		const bucket = (event.platform as App.Platform | undefined)?.env?.R2;
		if (!bucket) throw DelightError.notFound('Image storage is not available');
		return bucket;
	},
});

// ---------------------------------------------------------------------------
// 4. Database — auto-generated CRUD routes for every table. `requireAuth`
//    (default true) rejects CUD without a session; only per-entity extras
//    (like stamping author_id on posts) need explicit hooks.
// ---------------------------------------------------------------------------
const databaseHandle = createDatabaseHandle({
	getDatabase: (event) => event.locals.db,
	tables,
	hooks: {
		post: {
			beforeCreate: ({ data, event }) => ({
				...data,
				author_id: event.locals.user!.id,
			}),
		},
	},
	sync: true,
});

// ---------------------------------------------------------------------------
// 4b. Image upload — routes multipart uploads through the real imageProcessing
//     pipeline (container → variants + thumbhash + EXIF). In prod the DO
//     binding is available directly; in dev we forward to the wrangler dev
//     worker because the JSON RPC proxy cannot pass a File/Blob through.
// ---------------------------------------------------------------------------
const imageUploadHandle: Handle = async ({ event, resolve }) => {
	if (
		event.url.pathname !== '/api/image' ||
		event.request.method !== 'POST' ||
		!event.request.headers.get('content-type')?.includes('multipart/form-data')
	) {
		return resolve(event);
	}

	if (!event.locals.session) {
		return DelightError.unauthorized('Sign in to upload images').toResponse();
	}

	const locals = event.locals as AuthLocals & App.Locals;
	if (!locals.org_id) return DelightError.badRequest('No organization').toResponse();

	if (dev) {
		// Dev: forward to the wrangler dev worker which has real DO bindings.
		// Buffer the body first so undici doesn't need duplex streaming, and
		// rebuild headers minimally to avoid forwarding host/cookie junk.
		const body = await event.request.arrayBuffer();
		const content_type = event.request.headers.get('content-type') ?? '';
		try {
			const res = await fetch('http://localhost:8787/api/image', {
				method: 'POST',
				headers: {
					'content-type': content_type,
					'X-Org-Id': locals.org_id,
					'X-Session-Uid': event.locals.session.uid,
				},
				body,
			});
			// Buffer the body so SvelteKit's adapter can serialize the Response
			// correctly — returning an undici-streamed Response fails silently.
			const buf = await res.arrayBuffer();
			return new Response(buf, {
				status: res.status,
				headers: {
					'content-type': res.headers.get('content-type') ?? 'application/json',
				},
			});
		} catch (error) {
			return DelightError.from(error).toResponse();
		}
	}

	// Prod: DO binding is a real stub. Pass an ArrayBuffer + mime_type because
	// Cloudflare RPC cannot serialize a File object directly.
	const formData = await event.request.formData();
	const file = formData.get('file') as File | null;
	const caption = (formData.get('caption') as string) || null;
	if (!file) return DelightError.badRequest('No file provided').toResponse();

	const db = locals.db;
	if (!db) return DelightError.badRequest('Database not available').toResponse();

	try {
		const buffer = await file.arrayBuffer();
		const record = await db.uploadImage(buffer, {
			file_name: file.name,
			mime_type: file.type || undefined,
			data: { caption, uploader_id: event.locals.session.uid },
		});
		return new Response(JSON.stringify(record), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		return DelightError.from(error).toResponse();
	}
};

// ---------------------------------------------------------------------------
// 5. Billing — Stripe subscription routes at /api/billing/*
//    Disabled when STRIPE_SECRET_KEY / PUBLIC_STRIPE_PUBLISHABLE_KEY are not set.
// ---------------------------------------------------------------------------
const stripe_secret_key = env.STRIPE_SECRET_KEY?.startsWith('sk_')
	? env.STRIPE_SECRET_KEY
	: undefined;
// PUBLIC_-prefixed variables are only exposed through the public dynamic env.
const stripe_publishable_key = public_env.PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith('pk_')
	? public_env.PUBLIC_STRIPE_PUBLISHABLE_KEY
	: undefined;
const has_stripe = !!(stripe_secret_key && stripe_publishable_key);

const billingHandle: Handle =
	stripe_secret_key && stripe_publishable_key
		? createBillingHandle({
				config: {
					secret_key: stripe_secret_key,
					publishable_key: stripe_publishable_key,
					billing_scope: 'org',
					plans: plans.map(({ features, ...p }) => p),
					entitlements: billingEntitlements,
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
	console.warn(
		'[@delightstack/stripe] Billing disabled — set STRIPE_SECRET_KEY and PUBLIC_STRIPE_PUBLISHABLE_KEY to enable.',
	);
}

// ---------------------------------------------------------------------------
// 6. AI — completion, streaming, and embedding endpoints at /api/ai/*
// ---------------------------------------------------------------------------
const aiHandle = createAiHandle({
	// The ai handle's minimal event type erases `locals`, so restore its type.
	getAi: (event) => (event.locals as unknown as App.Locals).db?.ai,
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
				// DO stubs are structurally opaque; assert the OrgDatabaseServer
				// RPC surface (declared as App.OrgDatabase) once at this boundary.
				_cached_db = penv.DB.get(db_binding) as unknown as App.OrgDatabase;
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
	...(dev ? [createDevHandle()] : []),
	authHandle,
	appHandle,
	websocketHandle,
	imageHandle,
	imageUploadHandle,
	databaseHandle,
	billingHandle,
	aiHandle,
);

export const handleError: HandleServerError = ({ error }) => {
	const err = DelightError.from(error);
	return { message: err.message, status: err.status };
};
