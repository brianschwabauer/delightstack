import { redirect } from '@sveltejs/kit';
import { WebsocketClient } from '@delightstack/websocket/client';
import { DatabaseClient } from '@delightstack/database/client';
import { AiClient } from '@delightstack/ai/client';
import { tables } from '$lib/schema';
import { dev } from '$app/environment';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ parent }) => {
	const { auth } = await parent();

	if (auth.signed_out) throw redirect(307, '/signin');
	if (!auth.org_id) throw redirect(307, '/account/org');

	const ws = new WebsocketClient({ dev });
	const db = new DatabaseClient({
		tables,
		db_name: `foreverfamily:${auth.org_id}`,
		hooks: ws.databaseHooks(),
		dev,
	});
	const ai = new AiClient({ ws });

	return { auth, ws, db, ai };
};
