// Worker entry point — imports from /worker paths which depend on cloudflare:workers.
// SvelteKit app code should import from /server paths instead.
import { DatabaseServer } from '@delightstack/database/worker';
import { AuthDatabaseServer as BaseAuthDatabaseServer } from '@delightstack/auth/worker';
import { WebsocketServer } from '@delightstack/websocket/worker';
import {
	createPresenceServer,
	PRESENCE_EPHEMERAL_EVENTS,
} from '@delightstack/presence/server';
import { RateLimiterServer } from '@delightstack/rate-limiter';
import { ImageProcessorContainer } from '@delightstack/images/worker';
import type { UploadOptions, ImageRecord } from '@delightstack/images';
import { aiProcessing } from '@delightstack/ai/server';
import { imageProcessing } from '@delightstack/images';
import { createDevRpcHandler, DelightError } from '@delightstack/utilities';
import { tables } from '../../src/lib/schema';

// Re-export Durable Object classes for wrangler to discover
export { RateLimiterServer, ImageProcessorContainer };

/**
 * Auth database — wraps the base class with app-specific configuration.
 * Workerd only passes (ctx, env) to DO constructors, so we inject options here.
 */
export class AuthDatabaseServer extends BaseAuthDatabaseServer {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env, {
			secret:
				env.JWT_KEY_SECRET ||
				'dev-secret-change-me-in-production-min-64-chars-long-0123456789abcdef',
			issuer: 'delightstack',
			permissions: ['admin', 'editor', 'viewer'],
			// Must be one of `permissions` — the default ('org:admin') is not in
			// this list, which silently encoded org creators' membership to 0
			// permission bits (org invisible to its own owner).
			orgAdminPermission: 'admin',
			oauth_scopes: [],
			entitlements: ['ai', 'images'],
		});
	}
}

/**
 * Organization database — one instance per org.
 * Extends DatabaseServer with image processing and AI integration.
 */
export class OrgDatabaseServer extends DatabaseServer<typeof tables> {
	readonly images;
	readonly #ai;

	constructor(ctx: DurableObjectState, env: Env) {
		// Use the same WS DO name that clients connect to (the org_id).
		const ws_name = DatabaseServer.instanceName(ctx);
		const getWs = () => env.WS.get(env.WS.idFromName(ws_name));
		super(tables, getWs, ctx, env);

		this.images = imageProcessing(this, {
			container: () => env.IMAGE_PROCESSOR,
			bucket: () => env.R2,
			storage: ctx.storage,
		});

		this.#ai = aiProcessing(this, {
			ai: () => env.AI,
			storage: ctx.storage,
			ws: () => getWs(),
			fields: [{ entity_type: 'post', source_fields: ['title', 'content', 'tags'] }],
		});
	}

	get ai() {
		return this.#ai;
	}

	// RPC-callable upload entry point. The SvelteKit app sends an ArrayBuffer
	// plus mime_type because Cloudflare DO RPC cannot serialize a File directly.
	// We wrap it as a Blob so the imageProcessing helper sees the correct
	// content type when writing the original to R2.
	async uploadImage(
		data: ArrayBuffer,
		options: UploadOptions & { mime_type?: string } = {},
	): Promise<ImageRecord> {
		const { mime_type, ...rest } = options;
		const blob = new Blob([data], { type: mime_type ?? 'application/octet-stream' });
		return this.images.upload(blob, rest);
	}

	// No alarm() override needed: imageProcessing() and aiProcessing() register
	// their handlers with the base class's alarm registry, which runs each one
	// with per-handler error isolation.
}

/**
 * WebSocket server — one instance per room (org).
 * Relays presence (live cursors, roster, reactions, field presence) via
 * `@delightstack/presence/server`, and handles AI stream resume/cancel.
 */
