// Worker entry point — imports from /worker paths which depend on cloudflare:workers.
// SvelteKit app code should import from /server paths instead.
import { DatabaseServer } from '@delightstack/database/worker';
import { AuthDatabaseServer as BaseAuthDatabaseServer } from '@delightstack/auth/worker';
import { WebsocketServer } from '@delightstack/websocket/worker';
import { RateLimiterServer } from '@delightstack/rate-limiter';
import { ImageProcessorContainer } from '@delightstack/images/worker';
import { aiProcessing } from '@delightstack/ai/server';
import { imageProcessing } from '@delightstack/images';
import { createDevRpcHandler } from '@delightstack/utilities';
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
			secret: env.JWT_KEY_SECRET || 'dev-secret-change-me-in-production-min-64-chars-long-0123456789abcdef',
			issuer: 'foreverfamily',
			permissions: ['admin', 'editor', 'viewer'],
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
		super(tables, () => env.WS.get(env.WS.idFromName('main')), ctx, env);

		this.images = imageProcessing(this, {
			container: () => env.IMAGE_PROCESSOR,
			bucket: () => env.R2,
		});

		this.#ai = aiProcessing(this, {
			ai: () => env.AI,
			gateway: 'foreverfamily',
			storage: ctx.storage,
			ws: () => env.WS.get(env.WS.idFromName('main')) as unknown as WebsocketServer,
			fields: [
				{ entity_type: 'post', source_fields: ['title', 'content', 'tags'] },
			],
		});
	}

	get ai() {
		return this.#ai;
	}

	async alarm() {
		await this.images.processAlarm();
		await this.#ai.processAlarm();
	}
}

/**
 * WebSocket server — one instance per room (org).
 * Handles presence tracking and AI stream resume/cancel.
 */
export class AppWebsocketServer extends WebsocketServer {
	constructor(ctx: DurableObjectState, env: Env) {
		super({}, ctx, env);
	}
}

/**
 * Default fetch handler — bridges dev proxy HTTP requests to real Durable Objects.
 * In production this is unused (the SvelteKit worker is deployed separately).
 */
export default {
	async fetch(request: Request, env: Env) {
		return createDevRpcHandler(request, {
			AUTH: env.AUTH,
			DB: env.DB,
		});
	},
};

interface Env {
	AUTH: DurableObjectNamespace;
	DB: DurableObjectNamespace;
	WS: DurableObjectNamespace;
	RATE_LIMITER: DurableObjectNamespace;
	IMAGE_PROCESSOR: DurableObjectNamespace;
	AI: Ai;
	KV: KVNamespace;
	R2: R2Bucket;
	JWT_KEY_SECRET?: string;
	DEV?: boolean;
}
