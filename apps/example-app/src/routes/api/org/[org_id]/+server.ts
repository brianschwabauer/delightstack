import { DelightError } from '@packages/lib';
import { UpdateOrg } from '@packages/types';

export async function PATCH({ request, locals, params }) {
	const org_id = params.org_id;
	if (!locals.db) {
		throw new DelightError({ message: `Server not available`, status: 500 });
	}
	const current_org = await locals.db.getOrg();
	if (!current_org) {
		throw new DelightError({
			message: `Couldn't find organization database`,
			status: 500,
		});
	}
	if (current_org.id !== org_id) {
		throw new DelightError({
			message: `Organization's database id doesn't match`,
			status: 500,
		});
	}
	if (current_org.owner_id !== locals.authState.id) {
		throw new DelightError({
			message: `You must be the owner of the organization to update it`,
			status: 403,
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
		throw new DelightError({ message: `Server not available`, status: 500 });
	}
	if (!locals.authState.id || !locals.authState.token) {
		throw new DelightError({
			message: `You must be signed in to delete an organization`,
			status: 401,
		});
	}

	// Check if the user's session has been revoked
	if (locals.authState.user_session_id) {
		const session = await locals.auth
			.getSession(locals.authState.user_session_id)
			.catch(() => {
				cookies.delete('foreverfamily-session', { path: '/' });
				cookies.delete('foreverfamily-org', { path: '/' });
				throw new DelightError({
					message: `You must sign in again to delete this organization`,
					status: 401,
				});
			});
		if (session.created_at < Date.now() - 1000 * 60 * 12) {
			throw new DelightError({
				message: `For security reasons, you must have recently signed in to delete your account. Please sign out/in and try again.`,
				status: 401,
			});
		}
	}

	const org = await locals.auth.getOrg(params.org_id);
	if (!org) {
		throw new DelightError({ message: `Organization not found`, status: 404 });
	}
	if (org.owner_id !== locals.authState.id) {
		throw new DelightError({
			message: `You must be the owner of an organization to delete it`,
			status: 403,
		});
	}
	await locals.auth.markOrgDeleted(org.id, false);
	try {
		await platform.env.SERVER.runWorkflow('delete-org', {
			org_id: params.org_id,
		});
	} catch (error) {
		await locals.auth.markOrgDeleted(org.id, true);
		throw new DelightError({ message: 'Failed to start workflow', status: 500 });
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
