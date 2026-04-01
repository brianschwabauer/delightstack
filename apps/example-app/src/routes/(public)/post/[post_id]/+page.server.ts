import { error } from '@sveltejs/kit';
import { DelightError } from '@delightstack/utilities';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { post_id } = params;

	if (!locals.db) {
		throw error(404, 'Post not found');
	}

	try {
		const post = await locals.db.get('post', post_id);
		if (!post || !post.is_public) {
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
