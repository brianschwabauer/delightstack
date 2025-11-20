import { apiError } from '@packages/lib';

export async function DELETE({ locals, params }) {
	if (!locals.authState.id) {
		throw apiError({ status: 401, message: `Must be signed in to revoke a session` });
	}
	const user_auth_id = params.user_auth_id;
	const signInMethod = await locals.auth
		.getSignInMethod(user_auth_id)
		.catch(() => undefined);
	if (!signInMethod) {
		throw apiError({ status: 403, message: `Sign in method not found` });
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
