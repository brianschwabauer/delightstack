import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, parent, depends }) => {
	depends(`post:${params.post_id}`);
	const { db } = await parent();
	const post = await db.get('post', params.post_id);
	if (!post) error(404, 'Post not found');
	return { post };
};
