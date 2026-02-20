import { z } from 'zod/v4';
import { ApiError, parseSchema, generateID } from '@delightstack/utilities';
import type { ResolvedAuthConfig } from './auth.config';
import type { AuthLocals, AuthServer } from './auth.handler';
import type { RequestEvent } from '@sveltejs/kit';
import type { UserSessionMeta } from '../types';
import { resolveErrorCode } from '../types/error.type';
import { EmailPasswordSignIn, EmailSignUp, UpdateUser } from '../types';
import { getOauthToken } from './oauth.helper';
import type { AuthOperationResult } from './auth.db.server';
import type { OauthToken } from '../types';

interface AuthRouteContext {
	event: RequestEvent;
	config: ResolvedAuthConfig;
	auth: AuthServer;
	locals: AuthLocals;
	meta: UserSessionMeta;
}

type AuthRouteHandler = (ctx: AuthRouteContext) => Promise<Response>;

/** Wraps a route handler with error handling */
async function handleRoute(
	ctx: AuthRouteContext,
	fn: () => Promise<Response>,
): Promise<Response> {
	try {
		return await fn();
	} catch (error) {
		const apiErr = ApiError.from(error);
		const code = resolveErrorCode({ detail: apiErr.detail, message: apiErr.messageText });
		return json(
			{
				code,
				message: apiErr.messageText,
				status: apiErr.status,
				detail: apiErr.detail,
				errors: apiErr.errors.length ? apiErr.errors : undefined,
			},
			apiErr.status || 500,
		);
	}
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function noContent(): Response {
	return new Response(null, { status: 204 });
}

function redirect(url: string): Response {
	return new Response(null, {
		status: 302,
		headers: { Location: url },
	});
}

/** Requires that the user is authenticated. Throws 401 if not. */
function requireAuth(locals: AuthLocals) {
	if (!locals.session || !locals.user) {
		throw new ApiError('Authentication required', 401);
	}
}

/** Requires that the user has an active org. Throws 400 if not. */
function requireOrg(locals: AuthLocals) {
	requireAuth(locals);
	if (!locals.org_id) {
		throw new ApiError('Organization is required', 400);
	}
}

// ============================================
// Authentication Routes
// ============================================

const signInEmail: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		const body = parseSchema(EmailPasswordSignIn, await ctx.event.request.json());
		const result = (await ctx.auth.signInWithEmail(body, ctx.meta)) as AuthOperationResult;
		const is_new_user = result.type === 'signup';

		if (is_new_user && ctx.config.hooks?.onSignUp) {
			await ctx.config.hooks.onSignUp({ result, method: 'email', meta: ctx.meta });
		}
		if (ctx.config.hooks?.onSignIn) {
			await ctx.config.hooks.onSignIn({
				result,
				method: 'email',
				is_new_user,
				meta: ctx.meta,
			});
		}

		return json({ jwt: result.jwt, decoded_jwt: result.decoded_jwt, org_id: result.org_id });
	});

const signInEmailMagic: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		const body = parseSchema(z.object({ email: z.email() }), await ctx.event.request.json());
		const result = await ctx.auth.createEmailSignInToken(body.email, ctx.meta);

		if (ctx.config.email?.sendEmail) {
			const base_url = ctx.config.email.base_url || ctx.event.url.origin;
			const link = `${base_url}${ctx.config.base_path}/signin/email/verify?token=${result.jwt}`;
			await ctx.config.email.sendEmail({
				to: body.email,
				subject: 'Sign in to your account',
				html: `<a href="${link}">Click here to sign in</a>`,
				text: `Sign in by visiting: ${link}`,
				type: 'magic-link',
			});
		}

		return noContent();
	});

