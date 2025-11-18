import { ApiError } from '@packages/lib';
import { error, redirect } from '@sveltejs/kit';

export async function load({ locals, params }) {
	let invitation;
	try {
		invitation = await locals.auth.getInvitationIfValid(params.invitation_id);
	} catch (err) {
		const parsed = ApiError.from(err);
		throw error(parsed.status, parsed.messageText);
	}
	const [user, org] = await Promise.all([
		locals.auth.getUser(invitation.user_id).catch(() => ({ name: 'Unknown' })),
		locals.auth.getOrg(invitation.org_id).catch(() => ({ name: 'Unknown' })),
	]);
	return {
		invitation: { ...invitation, userName: user.name, orgName: org.name },
	};
}
