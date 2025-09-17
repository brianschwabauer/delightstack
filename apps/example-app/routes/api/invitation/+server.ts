import { apiError } from '@packages/lib';
import {
	CreateOrgInvitation,
	decodePermissions,
	encodePermissions,
} from '@packages/types';
import { json } from '@sveltejs/kit';

export async function GET({ locals }) {
	if (!locals.authState.id || !locals.authState.token || !locals.authState.orgID) {
		throw apiError({
			status: 401,
			message: `You must be signed in to list invitations`,
		});
	}
	if (!locals.authState.isAllowed('org:write')) {
		throw apiError({
			status: 403,
			message: `You must be an admin to list invitations`,
		});
	}

	const invitations = await locals.auth.listInvitations(locals.authState.orgID, {
		limit: 100,
	});
	return json(invitations);
}

export async function POST({ request, locals }) {
	if (!locals.authState.id || !locals.authState.token || !locals.authState.orgID) {
		throw apiError({
			status: 401,
			message: `You must be signed in to create invitations`,
		});
	}
	if (!locals.authState.isAllowed('org:write')) {
		throw apiError({
			status: 403,
			message: `You must be an admin to create invitations`,
		});
	}
	const invitation = CreateOrgInvitation.parse(await request.json());
	const permission = encodePermissions(decodePermissions(invitation.permission));
	if (!permission) {
		throw apiError({ status: 400, message: `Invalid invitation permission` });
	}
	if (invitation.expires_at && invitation.expires_at < Date.now()) {
		throw apiError({
			status: 400,
			message: `Invitation has expiration date in the past`,
		});
	}
	const created_invitation = await locals.auth.createInvitation({
		org_id: locals.authState.orgID,
		permission,
		user_id: locals.authState.id,
		email: invitation.email || undefined,
		max_redemptions: invitation.max_redemptions,
		expires_at: invitation.expires_at || undefined,
	});
	return json(created_invitation, { status: 201 });
}