const signInEmailVerify: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		const token = ctx.event.url.searchParams.get('token');
		if (!token) throw new ApiError('Token is required', 400);

		const invitation_id = ctx.event.url.searchParams.get('invitation_id') || undefined;
		const result = (await ctx.auth.signInWithEmailToken(
			{ email_signin_token: token, invitation_id },
			ctx.meta,
		)) as AuthOperationResult;

		const is_new_user = result.type === 'signup';
		if (is_new_user && ctx.config.hooks?.onSignUp) {
			await ctx.config.hooks.onSignUp({ result, method: 'magic-link', meta: ctx.meta });
		}
		if (ctx.config.hooks?.onSignIn) {
			await ctx.config.hooks.onSignIn({
				result,
				method: 'magic-link',
				is_new_user,
				meta: ctx.meta,
			});
		}

		const redirect_to = ctx.event.url.searchParams.get('redirect') || '/';
		// The handler will set the cookie from the result
		return json({
			jwt: result.jwt,
			decoded_jwt: result.decoded_jwt,
			redirect: redirect_to,
		});
	});

const signUpEmail: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		const body = parseSchema(EmailSignUp, await ctx.event.request.json());
		const result = (await ctx.auth.signUpWithEmail(body, ctx.meta)) as AuthOperationResult;

		if (ctx.config.hooks?.onSignUp) {
			await ctx.config.hooks.onSignUp({ result, method: 'email', meta: ctx.meta });
		}
		if (ctx.config.hooks?.onSignIn) {
			await ctx.config.hooks.onSignIn({
				result,
				method: 'email',
				is_new_user: true,
				meta: ctx.meta,
			});
		}

		if (ctx.config.email?.sendEmail) {
			const verificationResult = await ctx.auth.createEmailVerficationToken(
				result.user_session_id,
				ctx.meta,
			);
			const base_url = ctx.config.email.base_url || ctx.event.url.origin;
			const link = `${base_url}${ctx.config.base_path}/email/verify/confirm?token=${verificationResult.jwt}`;
			await ctx.config.email.sendEmail({
				to: body.email,
				subject: 'Verify your email',
				html: `<a href="${link}">Click here to verify your email</a>`,
				text: `Verify your email by visiting: ${link}`,
				type: 'verification',
			});
		}

		return json({ jwt: result.jwt, decoded_jwt: result.decoded_jwt });
	});

const signInOauth: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		const vendor = ctx.event.params.vendor;
		if (!vendor) throw new ApiError('OAuth vendor is required', 400);

		const oauth_config = ctx.config.oauth?.[vendor];
		if (!oauth_config) throw new ApiError(`Unknown OAuth provider: ${vendor}`, 400);

		const redirect_to = ctx.event.url.searchParams.get('redirect') || '/';
		const invitation_id = ctx.event.url.searchParams.get('invitation_id') || undefined;
		const signup_name = ctx.event.url.searchParams.get('name') || undefined;
		const signup_org_name = ctx.event.url.searchParams.get('org_name') || undefined;

		const state = btoa(
			JSON.stringify({
				redirect: redirect_to,
				invitation_id,
				signup: signup_name || signup_org_name
					? { name: signup_name, org_name: signup_org_name }
					: undefined,
			}),
		);

		const callback_url = `${ctx.event.url.origin}${ctx.config.base_path}/signin/${vendor}/callback`;
		const scopes = oauth_config.scopes || [];

		const params = new URLSearchParams({
			client_id: oauth_config.client_id,
			redirect_uri: callback_url,
			response_type: 'code',
			scope: scopes.join(' '),
			state,
		});

		return redirect(`${oauth_config.authorization_url}?${params}`);
	});

