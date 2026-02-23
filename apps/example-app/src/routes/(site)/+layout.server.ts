import type { AuthLocals } from '@delightstack/auth/server';

export async function load({ locals }) {
	const { jwt, session, org_id, preferences, org_state } = locals as AuthLocals;
	return {
		auth: { jwt, session, org_id, preferences, org_state },
	};
}
