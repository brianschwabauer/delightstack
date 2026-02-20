import { AuthClient } from '@delightstack/auth/client';

export async function load({ data }) {
	return { auth: new AuthClient(data.auth) };
}