const signInOauthCallback: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		const vendor = ctx.event.params.vendor;
		if (!vendor) throw new ApiError('OAuth vendor is required', 400);

		const oauth_config = ctx.config.oauth?.[vendor];
		if (!oauth_config) throw new ApiError(`Unknown OAuth provider: ${vendor}`, 400);

		const code = ctx.event.url.searchParams.get('code');
		if (!code) throw new ApiError('OAuth authorization code is required', 400);

		const state_raw = ctx.event.url.searchParams.get('state');
		let state: { redirect?: string; invitation_id?: string; signup?: { name?: string; org_name?: string } } = {};
		try {
			if (state_raw) state = JSON.parse(atob(state_raw));
		} catch {
			// ignore invalid state
		}

		const callback_url = `${ctx.event.url.origin}${ctx.config.base_path}/signin/${vendor}/callback`;

		const oauth_token = await getOauthToken(
			{
				client_id: oauth_config.client_id,
				client_secret: oauth_config.client_secret,
				access_token_url: oauth_config.access_token_url,
				authorization_url: oauth_config.authorization_url,
				environment: 'production',
			},
			{
				auth_code: code,
				redirect_url: callback_url,
				vendor,
			},
		);

		const result = (await ctx.auth.signInWithOauth(
			{ ...oauth_token, vendor, capabilities: [] },
			{
				invitation_id: state.invitation_id,
				connect_user_id: ctx.locals.user?.id,
			},
			ctx.meta,
		)) as AuthOperationResult;

		const is_new_user = result.type === 'signup';
		if (is_new_user && ctx.config.hooks?.onSignUp) {
			await ctx.config.hooks.onSignUp({ result, method: 'oauth', meta: ctx.meta });
		}
		if (ctx.config.hooks?.onSignIn) {
			await ctx.config.hooks.onSignIn({
				result,
				method: 'oauth',
				is_new_user,
				meta: ctx.meta,
			});
		}

		return redirect(state.redirect || '/');
	});

const signOut: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		if (ctx.locals.session) {
			const session_id = ctx.locals.session.jti;
			await ctx.auth.revokeSession(session_id);
			if (ctx.config.hooks?.onSignOut) {
				await ctx.config.hooks.onSignOut({
					user_id: ctx.locals.session.uid,
					session_id,
				});
			}
		}
		return noContent();
	});

// ============================================
// Session Routes
// ============================================

const sessionGet: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		return json({
			session: ctx.locals.session,
			user: ctx.locals.user,
			org_id: ctx.locals.org_id,
		});
	});

const sessionRefresh: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const result = await ctx.auth.refreshSession(
			ctx.locals.session!.jti,
			ctx.meta,
		);
		return json({
			jwt: result.jwt,
			decoded_jwt: result.decoded_jwt,
			org_id: ctx.locals.org_id,
		});
	});

const sessionList: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const result = await ctx.auth.listSessions(ctx.locals.session!.uid);
		return json(result);
	});

const sessionRevoke: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const id = ctx.event.params.id;
		if (!id) throw new ApiError('Session ID is required', 400);
		await ctx.auth.revokeSession(id);
		return noContent();
	});

// ============================================
// Password Routes
// ============================================

const passwordReset: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		const body = parseSchema(
			z.object({ email: z.email() }),
			await ctx.event.request.json(),
		);
		const result = await ctx.auth.createPasswordResetToken(body.email, ctx.meta);

		if (ctx.config.email?.sendEmail) {
			const base_url = ctx.config.email.base_url || ctx.event.url.origin;
			const link = `${base_url}${ctx.config.base_path}/password/reset/confirm?token=${result.jwt}`;
			await ctx.config.email.sendEmail({
				to: body.email,
				subject: 'Reset your password',
				html: `<a href="${link}">Click here to reset your password</a>`,
				text: `Reset your password by visiting: ${link}`,
				type: 'password-reset',
			});
		}

		return noContent();
	});

const passwordResetConfirm: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		const body = parseSchema(
			z.object({ token: z.string(), password: z.string() }),
			await ctx.event.request.json(),
		);
		const result = await ctx.auth.resetPassword(body.token, body.password, ctx.meta);

		if (ctx.config.hooks?.onPasswordReset) {
			await ctx.config.hooks.onPasswordReset({
				user_id: result.user_id,
				email: result.decoded_jwt.email,
			});
		}

		return json({ jwt: result.jwt, decoded_jwt: result.decoded_jwt });
	});

const passwordChange: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const body = parseSchema(
			z.object({ password: z.string() }),
			await ctx.event.request.json(),
		);
		const result = await ctx.auth.updateSignInMethodPassword(
			ctx.locals.session!.jti,
			body.password,
		);
		return json({ jwt: result.jwt, decoded_jwt: result.decoded_jwt });
	});

const passwordCheck: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		const body = parseSchema(
			z.object({ password: z.string() }),
			await ctx.event.request.json(),
		);
		await ctx.auth.checkPasswordStrength(body.password);
		return json({ strong: true });
	});

