import type { Handle, HandleFetch, HandleServerError } from '@sveltejs/kit';
import {
	ApiError,
	apiError,
	decodeJwt,
	extractJwtRefreshToken,
	getOauthToken,
	OAUTH_VENDOR,
	type OauthVendor,
} from '@packages/lib';
import { env } from '$env/dynamic/private';
import { AuthState } from '$lib/state';
import { proxyDurableObject } from '$lib/utility/rpc.helper';
import {
	OauthConfig,
	OauthToken,
	Org,
	type SessionToken,
	type UserSessionMeta,
} from '@packages/types';
import { dev } from '$app/environment';
import { UAParser } from 'ua-parser-js';
import { PUBLIC_ENVIRONMENT } from '$env/static/public';

export const handle: Handle = async ({ event, resolve }) => {
	const { platform, cookies, request, url, params } = event;
	console.log('handling', url.href);
	if (!platform) {
		return new Response(JSON.stringify({ status: 500, message: 'Platform not found' }), {
			status: 500,
		});
	}
	let jwt =
		cookies.get('foreverfamily-session') ||
		request.headers.get('Authorization')?.match(/Bearer\s+([^\s;]+)/)?.[1] ||
		url.searchParams.get('auth') ||
		undefined;

	// Get the user's session meta data
	const user_agent = request.headers.get('User-Agent') || undefined;
	let parsedUA: any;
	try {
		parsedUA = new UAParser(user_agent).getResult();
	} catch (error) {
		// ignore
	}
	const meta = {
		ip_address: event.getClientAddress() || undefined,
		city: <string>platform?.cf?.city || undefined,
		country: <string>platform?.cf?.country || undefined,
		latitude: <string>platform?.cf?.latitude || undefined,
		longitude: <string>platform?.cf?.longitude || undefined,
		region: <string>platform?.cf?.region || <string>platform?.cf?.regionCode || undefined,
		timezone: <string>platform?.cf?.timezone || undefined,
		user_agent,
		browser: parsedUA?.browser?.name || undefined,
		os: parsedUA?.os?.name || undefined,
		device:
			[parsedUA?.device?.vendor, parsedUA?.device?.model].filter(Boolean).join(' ') ||
			undefined,
	} as UserSessionMeta;

	// Initialize the auth database durable object
	let _cached_auth: App.Locals['auth'];
	Object.assign(event.locals, {
		get auth() {
			if (!_cached_auth) {
				const authDurableObjectID = platform.env.AUTH.idFromName('main');
				const auth = platform.env.AUTH.get(authDurableObjectID);
				_cached_auth = dev ? proxyDurableObject<App.Locals['auth']>(auth) : auth;
			}
			return _cached_auth;
		},
	});

	// Decode the JWT token and refresh if expired
	let authToken: SessionToken<'auth'> | SessionToken<'oauth_application'> | undefined;
	try {
		if (jwt) authToken = await decodeJwt<'auth'>(env.JWT_KEY_SECRET, jwt);
	} catch (error: any) {
		console.log('Error decoding JWT', error);
		if (error?.detail === 'auth/expired' && jwt) {
			let refreshed;
			try {
				const user_session_id = extractJwtRefreshToken(jwt);
				refreshed = await event.locals.auth.refreshSession(user_session_id, meta);
			} catch (error) {
				console.log(`Error refreshing JWT`, error);
			}
			jwt = refreshed?.jwt;
			authToken = refreshed?.decoded_jwt;
		} else {
			authToken = undefined;
			jwt = undefined;
		}
	}

	// Update the cookie if the JWT has changed
	if (authToken?.typ !== 'oauth_application') {
		if (authToken && jwt) {
			if (cookies.get('foreverfamily-session') !== jwt) {
				cookies.set('foreverfamily-session', jwt, { path: '/' });
			}
		} else {
			if (!!cookies.get('foreverfamily-session')) {
				cookies.delete('foreverfamily-session', { path: '/' });
			}
			if (!!cookies.get('foreverfamily-org')) {
				cookies.delete('foreverfamily-org', { path: '/' });
			}
		}
	}

	// Determine the orgID from the request
	let orgID =
		params.org_id ||
		url.pathname.match(/^\/(\w+)\/dashboard/)?.[1] ||
		url.pathname.match(/^\/org\/(\w+)/)?.[1] ||
		url.searchParams.get('orgID') ||
		url.searchParams.get('org') ||
		request.headers.get('Org-ID') ||
		request.headers.get('OrgID') ||
		request.headers.get('Org') ||
		cookies.get('foreverfamily-org') ||
		undefined;
	if (authToken?.typ === 'oauth_application') {
		orgID = authToken.sub; // The oauth application token's sub is the org ID
	} else if (orgID === undefined) {
		const orgs = Array.from(new Set([...Object.keys(authToken?.org || {})])).sort(
			(a, b) => (authToken?.org?.[b]?.role || 0) - (authToken?.org?.[a]?.role || 0),
		);
		if (orgs.length === 1) orgID = orgs[0];
	}
	orgID = orgID !== 'null' ? orgID : undefined;

	// Make sure the user has access to the org
	if (authToken?.typ !== 'oauth_application') {
		if (orgID && !authToken?.org?.[orgID]?.role) {
			orgID = undefined;
		}
	}

	// Add the initialized objects to the event.locals
	event.locals.imageProcessor = platform.env.IMAGE_PROCESSOR;
	event.locals.kv = platform.env.KV;
	event.locals.r2 = platform.env.R2;

	// Initialize the org database durable object
	let _cached_db: App.Locals['db'];
	Object.assign(event.locals, {
		get db() {
			if (!_cached_db) {
				const db_id = !orgID
					? undefined
					: authToken && 'org' in authToken && authToken?.org?.[orgID].db
						? platform.env.DB.idFromString(authToken?.org?.[orgID].db)
						: platform.env.DB.idFromName(orgID);
				const db = db_id ? platform.env.DB.get(db_id) : undefined;
				_cached_db =
					dev && db ? proxyDurableObject<NonNullable<App.Locals['db']>>(db) : db;
			}
			return _cached_db;
		},
	});

	// Initialize the websocket durable object
	let _cached_ws: App.Locals['ws'];
	Object.assign(event.locals, {
		get ws() {
			if (!_cached_ws) {
				const ws = orgID
					? platform.env.WS.get(platform.env.WS.idFromName(orgID))
					: undefined;
				_cached_ws =
					dev && ws ? proxyDurableObject<NonNullable<App.Locals['ws']>>(ws) : ws;
			}
			return _cached_ws;
		},
	});

	// Add the org to the event.locals
	let _cached_org: Promise<Org | undefined> | undefined = undefined;
	Object.assign(event.locals, {
		get org() {
			if (!orgID) return;
			if (!_cached_org) _cached_org = event.locals.db?.getOrg();
			return _cached_org;
		},
	});

	// Add the auth state to the event.locals
	event.locals.authState = new AuthState(
		jwt,
		authToken,
		orgID,
		await event.locals.org,
		meta,
	);

	// Initialize the vendor api getter function
	event.locals.getVendorApi = async <Vendor extends OauthVendor>(
		vendor: Vendor,
		oauth_token_id?: string,
		required_permissions?: Permissions[],
	) => {
		let config: OauthConfig | undefined;
		try {
			const keys = JSON.parse(env.OAUTH_KEYS);
			if (keys[vendor]) {
				config = OauthConfig.parse({ ...keys[vendor], environment: PUBLIC_ENVIRONMENT });
			}
		} catch (error) {
			console.error(`Error parsing oauth config`, error);
		}
		if (!config) {
			throw apiError({ status: 500, message: `Oauth config not found for ${vendor}` });
		}
		if (required_permissions) {
			if (!oauth_token_id) {
				throw apiError({ status: 400, message: `Oauth token ID not provided` });
			}
			if (!event.locals.authState.id || !event.locals.authState.orgID) {
				throw apiError({
					status: 401,
					message: `You must be signed in to access your ${vendor} account`,
				});
			}
			const { list: permissions } = await event.locals.auth.getOauthAccountPermissions(
				event.locals.authState.id,
				event.locals.authState.orgID,
				oauth_token_id,
			);
			required_permissions.forEach((permission) => {
				if (!permissions.includes(permission as any)) {
					throw apiError({
						status: 403,
						message: `Not enough permissions to access this ${vendor} account`,
					});
				}
			});
		}
		let token: OauthToken | undefined = undefined;
		if (oauth_token_id) {
			token = (await event.locals.auth.getOauthToken(
				oauth_token_id,
			)) as unknown as OauthToken;
			if (!token) {
				throw apiError({ status: 404, message: `Oauth token not found` });
			}
			if (
				token.access_token_expires_at &&
				token.access_token_expires_at < Date.now() + 1000 * 60 * 5
			) {
				const new_token = await getOauthToken(config, token);
				token = (await event.locals.auth.updateOauthToken(
					oauth_token_id,
					new_token,
				)) as unknown as OauthToken;
				if (!token) {
					throw apiError({ status: 500, message: `Couldn't refresh oauth token` });
				}
			}
		}
		return new OAUTH_VENDOR[vendor](config, token) as InstanceType<
			(typeof OAUTH_VENDOR)[Vendor]
		>;
	};

	const response = await resolve(event);
	if (
		response.status === 500 &&
		response.headers.get('content-type')?.startsWith('application/json')
	) {
		// Handle throw errors in the app (using the format throw {status, message})
		const body: any = await response.json().catch(() => undefined);
		const error = ApiError.from(body);
		return new Response(error.toJSON(), {
			status: error.status || 500,
			headers: {
				'Content-Type': 'application/json',
				'Error-Message': (error.toString() || 'Unknown Error').trim().replace(/\n/g, ''),
			},
		});
	}

	if (!response.headers.get('content-type')) {
		try {
			response.headers.set('Content-Type', 'application/json');
		} catch (error) {
			// Ignore this error. This can happen if the response headers are 'immutable'
			// A response headers is immutable if the response is generrated from a fetch request
		}
	}
	return response;
};

export const handleError: HandleServerError = ({ error, status, message }) => {
	return ApiError.from(error);
};

export const handleFetch: HandleFetch = async ({ request, fetch, event }) => {
	// if (request.method !== 'GET') return fetch(request);
	// const { entities, rtdb } = event.locals;
	// const url = new URL(request.url);
	// const urlParts = url.pathname.match(/^\/api\/([\w-]+)(?:\/([\w-]+))?/);

	// if (urlParts) {
	// 	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	// 	const [_, entity, id] = urlParts;
	// 	if (entity === 'client') {
	// 		return json(await entities.client.get(id));
	// 	}
	// 	if (entity === 'project') {
	// 		return json(await entities.project.get(id));
	// 	}
	// 	if (entity === 'user' && id && url.pathname.endsWith('/preferences')) {
	// 		return json(await rtdb.get(`/user/${id}/status`));
	// 	}
	// }

	console.log('handleFetch', request.url);
	return fetch(request);
};
