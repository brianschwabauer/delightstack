import { error } from '@sveltejs/kit';

const SUPER_ADMINS = ['brian@brianschwabauer.com', 'brianschwabauer1@gmail.com'];

export async function load({ locals }) {
	if (
		!SUPER_ADMINS.includes(locals.authState.email || '') ||
		!locals.authState.verified
	) {
		throw error(401, 'Unauthorized');
	}
	return {};
}