// ============================================
// Email Routes
// ============================================

const emailVerify: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const result = await ctx.auth.createEmailVerficationToken(
			ctx.locals.session!.jti,
			ctx.meta,
		);

		if (ctx.config.email?.sendEmail) {
			const base_url = ctx.config.email.base_url || ctx.event.url.origin;
			const link = `${base_url}${ctx.config.base_path}/email/verify/confirm?token=${result.jwt}`;
			await ctx.config.email.sendEmail({
				to: ctx.locals.user!.email,
				subject: 'Verify your email',
				html: `<a href="${link}">Click here to verify your email</a>`,
				text: `Verify your email by visiting: ${link}`,
				type: 'verification',
			});
		}

		return noContent();
	});

const emailVerifyConfirm: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		const token = ctx.event.url.searchParams.get('token');
		if (!token) throw new ApiError('Token is required', 400);

		const result = await ctx.auth.verifyEmail(token, ctx.meta);

		if (ctx.config.hooks?.onEmailVerified) {
			await ctx.config.hooks.onEmailVerified({
				user_id: result.user_id,
				email: result.decoded_jwt.email,
			});
		}

		const redirect_to = ctx.event.url.searchParams.get('redirect') || '/';
		return json({
			jwt: result.jwt,
			decoded_jwt: result.decoded_jwt,
			redirect: redirect_to,
		});
	});

const emailCheck: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		const email = ctx.event.url.searchParams.get('email');
		if (!email) throw new ApiError('Email is required', 400);

		try {
			await ctx.auth.checkEmailAvailability({
				email,
				ip_address: ctx.meta.ip_address,
			});
			return json({ available: true });
		} catch (error) {
			const apiErr = ApiError.from(error);
			if (apiErr.messageText?.includes('already in use')) {
				return json({ available: false });
			}
			throw error;
		}
	});

// ============================================
// User Routes
// ============================================

const userGet: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const user = await ctx.auth.getUser(ctx.locals.session!.uid);
		return json(user);
	});

const userUpdate: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const body = parseSchema(UpdateUser, await ctx.event.request.json());
		const user = await ctx.auth.updateUser(ctx.locals.session!.uid, body);
		return json(user);
	});

const userDelete: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		await ctx.auth.markUserDeleted(ctx.locals.session!.uid);
		return noContent();
	});

const userSignInMethods: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const result = await ctx.auth.listSignInMethods(ctx.locals.session!.uid);
		return json(result);
	});

const userSignInMethodRevoke: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const id = ctx.event.params.id;
		if (!id) throw new ApiError('Sign-in method ID is required', 400);
		await ctx.auth.revokeSignInMethod(id);
		return noContent();
	});

// ============================================
// Organization Routes
// ============================================

const orgCreate: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const body = parseSchema(
			z.object({ name: z.string() }),
			await ctx.event.request.json(),
		);
		const org_id = generateID();
		await ctx.auth.createOrg({
			id: org_id,
			name: body.name,
			owner_id: ctx.locals.session!.uid,
			db_id: '',
			plan: 0,
			json: '{}',
		} as Parameters<AuthServer['createOrg']>[0]);

		// Refresh session to include new org
		const result = await ctx.auth.refreshSession(ctx.locals.session!.jti, ctx.meta);

		if (ctx.config.hooks?.onOrgJoined) {
			await ctx.config.hooks.onOrgJoined({
				user_id: ctx.locals.session!.uid,
				org_id,
			});
		}

		return json({
			org_id,
			jwt: result.jwt,
			decoded_jwt: result.decoded_jwt,
		}, 201);
	});

const orgSwitch: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const body = parseSchema(
			z.object({ org_id: z.string() }),
			await ctx.event.request.json(),
		);

		// Verify user has access to this org
		if (!ctx.locals.session!.org[body.org_id]) {
			throw new ApiError('You do not have access to this organization', 403);
		}

		// Refresh session to get latest data
		const result = await ctx.auth.refreshSession(ctx.locals.session!.jti, ctx.meta);

		return json({
			jwt: result.jwt,
			decoded_jwt: result.decoded_jwt,
			org_id: body.org_id,
		});
	});