export class AppWebsocketServer extends WebsocketServer {
	constructor(ctx: DurableObjectState, env: Env) {
		const presence = createPresenceServer();
		super(
			{
				onMessage: presence.onMessage,
				onDisconnect: presence.onDisconnect,
				// Cursor updates are high-frequency — give presence its own bucket.
				rate_limit: { ephemeral_events: PRESENCE_EPHEMERAL_EVENTS },
			},
			ctx,
			env,
		);
	}
}

/**
 * Default fetch handler — bridges dev proxy HTTP requests to real Durable Objects.
 * In production this is unused (the SvelteKit worker is deployed separately).
 */
export default {
	async fetch(request: Request, env: Env) {
		const url = new URL(request.url);

		// Handle WebSocket upgrades in dev — browser connects directly to this worker.
		// The SvelteKit dev server can't proxy WebSocket upgrades through the RPC proxy,
		// so the WebsocketClient is configured with a direct URL in dev mode.
		if (
			url.pathname === '/api/websocket' &&
			request.headers.get('Upgrade') === 'websocket'
		) {
			const room = url.searchParams.get('room');
			if (!room) {
				return new Response('Missing room query parameter', { status: 400 });
			}

			// Build session meta from query params (dev only — not secure, but no auth context here)
			const user_id = url.searchParams.get('user_id') ?? 'anonymous';
			const user_name = url.searchParams.get('user_name') ?? 'User';
			const session_meta = { room, meta: { user_id, user_name } };

			const forward_headers = new Headers(request.headers);
			forward_headers.set('X-WS-Meta', JSON.stringify(session_meta));

			const ws_stub = env.WS.get(env.WS.idFromName(room));
			return ws_stub.fetch(
				new Request(request.url, {
					method: request.method,
					headers: forward_headers,
				}),
			);
		}

		// Image upload bridge — the SvelteKit dev server cannot pass File/Blob
		// args through the JSON dev RPC proxy, so it forwards multipart uploads
		// here where we have a real DO binding and can call uploadImage() via
		// structured-clone RPC. X-Org-Id / X-Session-Uid carry auth context.
		if (url.pathname === '/api/image' && request.method === 'POST') {
			const org_id = request.headers.get('X-Org-Id');
			const session_uid = request.headers.get('X-Session-Uid');
			if (!org_id || !session_uid) {
				return DelightError.unauthorized('Missing org or session context').toResponse();
			}

			const form = await request.formData();
			const file = form.get('file') as File | null;
			const caption = (form.get('caption') as string) || null;
			if (!file) return DelightError.badRequest('No file provided').toResponse();

			const stub = env.DB.get(env.DB.idFromName(org_id)) as unknown as {
				uploadImage: (
					data: ArrayBuffer,
					options?: {
						file_name?: string;
						mime_type?: string;
						data?: Record<string, unknown>;
					},
				) => Promise<ImageRecord>;
			};

			try {
				const buffer = await file.arrayBuffer();
				const record = await stub.uploadImage(buffer, {
					file_name: file.name,
					mime_type: file.type || undefined,
					data: { caption, uploader_id: session_uid },
				});
				return new Response(JSON.stringify(record), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			} catch (error) {
				return DelightError.from(error).toResponse();
			}
		}

		return createDevRpcHandler(request, {
			AUTH: env.AUTH,
			DB: env.DB,
			WS: env.WS,
		});
	},
};

interface Env {
	// Index signature so this env satisfies the WebsocketServer env constraint.
	[key: string]: unknown;
	AUTH: DurableObjectNamespace;
	DB: DurableObjectNamespace<OrgDatabaseServer>;
	WS: DurableObjectNamespace<AppWebsocketServer>;
	RATE_LIMITER: DurableObjectNamespace;
	IMAGE_PROCESSOR: DurableObjectNamespace;
	AI: Ai;
	KV: KVNamespace;
	R2: R2Bucket;
	JWT_KEY_SECRET?: string;
	/** Set via wrangler vars in dev; undefined (falsy) in production. */
	DEV: boolean;
}
