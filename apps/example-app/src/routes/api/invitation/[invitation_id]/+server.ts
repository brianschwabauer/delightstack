import { DelightError } from '@packages/lib';
import { decodePermissions } from '@packages/types';
import { encodePermissions } from '@packages/types';
import { CreateOrgInvitation } from '@packages/types';
import { json } from '@sveltejs/kit';

/** Get an existing org invitation */
export async function GET({ locals, params }) {
	if (!locals.authState.id || !locals.authState.token || !locals.authState.orgID) {
		throw new DelightError({
			message: `You must be signed in to retrieve invitations`,
			status: 401,
		});
	}
	if (!locals.authState.isAllowed('org:write')) {
		throw new DelightError({
			message: `You must be an admin to retrieve invitations`,
			status: 403,
		});
	}

	const invitation_id = params.invitation_id;
	const invitation = await locals.auth.getInvitation(invitation_id); // @throws if doesn't exist
	if (invitation.org_id !== locals.authState.orgID) {
		throw new DelightError({
			message: `You must be an admin to retrieve this invitation`,
			status: 403,
		});
	}
	return json(invitation);
}

/** Update an existing org invitation */
export async function PATCH({ request, locals, params }) {
	if (!locals.authState.id || !locals.authState.token || !locals.authState.orgID) {
		throw new DelightError({
			message: `You must be signed in to update invitations`,
			status: 401,
		});
	}
	if (!locals.authState.isAllowed('org:write')) {
		throw new DelightError({
			message: `You must be an admin to update invitations`,
			status: 403,
		});
	}
	const invitation_id = params.invitation_id;
	const invitation = await locals.auth.getInvitation(invitation_id); // @throws if doesn't exist
	if (invitation.org_id !== locals.authState.orgID) {
		throw new DelightError({
			message: `You must be an admin to update this invitation`,
			status: 403,
		});
	}

	const updates = CreateOrgInvitation.partial().parse(await request.json());
	if (Object.keys(updates).length === 0) return json(invitation);
	if (updates.permission) {
		const permission = encodePermissions(decodePermissions(invitation.permission));
		if (!permission) {
			throw new DelightError({ message: `Invalid invitation permission`, status: 400 });
		}
		updates.permission = permission;
	}
	if (typeof updates.expires_at === 'number' && updates.expires_at < Date.now()) {
		throw new DelightError({
			message: `Invitation has expiration date in the past`,
			status: 400,
		});
	}

	const updated = await locals.auth.updateInvitation(invitation_id, updates);
	return json(updated);
}

/** Delete an existing org invitation */
export async function DELETE({ locals, params }) {
	if (!locals.authState.id || !locals.authState.token || !locals.authState.orgID) {
		throw new DelightError({
			message: `You must be signed in to delete invitations`,
			status: 401,
		});
	}
	if (!locals.authState.isAllowed('org:write')) {
		throw new DelightError({
			message: `You must be an admin to delete invitations`,
			status: 403,
		});
	}
	const invitation_id = params.invitation_id;
	const invitation = await locals.auth.getInvitation(invitation_id); // @throws if doesn't exist
	if (invitation.org_id !== locals.authState.orgID) {
		throw new DelightError({
			message: `You must be an admin to delete this invitation`,
			status: 403,
		});
	}

	await locals.auth.deleteInvitation(invitation_id);
	return new Response(null, { status: 204 });
}
