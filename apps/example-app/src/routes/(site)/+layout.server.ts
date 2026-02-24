import type { AuthLocals } from '@delightstack/auth/server';

export async function load({ locals }) {
	return { auth: (locals as AuthLocals).auth_client_data };
}
