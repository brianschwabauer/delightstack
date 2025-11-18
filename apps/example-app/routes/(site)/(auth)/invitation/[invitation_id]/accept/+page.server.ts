import { ApiError } from '@packages/lib';
import { error, redirect } from '@sveltejs/kit';

export async function load({ locals, params, cookies }) {
	const invitation = await locals.auth
		.getInvitation(params.invitation_id)
		.catch((err) => {
			const parsed = ApiError.from(err);
			throw error(parsed.status, parsed.messageText);
		});
	if (!locals.authState.id || !locals.authState.user_session_id) {
		throw redirect(307, `/invitation/${invitation.id}`);
	}
	if (locals.authState.org_ids.includes(invitation.org_id)) {
		throw redirect(307, `/${invitation.org_id}/dashboard`);
	}
	await locals.auth.acceptInvitation(invitation.id, locals.authState.id).catch((err) => {
		const parsed = ApiError.from(err);
		throw error(parsed.status, parsed.messageText);
	});
	const session = await locals.auth
		.refreshSession(locals.authState.user_session_id, locals.authState.meta)
		.catch(() => undefined);
	if (session) {
		cookies.set('foreverfamily-session', session.jwt, { path: '/' });
		cookies.set('foreverfamily-org', invitation.org_id, { path: '/' });
		if (locals.ws) {
			locals.ws.broadcast({
				event: 'session:updated',
				user_id: locals.authState.id,
				user_name: locals.authState.name,
				user_session_id: locals.authState.user_session_id,
				user_auth_id: locals.authState.user_auth_id,
				org_id: invitation.org_id,
				permission: invitation.permission,
			});
		}
	} else {
		cookies.delete('foreverfamily-session', { path: '/' });
		cookies.delete('foreverfamily-org', { path: '/' });
		if (locals.ws) {
			locals.ws.broadcast({
				event: 'session:revoked',
				user_id: locals.authState.id,
				user_name: locals.authState.name,
				user_session_id: locals.authState.user_session_id,
				user_auth_id: locals.authState.user_auth_id,
			});
		}
	}
	throw redirect(307, `/${invitation.org_id}/dashboard`);
}
