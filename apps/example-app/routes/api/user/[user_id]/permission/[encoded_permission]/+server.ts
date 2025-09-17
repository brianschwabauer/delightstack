import { apiError } from '@packages/lib';
import { decodePermissions, encodePermissions } from '@packages/types';

export async function PUT({ locals, params }) {
	if (!locals.authState.id) {
		throw apiError({ status: 401, message: `Must be signed in to update a permission` });
	}
	if (!locals.authState.orgID || !locals.authState.isAllowed('org:write')) {
		throw apiError({
			status: 403,
			message: `Must be an organization admin to update a permission`,
		});
	}
	const user_id = params.user_id;
	if (locals.authState.org?.owner_id === user_id) {
		throw apiError({
			status: 403,
			message: `You cannot update the permissions of the owner of the organization`,
		});
	}
	const permissions = decodePermissions(parseInt(params.encoded_permission));

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
