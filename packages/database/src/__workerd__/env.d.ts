/// <reference types="@cloudflare/vitest-pool-workers" />

import type { BareDatabase, TestDatabase } from './worker.js';

declare module 'cloudflare:test' {
	interface ProvidedEnv {
		DB: DurableObjectNamespace<TestDatabase>;
		BARE: DurableObjectNamespace<BareDatabase>;
	}
}
