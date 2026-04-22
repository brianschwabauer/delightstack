import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, parent }) => {
	const { db } = await parent();
	const person = db.entity('person', params.person_id);
	await person.load();
	if (!person.loaded) error(404, 'Person not found');
	return {};
};