const orgUpdate: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const id = ctx.event.params.id;
		if (!id) throw new ApiError('Organization ID is required', 400);
		const body = parseSchema(
			z.object({ name: z.string().optional(), owner_id: z.string().optional() }),
			await ctx.event.request.json(),
		);
		await ctx.auth.updateOrg(id, body);
		return noContent();
	});

const orgDelete: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const id = ctx.event.params.id;
		if (!id) throw new ApiError('Organization ID is required', 400);
		await ctx.auth.markOrgDeleted(id);
		return noContent();
	});

const orgListUsers: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const id = ctx.event.params.id;
		if (!id) throw new ApiError('Organization ID is required', 400);
		const result = await ctx.auth.listOrgUsers(id);
		return json(result);
	});

const orgUpdateUserPermission: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const org_id = ctx.event.params.id;
		const user_id = ctx.event.params.user_id;
		if (!org_id) throw new ApiError('Organization ID is required', 400);
		if (!user_id) throw new ApiError('User ID is required', 400);
		const body = parseSchema(
			z.object({ permission: z.union([z.number(), z.array(z.string())]) }),
			await ctx.event.request.json(),
		);
		await ctx.auth.updateUserPermission(user_id, org_id, body.permission);
		return noContent();
	});

const orgRemoveUser: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const org_id = ctx.event.params.id;
		const user_id = ctx.event.params.user_id;
		if (!org_id) throw new ApiError('Organization ID is required', 400);
		if (!user_id) throw new ApiError('User ID is required', 400);
		await ctx.auth.updateUserPermission(user_id, org_id, 0);
		return noContent();
	});

// ============================================
// Invitation Routes
// ============================================

const invitationList: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireOrg(ctx.locals);
		const result = await ctx.auth.listInvitations(ctx.locals.org_id!);
		return json(result);
	});

const invitationGet: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		const id = ctx.event.params.id;
		if (!id) throw new ApiError('Invitation ID is required', 400);
		const invitation = await ctx.auth.getInvitationIfValid(id);
		return json(invitation);
	});

const invitationCreate: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireOrg(ctx.locals);
		const body = parseSchema(
			z.object({
				email: z.email().optional(),
				permission: z.number(),
				max_redemptions: z.number().optional(),
				expires_at: z.number().optional(),
			}),
			await ctx.event.request.json(),
		);
		const invitation = await ctx.auth.createInvitation({
			org_id: ctx.locals.org_id!,
			user_id: ctx.locals.session!.uid,
			email: body.email,
			permission: body.permission,
			max_redemptions: body.max_redemptions ?? -1,
			expires_at: body.expires_at ?? 0,
		});
		return json(invitation, 201);
	});

const invitationUpdate: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireOrg(ctx.locals);
		const id = ctx.event.params.id;
		if (!id) throw new ApiError('Invitation ID is required', 400);
		const body = parseSchema(
			z.object({
				permission: z.number().optional(),
				max_redemptions: z.number().optional(),
			}),
			await ctx.event.request.json(),
		);
		const invitation = await ctx.auth.updateInvitation(id, body);
		return json(invitation);
	});

const invitationDelete: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireOrg(ctx.locals);
		const id = ctx.event.params.id;
		if (!id) throw new ApiError('Invitation ID is required', 400);
		await ctx.auth.deleteInvitation(id);
		return noContent();
	});

const invitationAccept: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const id = ctx.event.params.id;
		if (!id) throw new ApiError('Invitation ID is required', 400);

		await ctx.auth.acceptInvitation(id, ctx.locals.session!.uid);

		// Refresh session to include new org
		const result = await ctx.auth.refreshSession(ctx.locals.session!.jti, ctx.meta);
		const invitation = await ctx.auth.getInvitation(id);

		if (ctx.config.hooks?.onOrgJoined) {
			await ctx.config.hooks.onOrgJoined({
				user_id: ctx.locals.session!.uid,
				org_id: invitation.org_id,
			});
		}

		return json({
			jwt: result.jwt,
			decoded_jwt: result.decoded_jwt,
			org_id: invitation.org_id,
		});
	});

