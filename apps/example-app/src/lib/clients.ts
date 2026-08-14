import { DatabaseClient, type DatabaseClientConfig } from '@delightstack/database/client';
import { WebsocketClient } from '@delightstack/websocket/client';
import { AiClient } from '@delightstack/ai/client';
import type { AuthClient } from '@delightstack/auth/client';
import { tables } from './schema';

/**
 * Wire the WebSocket, Database, and AI clients for a request.
 *
 * Call this once in your dashboard layout's `load` — it returns
 * everything downstream pages need, already connected:
 *
 * ```ts
 * // dashboard/+layout.ts
 * export const load: LayoutLoad = async ({ parent, fetch }) => {
 *   const { auth } = await parent();
 *   if (auth.signed_out) throw redirect(307, '/signin');
 *   if (!auth.org_id) throw redirect(307, '/account/org');
 *   const clients = await createClients({ auth, fetch, dev });
 *   return { auth, ...clients };
 * };
 * ```
 *
 * `db.init()` is awaited before returning so downstream loads can use
 * `db.get(...)` without a preflight. On the server, `db.init()` is a
 * no-op and the client falls back to `config.fetch` for HTTP calls.
 */
export async function createClients(options: {
	auth: AuthClient;
	fetch: typeof globalThis.fetch;
	dev?: boolean;
	/** Per-entity database overrides (search_mode, cache, max_synced_docs). */
	entities?: DatabaseClientConfig<typeof tables>['entities'];
}): Promise<{ ws: WebsocketClient; db: DatabaseClient<typeof tables>; ai: AiClient }> {
	const { auth, fetch, dev, entities } = options;

	const ws = new WebsocketClient({
		dev,
		dev_query: {
			user_id: auth.id ?? undefined,
			user_name: auth.name ?? undefined,
		},
	});

	const db = new DatabaseClient({
		tables,
		db_name: `delightstack:${auth.org_id}`,
		fetch,
		hooks: ws.databaseHooks(),
		entities,
		dev,
	});

	const ai = new AiClient({ ws });

	await db.init();

	return { ws, db, ai };
}
