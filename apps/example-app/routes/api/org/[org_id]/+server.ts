import { apiError } from '@packages/lib';
import { UpdateOrg } from '@packages/types';

export async function PATCH({ request, locals, params }) {
	const org_id = params.org_id;
	if (!locals.db) {
		throw apiError({ status: 500, message: `Server not available` });
	}
	const current_org = await locals.db.getOrg();
	if (!current_org) {
		throw apiError({ status: 500, message: `Couldn't find organization database` });
	}
	if (current_org.id !== org_id) {
		throw apiError({ status: 500, message: `Organization's database id doesn't match` });
	}
	if (current_org.owner_id !== locals.authState.id) {
		throw apiError({
			status: 403,
			message: `You must be the owner of the organization to update it`,
		});
	}
	const org = UpdateOrg.partial().parse(await request.json());
	if (Object.keys(org).length === 0) return new Response(null, { status: 204 });

	// Save the org data in the database
	await locals.db.updateOrg({ ...org }, { user_id: locals.authState.id });

	return new Response(null, { status: 204 });
}

export async function DELETE({ locals, platform, params, cookies }) {
	if (!platform?.env?.SERVER || !locals.auth) {
		throw apiError({ status: 500, message: `Server not available` });
	}
	if (!locals.authState.id || !locals.authState.token) {
		throw apiError({
			status: 401,
			message: `You must be signed in to delete an organization`,
		});
	}

	// Check if the user's session has been revoked
	if (locals.authState.user_session_id) {
		const session = await locals.auth
			.getSession(locals.authState.user_session_id)
			.catch(() => {
				cookies.delete('foreverfamily-session', { path: '/' });
				cookies.delete('foreverfamily-org', { path: '/' });
				throw apiError({
					status: 401,
					message: `You must sign in again to delete this organization`,
				});
			});
		if (session.created_at < Date.now() - 1000 * 60 * 12) {
			throw apiError({
				status: 401,
				message: `For security reasons, you must have recently signed in to delete your account. Please sign out/in and try again.`,
			});
		}
	}

	const org = await locals.auth.getOrg(params.org_id);
	if (!org) {
		throw apiError({ status: 404, message: `Organization not found` });
	}
	if (org.owner_id !== locals.authState.id) {
		throw apiError({
			status: 403,
			message: `You must be the owner of an organization to delete it`,
		});
	}
	await locals.auth.markOrgDeleted(org.id, false);
	try {
		await platform.env.SERVER.runWorkflow('delete-org', {
			org_id: params.org_id,
		});
	} catch (error) {
		await locals.auth.markOrgDeleted(org.id, true);
		throw apiError({ status: 500, message: 'Failed to start workflow' });
	}
	if (locals.ws) {
		locals.ws.broadcast({
			event: 'entity:deleted',
			entity_type: 'org',
			entity_id: org.id,
			user_id: locals.authState.id,
		});
	}
	const refreshed = await locals.auth
		.refreshSession(locals.authState.token.jti, locals.authState.meta)
		.catch(() => undefined);
	if (refreshed?.jwt) {
		cookies.set('foreverfamily-session', refreshed.jwt, { path: '/' });
	} else {
		cookies.delete('foreverfamily-session', { path: '/' });
		cookies.delete('foreverfamily-org', { path: '/' });
	}
	return new Response(null, { status: 204 });
}
