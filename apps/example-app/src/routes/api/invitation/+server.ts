import { DelightError } from '@packages/lib';
import {
	CreateOrgInvitation,
	decodePermissions,
	encodePermissions,
} from '@packages/types';
import { json } from '@sveltejs/kit';

export async function GET({ locals }) {
	if (!locals.authState.id || !locals.authState.token || !locals.authState.orgID) {
		throw new DelightError({
			message: `You must be signed in to list invitations`,
			status: 401,
		});
	}
	if (!locals.authState.isAllowed('org:write')) {
		throw new DelightError({
			message: `You must be an admin to list invitations`,
			status: 403,
		});
	}

	const invitations = await locals.auth.listInvitations(locals.authState.orgID, {
		limit: 100,
	});
	return json(invitations);
}

export async function POST({ request, locals }) {
	if (!locals.authState.id || !locals.authState.token || !locals.authState.orgID) {
		throw new DelightError({
			message: `You must be signed in to create invitations`,
			status: 401,
		});
	}
	if (!locals.authState.isAllowed('org:write')) {
		throw new DelightError({
			message: `You must be an admin to create invitations`,
			status: 403,
		});
	}
	const invitation = CreateOrgInvitation.parse(await request.json());
	const permission = encodePermissions(decodePermissions(invitation.permission));
	if (!permission) {
		throw new DelightError({ message: `Invalid invitation permission`, status: 400 });
	}
	if (invitation.expires_at && invitation.expires_at < Date.now()) {
		throw new DelightError({
			message: `Invitation has expiration date in the past`,
			status: 400,
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
