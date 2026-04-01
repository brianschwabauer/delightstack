/// <reference types="@sveltejs/kit" />
/// <reference types="svelte" />
/// <reference types="unplugin-icons/types/svelte" />

declare namespace App {
	interface Error {
		status?: number;
		message: string;
	}

	interface Locals
		extends import('@delightstack/auth/server').AuthLocals {
		/** Org database durable object (lazy-loaded, undefined if no org selected) */
		db: Record<string, unknown> | undefined;

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
