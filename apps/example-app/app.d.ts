/// <reference types="@sveltejs/kit" />
/// <reference types="svelte" />
/// <reference types="unplugin-icons/types/svelte" />

declare namespace App {
	interface Error {
		status?: number;
		message: string;
	}

	interface Locals
		extends import('./packages/auth/server/auth.handler').AuthLocals {
		/** The class for accessing the main database for the current org */
		db:
			| Omit<
					import('./../server/src').OrgDatabaseServer,
					| 'alarm'
					| 'webSocketMessage'
					| 'webSocketClose'
					| 'webSocketError'
					| 'fetch'
					| 'Rpc'
			  >
			| undefined;

		/** KV namespace for caching */
		kv: KVNamespace;

		/** R2 bucket for file storage */
		r2: R2Bucket;
	}

	interface PageData {}

	interface Cache {
		delete(request: RequestInfo, options?: CacheQueryOptions): Promise<boolean>;
		match(
			request: RequestInfo,
			options?: CacheQueryOptions,
		): Promise<Response | undefined>;
		put(request: RequestInfo, response: Response): Promise<void>;
	}

	interface Platform {
		caches: {
			open(cacheName: string): Promise<App.Cache>;
			readonly default: App.Cache;
		};
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		context: EventContext<CloudflareEnvVariables, any, any>;
		env: CloudflareEnvVariables;
		cf: CfProperties;
	}
	interface CloudflareEnvVariables {
		AUTH: DurableObjectNamespace<import('./../server/src').AuthDatabaseServer>;
		DB: DurableObjectNamespace;
		BROWSER: Fetcher;
		KV: KVNamespace;
		R2: R2Bucket;
		D1: D1Database;
	}
}
