import type { AuthLocals } from '@delightstack/auth/server';
import { error } from '@sveltejs/kit';

const SUPER_ADMINS = ['brian@brianschwabauer.com', 'brianschwabauer1@gmail.com'];

export async function load({ locals }) {
	const { user } = locals as AuthLocals;
	if (
		!SUPER_ADMINS.includes(user?.email || '') ||
		!user?.verified
	) {
		throw error(401, 'Unauthorized');
	}
	return {};
}
