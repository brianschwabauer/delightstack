// Worker entry point — imports from /worker paths which depend on cloudflare:workers.
// SvelteKit app code should import from /server paths instead.
import { DatabaseServer } from '@delightstack/database/worker';
import { AuthDatabaseServer } from '@delightstack/auth/worker';
import { WebsocketServer } from '@delightstack/websocket/worker';
import { RateLimiterServer } from '@delightstack/rate-limiter';
import { ImageProcessorContainer } from '@delightstack/images/worker';
import { aiProcessing } from '@delightstack/ai/server';
import { imageProcessing } from '@delightstack/images';
import { tables } from '../../src/lib/schema';

// Re-export Durable Object classes for wrangler to discover
export { AuthDatabaseServer, RateLimiterServer, ImageProcessorContainer };

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
			ws: () => undefined,
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

interface Env {
	AUTH: DurableObjectNamespace;
	DB: DurableObjectNamespace;
	WS: DurableObjectNamespace;
	RATE_LIMITER: DurableObjectNamespace;
	IMAGE_PROCESSOR: DurableObjectNamespace;
	AI: Ai;
	KV: KVNamespace;
	R2: R2Bucket;
	DEV?: boolean;
}
