import { dev } from '$app/environment';
import { proxyDurableObject } from '$lib/utility/rpc.helper';
import { DelightError, generateID } from '@packages/lib';
import { Org } from '@packages/types';
import { json } from '@sveltejs/kit';

export async function POST({ locals, request, cookies, platform }) {
	if (!locals.authState.id || !locals.authState.user_session_id) {
		throw new DelightError({
			message: `Must be signed in to create an organization`,
			status: 401,
		});
	}
	if (!platform) {
		throw new DelightError({
			message: `Cloudflare platform not available`,
			status: 500,
		});
	}

	// Check if the user's session has been revoked
	if (locals.authState.user_session_id) {
		await locals.auth.getSession(locals.authState.user_session_id).catch(() => {
			cookies.delete('foreverfamily-session', { path: '/' });
			cookies.delete('foreverfamily-org', { path: '/' });
			throw new DelightError({
				message: `You must sign in again to create an organization`,
				status: 401,
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
		throw DelightError.from(error);
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
		throw new DelightError({ message: `Server not available`, status: 500 });
	}
	if (!locals.authState.id) {
		throw new DelightError({
			message: `You must be signed in to delete your account`,
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
					message: `You must be signed in to delete your account`,
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

	const user = await locals.auth.getUser(locals.authState.id);
	if (!user) {
		throw new DelightError({ message: `User not found`, status: 404 });
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
		throw new DelightError({ message: 'Failed to start workflow', status: 500 });
	}
	cookies.delete('foreverfamily-session', { path: '/' });
	cookies.delete('foreverfamily-org', { path: '/' });
	return new Response(null, { status: 204 });
}