// ============================================
// OAuth Account Linking Routes
// ============================================

const oauthConnect: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const vendor = ctx.event.params.vendor;
		if (!vendor) throw new ApiError('OAuth vendor is required', 400);

		const oauth_config = ctx.config.oauth?.[vendor];
		if (!oauth_config) throw new ApiError(`Unknown OAuth provider: ${vendor}`, 400);

		const redirect_to = ctx.event.url.searchParams.get('redirect') || '/';
		const capabilities = ctx.event.url.searchParams.get('capabilities')?.split(',') || [];

		const state = btoa(
			JSON.stringify({
				redirect: redirect_to,
				connect: true,
				capabilities,
			}),
		);

		const callback_url = `${ctx.event.url.origin}${ctx.config.base_path}/oauth/${vendor}/callback`;
		const scopes = oauth_config.scopes || [];

		const params = new URLSearchParams({
			client_id: oauth_config.client_id,
			redirect_uri: callback_url,
			response_type: 'code',
			scope: scopes.join(' '),
			state,
		});

		return redirect(`${oauth_config.authorization_url}?${params}`);
	});

const oauthConnectCallback: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const vendor = ctx.event.params.vendor;
		if (!vendor) throw new ApiError('OAuth vendor is required', 400);

		const oauth_config = ctx.config.oauth?.[vendor];
		if (!oauth_config) throw new ApiError(`Unknown OAuth provider: ${vendor}`, 400);

		const code = ctx.event.url.searchParams.get('code');
		if (!code) throw new ApiError('OAuth authorization code is required', 400);

		const state_raw = ctx.event.url.searchParams.get('state');
		let state: { redirect?: string; capabilities?: string[] } = {};
		try {
			if (state_raw) state = JSON.parse(atob(state_raw));
		} catch {
			// ignore invalid state
		}

		const callback_url = `${ctx.event.url.origin}${ctx.config.base_path}/oauth/${vendor}/callback`;

		const oauth_token = await getOauthToken(
			{
				client_id: oauth_config.client_id,
				client_secret: oauth_config.client_secret,
				access_token_url: oauth_config.access_token_url,
				authorization_url: oauth_config.authorization_url,
				environment: 'production',
			},
			{
				auth_code: code,
				redirect_url: callback_url,
				vendor,
			},
		);

		await ctx.auth.connectOauthAccount(
			{ ...oauth_token, vendor, capabilities: state.capabilities || [] },
			ctx.locals.session!.uid,
		);

		return redirect(state.redirect || '/');
	});

const oauthListAccounts: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		requireOrg(ctx.locals);
		const result = await ctx.auth.listOauthAccounts(
			ctx.locals.session!.uid,
			ctx.locals.org_id!,
		);
		return json(result);
	});

const oauthDisconnectAccount: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const id = ctx.event.params.id;
		if (!id) throw new ApiError('OAuth account ID is required', 400);
		const token = (await ctx.auth.getOauthToken(id)) as OauthToken;
		await ctx.auth.disconnectOauthAccount(token);
		return noContent();
	});

// ============================================
// OAuth Application / Provider Routes
// ============================================

const oauthAppList: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const result = await ctx.auth.listOauthApplications(ctx.locals.session!.uid);
		return json(result);
	});

const oauthAppCreate: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const body = parseSchema(
			z.object({
				name: z.string(),
				logo: z.string().optional(),
				url: z.string().optional(),
				description: z.string().optional(),
				privacy_policy_url: z.string().optional(),
				terms_of_service_url: z.string().optional(),
				redirect_urls: z.array(z.string()).optional(),
				default_redirect_url: z.string().optional(),
			}),
			await ctx.event.request.json(),
		);
		const app = await ctx.auth.createOauthApplication({
			...body,
			user_id: ctx.locals.session!.uid,
		});
		return json(app, 201);
	});

const oauthAppGet: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const id = ctx.event.params.id;
		if (!id) throw new ApiError('Application ID is required', 400);
		const app = await ctx.auth.getOauthApplication(id);
		return json(app);
	});

