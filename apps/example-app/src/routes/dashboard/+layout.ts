import { redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { createClients } from '$lib/clients';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ parent, fetch }) => {
	const { auth } = await parent();

	if (auth.signed_out) throw redirect(307, '/signin');
	if (!auth.org_id) throw redirect(307, '/account/org');

	const clients = await createClients({
		auth,
		fetch,
		dev,
		// Images aren't indexed with searchable fields, so route image
		// searches through the server to get full entity data.
		entities: { image: { search_mode: 'server' } },
	});

	return { auth, ...clients };
};
