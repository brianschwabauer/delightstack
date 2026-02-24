import { DelightError } from '@packages/lib';

export async function DELETE({ locals, params }) {
	if (!locals.authState.id) {
		throw new DelightError({
			message: `Must be signed in to revoke a session`,
			status: 401,
		});
	}
	const user_auth_id = params.user_auth_id;
	const signInMethod = await locals.auth
		.getSignInMethod(user_auth_id)
		.catch(() => undefined);
	if (!signInMethod) {
		throw new DelightError({ message: `Sign in method not found`, status: 403 });
	}
	await locals.auth.revokeSignInMethod(user_auth_id);
	if (locals.ws) {
		locals.ws.broadcast({
			event: 'session:revoked',
			user_id: locals.authState.id,
			user_name: locals.authState.name,
			user_auth_id,
		});
	}
	return new Response(null, { status: 204 });
}