const oauthAppUpdate: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const id = ctx.event.params.id;
		if (!id) throw new ApiError('Application ID is required', 400);
		const body = parseSchema(
			z.object({
				name: z.string().optional(),
				logo: z.string().optional(),
				url: z.string().optional(),
				description: z.string().optional(),
				privacy_policy_url: z.string().optional(),
				terms_of_service_url: z.string().optional(),
				redirect_urls: z.array(z.string()).optional(),
				default_redirect_url: z.string().optional(),
			}),
			await ctx.event.request.json(),
		);
		const app = await ctx.auth.updateOauthApplication(id, body);
		return json(app);
	});

const oauthAppDelete: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const id = ctx.event.params.id;
		if (!id) throw new ApiError('Application ID is required', 400);
		await ctx.auth.deleteOauthApplication(id);
		return noContent();
	});

const oauthAppCreateSecret: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const id = ctx.event.params.id;
		if (!id) throw new ApiError('Application ID is required', 400);
		const result = await ctx.auth.createOauthApplicationSecret(id);
		return json(result, 201);
	});

const oauthAppDeleteSecret: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const app_id = ctx.event.params.id;
		const secret_id = ctx.event.params.secret_id;
		if (!app_id) throw new ApiError('Application ID is required', 400);
		if (!secret_id) throw new ApiError('Secret ID is required', 400);
		await ctx.auth.deleteOauthApplicationSecret(app_id, secret_id);
		return noContent();
	});

const oauthAppRevoke: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const id = ctx.event.params.id;
		if (!id) throw new ApiError('Application ID is required', 400);
		requireOrg(ctx.locals);
		await ctx.auth.revokeAuthorizedOauthApplication(
			id,
			ctx.locals.org_id!,
		);
		return noContent();
	});

const oauthAuthorizeGet: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		const client_id = ctx.event.url.searchParams.get('client_id');
		if (!client_id) throw new ApiError('client_id is required', 400);
		const app = await ctx.auth.getOauthApplication(client_id);
		return json({
			application: app,
			user: ctx.locals.user,
		});
	});

const oauthAuthorizePost: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		requireAuth(ctx.locals);
		requireOrg(ctx.locals);
		const body = parseSchema(
			z.object({
				client_id: z.string(),
				redirect_uri: z.string().optional(),
				scope: z.string().optional(),
				state: z.string().optional(),
			}),
			await ctx.event.request.json(),
		);
		const result = await ctx.auth.createOauthApplicationAuthorizationCode(
			body.client_id,
			{
				user_id: ctx.locals.session!.uid,
				org_id: ctx.locals.org_id!,
				permission: ctx.locals.org!.role,
				redirect_uri: body.redirect_uri || '',
			},
		);
		return json(result);
	});

const oauthTokenExchange: AuthRouteHandler = (ctx) =>
	handleRoute(ctx, async () => {
		const body = parseSchema(
			z.object({
				grant_type: z.string(),
				code: z.string().optional(),
				client_id: z.string(),
				client_secret: z.string(),
				redirect_uri: z.string().optional(),
				refresh_token: z.string().optional(),
			}),
			await ctx.event.request.json(),
		);
		const result = await ctx.auth.createOauthApplicationToken({
			auth_code: body.code,
			refresh_token: body.refresh_token,
		});
		return json(result);
	});

// ============================================
// Route Map
// ============================================

interface RouteMatch {
	handler: AuthRouteHandler;
	params: Record<string, string>;
}

interface RouteDefinition {
	method: string;
	pattern: RegExp;
	param_names: string[];
	handler: AuthRouteHandler;
}

function defineRoute(
	method: string,
	path: string,
	handler: AuthRouteHandler,
): RouteDefinition {
	const param_names: string[] = [];
	const pattern_str = path.replace(/:(\w+)/g, (_match, name) => {
		param_names.push(name);
		return '([^/]+)';
	});
	return {
		method,
		pattern: new RegExp(`^${pattern_str}$`),
		param_names,
		handler,
	};
}

