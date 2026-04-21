import { redirect } from '@sveltejs/kit';
import { WebsocketClient } from '@delightstack/websocket/client';
import { DatabaseClient } from '@delightstack/database/client';
import { AiClient } from '@delightstack/ai/client';
import { tables } from '$lib/schema';
import { dev } from '$app/environment';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ parent, fetch }) => {
	const { auth } = await parent();

	if (auth.signed_out) throw redirect(307, '/signin');
	if (!auth.org_id) throw redirect(307, '/account/org');

	// In dev, connect directly to the wrangler worker since Vite can't
	// proxy WebSocket upgrades through the RPC proxy. The room is passed
	// via query param because we're bypassing the SvelteKit auth handle.
	const ws_url = dev
		? `ws://localhost:8787/api/websocket?room=${encodeURIComponent(auth.org_id)}&user_id=${encodeURIComponent(auth.id ?? '')}&user_name=${encodeURIComponent(auth.name ?? '')}`
		: undefined;
	const ws = new WebsocketClient({ dev, url: ws_url });
	const db = new DatabaseClient({
		tables,
		db_name: `foreverfamily:${auth.org_id}`,
		fetch,
		hooks: ws.databaseHooks(),
		// Images aren't indexed with searchable fields, so route image
		// searches through the server to get full entity data (including
		// processing_status and variants needed by the Image component).
		entities: {
			image: { search_mode: 'server' },
		},
		dev,
	});
	const ai = new AiClient({ ws });

	await db.init();

	return { auth, ws, db, ai };
};
