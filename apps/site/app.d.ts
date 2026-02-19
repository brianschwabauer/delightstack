/// <reference types="@sveltejs/kit" />
/// <reference types="svelte" />
/// <reference types="unplugin-icons/types/svelte" />
/// <reference types="@types/intercom-web" />
/// <reference types="@types/google.maps" />

// import type { OAUTH_VENDOR } from '@packages/lib';

declare namespace App {
	type GetVendorApi<Vendor extends import('@packages/lib').OAUTH_VENDOR> = (
		vendor: Vendor,
		oauth_token_id?: string,
		required_permissions?: Permissions[],
	) => Promise<import('@packages/lib').OAUTH_VENDOR[Vendor]>;

	interface Error {
		status?: number;
		message: string;
	}

	interface Locals {
		/** The class for handling auth related functions (like signin, signup, passwords, etc) */
		auth: DurableObjectStub<
			Omit<
				import('./../server/src').AuthDatabaseServer,
				| 'alarm'
				| 'webSocketMessage'
				| 'webSocketClose'
				| 'webSocketError'
				| 'fetch'
				| 'Rpc'
			>
		>;

		/** The current auth state of the request (whether signed in, the current user id, etc) */
		authState: import('./lib/state/auth.state.svelte').AuthState;

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
		// db:
		// 	| DurableObjectStub<
		// 			Omit<
		// 				import('./../server/src').OrgDatabaseServer,
		// 				| 'alarm'
		// 				| 'webSocketMessage'
		// 				| 'webSocketClose'
		// 				| 'webSocketError'
		// 				| 'fetch'
		// 				| 'Rpc'
		// 			>
		// 	  >
		// 	| undefined;

		getVendorApi: <Vendor extends import('@packages/lib').OauthVendor>(
			vendor: Vendor,
			oauth_token_id?: string,
			required_permissions?: Permissions[],
		) => Promise<InstanceType<(typeof import('@packages/lib').OAUTH_VENDOR)[Vendor]>>;

		/** The class for processing (resizing/compressing/converting) images */
		imageProcessor: import('@packages/lib').ImageProcessor;

		/** The class for accessing CloudFlare's KV database */
		kv: KVNamespace;

		/** The information about the organization the user is signed into */
		org: Promise<import('@packages/types').Org | undefined>;

		/** The class for accessing CloudFlare R2 cloud storage */
		r2: R2Bucket;

		/** The class for using websockets on the server */
		ws: DurableObjectStub<import('./../server/src').WebsocketServer> | undefined;
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
		BROWSER: Fetcher;
		DB: DurableObjectNamespace<import('./../server/src').OrgDatabaseServer>;
		KV: KVNamespace;
		R2: R2Bucket;
		D1: D1Database;
		WS: DurableObjectNamespace<import('./../server/src').WebsocketServer>;
		RATE_LIMITER: DurableObjectNamespace<import('./../server/src').RateLimiterServer>;
		IMAGE_PROCESSOR: Service<import('./../images/src').ImageProcessor>;
		SERVER: import('./../server/src/index').ForeverFamilyServer;
	}
}
