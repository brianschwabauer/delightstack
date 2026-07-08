/// <reference types="@sveltejs/kit" />
/// <reference types="@cloudflare/workers-types" />
/// <reference types="unplugin-icons/types/svelte" />

import type { AuthLocals } from '@delightstack/auth/server';
import type { AiServer } from '@delightstack/ai/server';
import type { ImageRecord } from '@delightstack/images';

declare global {
	namespace App {
		interface Error {
			status?: number;
			message: string;
		}

		/**
		 * RPC surface of the org database durable object (`OrgDatabaseServer`
		 * in `server/src/index.ts`). Durable Object stubs are structurally
		 * opaque to TypeScript, so the methods the app calls are declared here.
		 */
		interface OrgDatabase {
			create(entity_type: string, data: unknown): Promise<unknown>;
			get(entity_type: string, id: string | number): Promise<unknown>;
			list(entity_type: string, query?: unknown): Promise<unknown>;
			update(entity_type: string, id: string | number, data: unknown): Promise<unknown>;
			delete(entity_type: string, id: string | number): Promise<void>;
			sync(query?: unknown): Promise<unknown>;
			uploadImage(
				data: ArrayBuffer,
				options?: {
					file_name?: string;
					mime_type?: string;
					data?: Record<string, unknown>;
				},
			): Promise<ImageRecord>;
			ai: AiServer;
		}

		interface Locals extends AuthLocals {
			/** Org database durable object (lazy-loaded, undefined if no org selected) */
			db: OrgDatabase | undefined;

			/** KV namespace for caching */
			kv: KVNamespace;

			/** R2 bucket for file storage */
			r2: R2Bucket;
		}

		interface PageData {}

		interface Platform {
			caches: {
				open(cacheName: string): Promise<Cache>;
				readonly default: Cache;
			};
			context: ExecutionContext;
			env: CloudflareEnvVariables;
			cf: CfProperties;
		}

		interface CloudflareEnvVariables {
			AUTH: DurableObjectNamespace;
			DB: DurableObjectNamespace;
			WS: DurableObjectNamespace;
			RATE_LIMITER: DurableObjectNamespace;
			AI: Ai;
			KV: KVNamespace;
			R2: R2Bucket;
			SELF: Fetcher;
			JWT_KEY_SECRET: string;
			STRIPE_SECRET_KEY: string;
			PUBLIC_STRIPE_PUBLISHABLE_KEY: string;
		}
	}
}

export {};
