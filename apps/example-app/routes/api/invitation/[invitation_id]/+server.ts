import { apiError } from '@packages/lib';
import { decodePermissions } from '@packages/types';
import { encodePermissions } from '@packages/types';
import { CreateOrgInvitation } from '@packages/types';
import { json } from '@sveltejs/kit';

/** Get an existing org invitation */
export async function GET({ locals, params }) {
	if (!locals.authState.id || !locals.authState.token || !locals.authState.orgID) {
		throw apiError({
			status: 401,
			message: `You must be signed in to retrieve invitations`,
		});
	}
	if (!locals.authState.isAllowed('org:write')) {
		throw apiError({
			status: 403,
			message: `You must be an admin to retrieve invitations`,
		});
	}

	const invitation_id = params.invitation_id;
	const invitation = await locals.auth.getInvitation(invitation_id); // @throws if doesn't exist
	if (invitation.org_id !== locals.authState.orgID) {
		throw apiError({
			status: 403,
			message: `You must be an admin to retrieve this invitation`,
		});
	}
	return json(invitation);
}

/** Update an existing org invitation */
export async function PATCH({ request, locals, params }) {
	if (!locals.authState.id || !locals.authState.token || !locals.authState.orgID) {
		throw apiError({
			status: 401,
			message: `You must be signed in to update invitations`,
		});
	}
	if (!locals.authState.isAllowed('org:write')) {
		throw apiError({
			status: 403,
			message: `You must be an admin to update invitations`,
		});
	}
	const invitation_id = params.invitation_id;
	const invitation = await locals.auth.getInvitation(invitation_id); // @throws if doesn't exist
	if (invitation.org_id !== locals.authState.orgID) {
		throw apiError({
			status: 403,
			message: `You must be an admin to update this invitation`,
		});
	}

	const updates = CreateOrgInvitation.partial().parse(await request.json());
	if (Object.keys(updates).length === 0) return json(invitation);
	if (updates.permission) {
		const permission = encodePermissions(decodePermissions(invitation.permission));
		if (!permission) {
			throw apiError({ status: 400, message: `Invalid invitation permission` });
		}
		updates.permission = permission;
	}
	if (typeof updates.expires_at === 'number' && updates.expires_at < Date.now()) {
		throw apiError({
			status: 400,
			message: `Invitation has expiration date in the past`,
		});
	}

	const updated = await locals.auth.updateInvitation(invitation_id, updates);
	return json(updated);
}

/** Delete an existing org invitation */
export async function DELETE({ locals, params }) {
	if (!locals.authState.id || !locals.authState.token || !locals.authState.orgID) {
		throw apiError({
			status: 401,
			message: `You must be signed in to delete invitations`,
		});
	}
	if (!locals.authState.isAllowed('org:write')) {
		throw apiError({
			status: 403,
			message: `You must be an admin to delete invitations`,
		});
	}
	const invitation_id = params.invitation_id;
	const invitation = await locals.auth.getInvitation(invitation_id); // @throws if doesn't exist
	if (invitation.org_id !== locals.authState.orgID) {
		throw apiError({
			status: 403,
			message: `You must be an admin to delete this invitation`,
		});
	}

	await locals.auth.deleteInvitation(invitation_id);
	return new Response(null, { status: 204 });
}
