import { DelightError } from '@packages/lib';

export async function DELETE({ locals, params }) {
	if (!locals.authState.id) {
		throw new DelightError({
			message: `Must be signed in to revoke a session`,
			status: 401,
		});
	}
	const session_id = params.session_id;
	const session = await locals.auth.getSession(session_id).catch(() => undefined);
	if (!session) {
		throw new DelightError({ message: `Session not found`, status: 403 });
	}
	await locals.auth.revokeSession(session_id);
	if (locals.ws) {
		locals.ws.broadcast({
			event: 'session:revoked',
			user_id: session.user_id,
			user_name: locals.authState.name,
			user_auth_id: session.user_auth_id,
			user_session_id: session_id,
		});
	}
	return new Response(null, { status: 204 });
}
