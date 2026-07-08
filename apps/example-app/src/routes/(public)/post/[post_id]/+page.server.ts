import { error } from '@sveltejs/kit';
import { DelightError } from '@delightstack/utilities';
import { postTable } from '$lib/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { post_id } = params;

	if (!locals.db) {
		throw error(404, 'Post not found');
	}

	try {
		const record = await locals.db.get('post', post_id);
		if (!record) {
			throw error(404, 'Post not found');
		}
		// The DO RPC returns an untyped record — parse it into the typed entity.
		const post = postTable.parse(record);
		if (!post.is_public) {
			throw error(404, 'Post not found');
		}
		return { post };
	} catch (e) {
		if (DelightError.is(e) && e.status === 404) {
			throw error(404, 'Post not found');
		}
		throw e;
	}
};
