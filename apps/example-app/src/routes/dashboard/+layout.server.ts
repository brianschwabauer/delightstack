import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.session) throw redirect(307, '/signin');
	if (!locals.org_id) throw redirect(307, '/signin?toast=Please+create+or+join+a+family+first');

	return {};
};
