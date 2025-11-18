import { dev } from '$app/environment';
import { proxyDurableObject } from '$lib/utility/rpc.helper';
import { ApiError, generateID } from '@packages/lib';
import { apiError } from '@packages/lib';
import { Org } from '@packages/types';
import { json } from '@sveltejs/kit';

export async function POST({ locals, request, cookies, platform }) {
	if (!locals.authState.id || !locals.authState.user_session_id) {
		throw apiError({
			status: 401,
			message: `Must be signed in to create an organization`,
		});
	}
	if (!platform) {
		throw apiError({
			status: 500,
			message: `Cloudflare platform not available`,
		});
	}

	// Check if the user's session has been revoked
	if (locals.authState.user_session_id) {
		await locals.auth.getSession(locals.authState.user_session_id).catch(() => {
			cookies.delete('foreverfamily-session', { path: '/' });
			cookies.delete('foreverfamily-org', { path: '/' });
			throw apiError({
				status: 401,
				message: `You must sign in again to create an organization`,
			});
		});
	}

	const unsafe_body = await request.json<any>();
	const orgName = Org.pick({ name: true }).parse(unsafe_body).name;
	const org_id = generateID();
	const db_id = platform.env.DB.idFromName(org_id);
	const db = dev
		? proxyDurableObject<NonNullable<App.Locals['db']>>(platform.env.DB.get(db_id))
		: (platform.env.DB.get(db_id) as unknown as NonNullable<App.Locals['db']>);
	const now = Date.now();
	const org: Org = {
		capability: 0,
		owner_id: locals.authState.id,
		name: orgName,
		created_at: now,
		updated_at: now,
		id: org_id,
		storage: 0,
		storage_usage: 0,
	};
	await locals.auth.createOrg({
		id: org.id,
		name: org.name,
		owner_id: org.owner_id,
		created_at: now,
		updated_at: now,
		json: JSON.stringify(org),
	});
	try {
		await db.updateOrg({
			...org,
			id: org_id,
		});
		if (locals.authState.name) {
			await db
				.create('person', {
					name: locals.authState.name,
					user_id: locals.authState.id,
					email: locals.authState.email,
				})
				.catch(() => undefined);
		}
	} catch (error) {
		await locals.auth.deleteOrg(org_id).catch(() => undefined);
		throw ApiError.from(error);
	}

	const session = await locals.auth
		.refreshSession(locals.authState.user_session_id, locals.authState.meta)
		.catch(() => undefined);
	if (session) {
		cookies.set('foreverfamily-session', session.jwt, { path: '/' });
		cookies.set('foreverfamily-org', org_id, { path: '/' });
	} else {
		cookies.delete('foreverfamily-session', { path: '/' });
		cookies.delete('foreverfamily-org', { path: '/' });
	}

	return json(org);
}

export async function DELETE({ platform, locals, cookies }) {
	if (!platform?.env?.SERVER || !locals.auth) {
		throw apiError({ status: 500, message: `Server not available` });
	}
	if (!locals.authState.id) {
		throw apiError({
			status: 401,
			message: `You must be signed in to delete your account`,
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
					message: `You must be signed in to delete your account`,
				});
			});
		if (session.created_at < Date.now() - 1000 * 60 * 12) {
			throw apiError({
				status: 401,
				message: `For security reasons, you must have recently signed in to delete your account. Please sign out/in and try again.`,
			});
		}
	}

	const user = await locals.auth.getUser(locals.authState.id);
	if (!user) {
		throw apiError({ status: 404, message: `User not found` });
	}
	await locals.auth.revokeUserSessions(locals.authState.id).catch(() => undefined);
	await locals.auth.markUserDeleted(locals.authState.id);
	if (locals.ws) {
		locals.ws.broadcast({
			event: 'entity:deleted',
			entity_type: 'user',
			entity_id: locals.authState.id,
			user_id: locals.authState.id,
		});
	}
	try {
		await platform.env.SERVER.runWorkflow('delete-user', {
			user_id: locals.authState.id,
		});
	} catch (error) {
		await locals.auth.markUserDeleted(locals.authState.id, true);
		throw apiError({ status: 500, message: 'Failed to start workflow' });
	}
	cookies.delete('foreverfamily-session', { path: '/' });
	cookies.delete('foreverfamily-org', { path: '/' });
	return new Response(null, { status: 204 });
}