const ROUTES: RouteDefinition[] = [
	// Authentication
	defineRoute('POST', '/signin/email', signInEmail),
	defineRoute('POST', '/signin/email/magic', signInEmailMagic),
	defineRoute('GET', '/signin/email/verify', signInEmailVerify),
	defineRoute('POST', '/signup/email', signUpEmail),
	defineRoute('GET', '/signin/:vendor/callback', signInOauthCallback),
	defineRoute('GET', '/signin/:vendor', signInOauth),
	defineRoute('POST', '/signout', signOut),

	// Session
	defineRoute('GET', '/session', sessionGet),
	defineRoute('POST', '/session/refresh', sessionRefresh),
	defineRoute('GET', '/session/list', sessionList),
	defineRoute('DELETE', '/session/:id', sessionRevoke),

	// Password
	defineRoute('POST', '/password/reset', passwordReset),
	defineRoute('POST', '/password/reset/confirm', passwordResetConfirm),
	defineRoute('PATCH', '/password', passwordChange),
	defineRoute('POST', '/password/check', passwordCheck),

	// Email
	defineRoute('POST', '/email/verify', emailVerify),
	defineRoute('GET', '/email/verify/confirm', emailVerifyConfirm),
	defineRoute('GET', '/email/check', emailCheck),

	// User
	defineRoute('GET', '/user', userGet),
	defineRoute('PATCH', '/user', userUpdate),
	defineRoute('DELETE', '/user', userDelete),
	defineRoute('GET', '/user/signin-methods', userSignInMethods),
	defineRoute('DELETE', '/user/signin-methods/:id', userSignInMethodRevoke),

	// Organization
	defineRoute('POST', '/org', orgCreate),
	defineRoute('POST', '/org/switch', orgSwitch),
	defineRoute('PATCH', '/org/:id', orgUpdate),
	defineRoute('DELETE', '/org/:id', orgDelete),
	defineRoute('GET', '/org/:id/users', orgListUsers),
	defineRoute('PATCH', '/org/:id/users/:user_id', orgUpdateUserPermission),
	defineRoute('DELETE', '/org/:id/users/:user_id', orgRemoveUser),

	// Invitation
	defineRoute('GET', '/invitation', invitationList),
	defineRoute('POST', '/invitation', invitationCreate),
	defineRoute('GET', '/invitation/:id', invitationGet),
	defineRoute('PATCH', '/invitation/:id', invitationUpdate),
	defineRoute('DELETE', '/invitation/:id', invitationDelete),
	defineRoute('POST', '/invitation/:id/accept', invitationAccept),

	// OAuth Account Linking
	defineRoute('GET', '/oauth/accounts', oauthListAccounts),
	defineRoute('DELETE', '/oauth/accounts/:id', oauthDisconnectAccount),
	defineRoute('GET', '/oauth/:vendor/callback', oauthConnectCallback),
	defineRoute('GET', '/oauth/:vendor', oauthConnect),

	// OAuth Application / Provider
	defineRoute('GET', '/oauth/authorize', oauthAuthorizeGet),
	defineRoute('POST', '/oauth/authorize', oauthAuthorizePost),
	defineRoute('POST', '/oauth/token', oauthTokenExchange),
	defineRoute('GET', '/oauth/application', oauthAppList),
	defineRoute('POST', '/oauth/application', oauthAppCreate),
	defineRoute('GET', '/oauth/application/:id', oauthAppGet),
	defineRoute('PATCH', '/oauth/application/:id', oauthAppUpdate),
	defineRoute('DELETE', '/oauth/application/:id', oauthAppDelete),
	defineRoute('POST', '/oauth/application/:id/secret', oauthAppCreateSecret),
	defineRoute('DELETE', '/oauth/application/:id/secret/:secret_id', oauthAppDeleteSecret),
	defineRoute('POST', '/oauth/application/:id/revoke', oauthAppRevoke),
];

/** Matches an incoming request to a route handler */
export function matchRoute(
	method: string,
	path: string,
): RouteMatch | null {
	for (const route of ROUTES) {
		if (route.method !== method) continue;
		const match = path.match(route.pattern);
		if (!match) continue;
		const params: Record<string, string> = {};
		route.param_names.forEach((name, i) => {
			params[name] = match[i + 1];
		});
		return { handler: route.handler, params };
	}
	return null;
}
