import type { Handle, HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { createAuthHandle, type AuthServer } from '@delightstack/auth/server';
import type { AuthLocals } from '@delightstack/auth/server';
import { ApiError } from '@delightstack/utilities';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';

/**
 * Auth handle — decodes JWT, refreshes expired sessions, resolves org,
 * populates event.locals with AuthLocals, and serves /api/auth/* routes.
 */
const authHandle = createAuthHandle({
	config: {
		secret: env.JWT_KEY_SECRET,
		issuer: 'foreverfamily',
		permission_map: {},
		oauth_capability_map: {},
		dev,
		cookies: {
			session_name: 'foreverfamily-session',
			org_name: 'foreverfamily-org',
		},
	},
	getAuthServer: (event) => {
		const platform = event.platform as App.Platform;
		const id = platform.env.AUTH.idFromName('main');
		return platform.env.AUTH.get(id) as unknown as AuthServer;
	},
});

/**
 * App-specific handle — initializes platform bindings (DB, WS, KV, R2)
 * that depend on the auth session being resolved first.
 */
const appHandle: Handle = async ({ event, resolve }) => {
	const platform = event.platform as App.Platform | undefined;
	if (!platform) return resolve(event);

	const locals = event.locals as AuthLocals & App.Locals;

	// Platform bindings
	event.locals.kv = platform.env.KV;
	event.locals.r2 = platform.env.R2;

	// Lazy org database durable object
	const org_id = locals.org_id;
	let _cached_db: App.Locals['db'];
	Object.assign(event.locals, {
		get db() {
			if (!_cached_db) {
				if (!org_id) return undefined;
				const db_binding = locals.org?.db
					? platform.env.DB.idFromString(locals.org.db)
					: platform.env.DB.idFromName(org_id);
				_cached_db = platform.env.DB.get(db_binding);
			}
			return _cached_db;
		},
	});

	return resolve(event);
};

export const handle = sequence(authHandle, appHandle);

export const handleError: HandleServerError = ({ error }) => {
	return ApiError.from(error);
};
