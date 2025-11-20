import type { OrgInvitation } from '@packages/types';

export async function load({ locals }) {
	if (!locals.authState.id || !locals.authState.orgID) {
		return {
			accounts: [],
			sessions: [],
			sign_in_methods: [],
			org_users: [],
			oauth_applications: [],
			invitations: [],
		};
	}
	const user_id: string = locals.authState.id;
	const org_id: string = locals.authState.orgID;
	const [
		sessions,
		accounts,
		sign_in_methods,
		org_users,
		oauth_applications,
		invitations,
	] = await Promise.all([
		locals.auth.listSessions(user_id).then((res) =>
			res.list.map((v) => ({
				...v,
				is_current: v.id === locals.authState.user_session_id,
			})),
		),
		locals.auth.listOauthAccounts(user_id, org_id).then((res) => res.list),
		locals.auth.listSignInMethods(user_id).then((res) => res.list),
		locals.auth.listOrgUsers(locals.authState.orgID).then((res) => res.list),
		locals.auth.listAuthorizedOauthApplications(org_id, user_id).then((res) => res.list),
		(async () => {
			if (!locals.authState.isAllowed('org:write')) return [];
			const invitations = await locals.auth.listInvitations(org_id, {
				limit: 100,
			});
			return invitations.list as OrgInvitation[];
		})(),
	]);
	return {
		accounts,
		sessions,
		sign_in_methods,
		org_users,
		oauth_applications,
		invitations,
	};
}
