import { DelightError } from '@packages/lib';
import { decodePermissions, encodePermissions } from '@packages/types';

export async function DELETE({ locals, params }) {
	if (!locals.authState.id) {
		throw new DelightError({
			message: `Must be signed in to update a permission`,
			status: 401,
		});
	}
	if (!locals.authState.orgID || !locals.authState.isAllowed('org:write')) {
		throw new DelightError({
			message: `Must be an organization admin to update a permission`,
			status: 403,
		});
	}
	const user_id = params.user_id;
	if (locals.authState.org?.owner_id === user_id) {
		throw new DelightError({
			message: `You cannot update the permissions of the owner of the organization`,
			status: 403,
		});
	}
	const permissions = decodePermissions(0);
	await locals.auth.updateUserRole(user_id, locals.authState.orgID, permissions);
	if (locals.ws) {
		locals.ws.broadcast({
			event: 'session:updated',
			user_id,
			user_name: locals.authState.name,
			user_session_id: locals.authState.user_session_id,
			user_auth_id: locals.authState.user_auth_id,
			org_id: locals.authState.orgID,
			permission: encodePermissions(permissions),
		});
	}
	return new Response(null, { status: 204 });
}
