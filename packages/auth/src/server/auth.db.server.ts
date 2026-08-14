import { DurableObject } from 'cloudflare:workers';
import { SqlServer, type SqlEntityQuery } from './sql.server';
import { AUTH_DATABASE_UPGRADES, AuthDatabaseSchema } from './auth.sql.schema';
import { DelightError, generateID, parseSchema } from '@delightstack/utilities';
import { generateJwt, decodeJwt } from './jwt.server';
import {
	decodeOauthScopes,
	decodePermissions,
	encodePermissions,
	OauthApplication,
	OauthToken,
	SessionToken,
	UserSession,
	UserSessionMeta,
	encodeOauthScopes,
	OauthAccount,
	UserSignInMethod,
	UpdateUser,
	EmailPasswordSignIn,
	EmailSignUp,
	EmailLinkSignIn,
	EmailCodeSignIn,
	Passkey,
	PasskeyRelyingParty,
	PasskeyRegistrationResponse,
	PasskeyAuthenticationResponse,
} from './../types';
import {
	generateRegistrationOptions,
	verifyRegistrationResponse,
	generateAuthenticationOptions,
	verifyAuthenticationResponse,
	type RegistrationResponseJSON,
	type AuthenticationResponseJSON,
	type AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';

import { argon2id, setWASMModules, argon2Verify } from 'argon2-wasm-edge';
// @ts-expect-error
import argon2WASM from 'argon2-wasm-edge/wasm/argon2.wasm'; // <-- imports of wasm modules works differently in CF
// @ts-expect-error
import blake2bWASM from 'argon2-wasm-edge/wasm/blake2b.wasm';
setWASMModules({ argon2WASM, blake2bWASM });

/**
 * Argon2id work factors for newly created password hashes (OWASP recommended profile:
 * 19 MiB memory, 2 iterations, 1 lane). Verification reads params from each stored
 * hash, so raising these never invalidates existing hashes.
 */
const ARGON2_PARAMS = {
	parallelism: 1,
	iterations: 2,
	memorySize: 19456, // KiB = 19 MiB
	hashLength: 32,
} as const;

/** Pre-computed dummy hash for constant-time auth checks (prevents timing-based email enumeration) */
let _dummy_hash: string | undefined;
async function getDummyHash(): Promise<string> {
	if (!_dummy_hash) {
		const salt = new Uint8Array(16);
		crypto.getRandomValues(salt);
		_dummy_hash = await argon2id({
			salt,
			password: 'dummy-password-for-timing-safety',
			...ARGON2_PARAMS,
			outputType: 'encoded',
		});
	}
	return _dummy_hash;
}

/**
 * Characters allowed in emailed one-time codes: lowercase consonants + digits, no symbols.
 * Vowels are excluded so codes can't spell words, and ambiguous characters (0/o, 1/l/i)
 * are excluded so codes are easy to read from an email. 28^6 ≈ 482M combinations, which
 * is plenty against the EMAIL_CODE_MAX_ATTEMPTS guess cap.
 */
const EMAIL_CODE_ALPHABET = 'bcdfghjkmnpqrstvwxyz23456789';
const EMAIL_CODE_LENGTH = 6;
/** How many guesses are allowed against a single emailed code before it is invalidated */
const EMAIL_CODE_MAX_ATTEMPTS = 5;

/** Generates a random one-time code for email sign-in / verification (e.g. 'k3v9qx') */
function generateEmailCode(): string {
	// Rejection sampling: bytes >= the largest multiple of the alphabet size would bias
	// the code toward the start of the alphabet, so they are skipped
	const byte_limit = 256 - (256 % EMAIL_CODE_ALPHABET.length);
	const chars: string[] = [];
	while (chars.length < EMAIL_CODE_LENGTH) {
		const bytes = new Uint8Array(EMAIL_CODE_LENGTH * 2);
		crypto.getRandomValues(bytes);
		for (const byte of bytes) {
			if (byte >= byte_limit) continue;
			chars.push(EMAIL_CODE_ALPHABET[byte % EMAIL_CODE_ALPHABET.length]);
			if (chars.length === EMAIL_CODE_LENGTH) break;
		}
	}
	return chars.join('');
}

/** Hashes an emailed one-time code (case-insensitive), salted with the session id so identical codes don't share a hash */
async function hashEmailCode(user_session_id: string, code: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(`${user_session_id}:${code.trim().toLowerCase()}`),
	);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

export interface AuthOperationResult<Type = SessionToken['typ']> {
	user_id: string;
	user_auth_id: string;
	user_session_id: string;
	decoded_jwt: SessionToken<Type>;
	type:
		| 'signin'
		| 'signup'
		| 'new-signin-method'
		| 'refresh-session'
		| 'password-change'
		| 'other';
	jwt: string;
	org_id?: string;
}

interface Env {
	DEV: boolean;
}

export interface AuthDatabaseServerOptions {
	/**
	 * The secret used to sign the jwt tokens.
	 * To generate a new secret key, use the following code:
	 * let key = await crypto.subtle.generateKey({name: 'HMAC', hash: {name: 'SHA-256'}}, true, ['sign', 'verify']);
	 * let arrayBuffer = await crypto.subtle.exportKey('raw', key);
	 * let uint8 = new Uint8Array(arrayBuffer);
	 * let hex = Array.from(uint8)
	 *		.map(byte => byte.toString(16).padStart(2, '0'))
	 *		.join('')
	 * Now save the jwk in the env variable
	 * More information can be found here: https://github.com/diafygi/webcrypto-examples#hmac
	 */
	secret: string;

	/** The id/name issuer of the JWT tokens. Can be any string - usually unique to an application */
	issuer: string;

	/**
	 * Permission names for bitwise role encoding.
	 * Array index = bit position. Append-only: never reorder or remove entries.
	 * @example permissions: ['org:read', 'org:write', 'org:admin', 'org:owner']
	 */
	permissions: readonly string[];

	/**
	 * OAuth scope names for bitwise capability encoding.
	 * Array index = bit position. Append-only: never reorder or remove entries.
	 * @example oauth_scopes: ['profile', 'email', 'calendar']
	 */
	oauth_scopes: readonly string[];

	/**
	 * Entitlement names for bitwise org-level feature encoding.
	 * Array index = bit position. Append-only: never reorder or remove entries.
	 * @example entitlements: ['premium', 'video-uploads', 'extra-usage']
	 * @default []
	 */
	entitlements?: readonly string[];

	/**
	 * The permission required for a user to be an admin of an organization.
	 * This is necessary because we will add this permission automatically to users that create new organizations.
	 * This permission string must be an entry in the `permissions` array.
	 * @default 'org:admin'
	 */
	orgAdminPermission?: string;

	/**
	 * The OAuth scope required to access the user's profile information from an OAuth provider.
	 * This scope string must be an entry in the `oauth_scopes` array.
	 * @default 'profile'
	 */
	oauthProfileScope?: string;
}

/** A Durable Object for handling database requests */
export class AuthDatabaseServer extends DurableObject<Env> {
	private sql = new SqlServer<AuthDatabaseSchema>(this.ctx.storage);

	private get orgAdminPermission() {
		const permission = this.options.orgAdminPermission || 'org:admin';
		// A permission missing from the configured list silently encodes to 0
		// bits, so every org creator would be written as a member with NO
		// permissions — the claim builder then drops the membership from the
		// session token and the org effectively doesn't exist for its owner.
		// Fail loudly instead.
		if (!this.options.permissions.includes(permission)) {
			throw new DelightError({
				status: 500,
				message:
					`orgAdminPermission '${permission}' is not in the configured permissions list ` +
					`[${this.options.permissions.join(', ')}]. Add it to the list or set ` +
					`orgAdminPermission to one of the listed permissions.`,
			});
		}
		return permission;
	}
	private get oauthProfileScope() {
		return this.options.oauthProfileScope || 'profile';
	}

	/**
	 * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
	 * 	`DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
	 *
	 * @param ctx - The interface for interacting with Durable Object state
	 * @param env - The interface to reference bindings declared in wrangler.toml
	 */
	constructor(
		ctx: DurableObjectState,
		protected env: Env,
		private options: AuthDatabaseServerOptions,
	) {
		super(ctx, env);
		this.initializeDB();
	}

	/** The fetch event handler that should only be called in protected environments */
	async fetch(input: string | URL | Request, init?: RequestInit) {
		const url = input instanceof Request ? new URL(input.url) : new URL(input);
		const method = input instanceof Request ? input.method : init?.method || 'GET';
		if (url.pathname === '/rpc' && method === 'POST') {
			const body = (await (input instanceof Request ? input.json() : init?.body)) as {
				method?: string;
				args?: unknown[];
			};
			if (body?.method && body?.args && body.method in this) {
				try {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const result = (
						this as unknown as Record<string, (...args: unknown[]) => unknown>
					)[body.method](...body.args);
					const response = result instanceof Promise ? await result : result;
					return new Response(JSON.stringify(response), {
						headers: { 'content-type': 'application/json' },
					});
				} catch (error: unknown) {
					const responseError = DelightError.from(error);
					return responseError.toResponse();
				}
			}
		}
		return new Response(JSON.stringify({ status: 404, message: 'Not found' }), {
			status: 404,
		});
	}

	/** Lists the users of the given org id that match the given query */
	listOrgUsers(org_id: string) {
		const org_users = this.sql.list('org_user', {
			limit: 1000,
			where: {
				key: 'org_id',
				is: '=',
				value: org_id,
			},
		});
		const list = org_users.map((org_user) => {
			const user = this.sql.get('user', org_user.user_id);
			return {
				id: user.id,
				name: user.name,
				permission: org_user.permission,
				image: user.image,
				created_at: user.created_at,
				updated_at: user.updated_at,
			};
		});
		return {
			list,
			count: list.length,
			hasMore: false,
		};
	}

	/** Lists the users that match the given query */
	listUsers(query?: SqlEntityQuery<AuthDatabaseSchema['user']>) {
		return this.sql.list('user', query);
	}

	/** Gets the user data with the given ID */
	getUser(user_id: string) {
		return this.sql.get('user', user_id);
	}

	/** Signs in the user and returns their created session token */
	async signInWithEmail(unsafe_data: EmailPasswordSignIn, meta: UserSessionMeta) {
		const { email, password, invitation_id } = parseSchema(
			EmailPasswordSignIn,
			unsafe_data,
		);
		if (!email) throw new DelightError({ message: 'Email is required', status: 400 });
		if (!password)
			throw new DelightError({ message: 'Password is required', status: 400 });
		const ip_address = meta.ip_address;

		// Limit the number of requests that can be made to this endpoint
		const is_allowed = this.rateLimit([ip_address || '', 'signin_attempt'], {
			max_tokens: 5,
			refill_every_seconds: 10,
		});
		if (!is_allowed) {
			throw new DelightError({
				message: 'Too many failed sign in attempts. Please try again later',
				status: 429,
			});
		}

		// Get the user's auth details
		const [user_auth] = this.sql.list('user_auth', {
			limit: 1,
			where: {
				and: [
					{ key: 'email', is: '=', value: email.trim().toLowerCase() },
					{ key: 'oauth_token_id', is: '=', value: null },
				],
			},
		});
		if (!user_auth?.password_hash) {
			// Always run Argon2 against a dummy hash to prevent timing-based email enumeration
			await argon2Verify({ hash: await getDummyHash(), password }).catch(() => {});
			throw new DelightError({ message: 'Incorrect email or password', status: 401 });
		}
		await this.verifyPasswordHash(password, user_auth.password_hash);
		const user = this.sql
			.setError(`Couldn't find user with given id`)
			.get('user', user_auth.user_id);
		if (user.deleted_at) {
			throw new DelightError({
				message: 'This account has been deleted. Please contact support for help.',
				status: 401,
			});
		}

		// Check if the user was invited to an existing organization
		let org_id: string | undefined;
		let permission: number | undefined;
		if (invitation_id) {
			const invitation = this.sql
				.setError(`Could not find invitation`)
				.get('org_invitation', invitation_id);
			permission = invitation.permission;
			org_id = invitation.org_id;
		}
		if (org_id && permission) {
			const [existing_permission] = this.sql.list('org_user', {
				limit: 1,
				where: {
					and: [
						{ key: 'org_id', is: '=', value: org_id },
						{ key: 'user_id', is: '=', value: user_auth.user_id },
					],
				},
			});
			if (existing_permission) {
				const existing_permissions = decodePermissions(
					this.options.permissions,
					existing_permission.permission,
				);
				const new_permissions = decodePermissions(this.options.permissions, permission);
				const all_permissions = encodePermissions(
					this.options.permissions,
					Array.from(new Set([...existing_permissions, ...new_permissions])),
				);
				this.sql.update('org_user', existing_permission.id, {
					permission: all_permissions,
				});
			} else {
				this.sql.insert('org_user', null, {
					org_id,
					user_id: user_auth.user_id,
					permission,
				});
			}
		}

		const user_session_id = generateID();
		const { jwt, decoded_jwt } = await this.createSessionToken({
			user_auth_id: user_auth.id,
			user_id: user_auth.user_id,
			user_session_id,
			email: user_auth.email,
			verified: !!user_auth.verified_at,
		});
		this.sql.insert('user_session', user_session_id, {
			type: 'auth',
			jwt,
			user_id: user_auth.user_id,
			user_auth_id: user_auth.id,
			expires_at: decoded_jwt.exp * 1000,
			json: JSON.stringify(meta),
		});
		return {
			jwt,
			decoded_jwt,
			user_id: user_auth.user_id,
			user_auth_id: user_auth.id,
			user_session_id,
			type: 'signin',
		} satisfies AuthOperationResult;
	}

	/**
	 * Signs in the user with an email token (taken from the query params of the email link).
	 * Call 'createEmailSignInToken' to generate the email token. Then send the user an email with the link
	 * When the email is clicked, extract the token from the query params and pass it to this function.
	 * This verifies the email and creates a new session for the user.
	 */
	async signInWithEmailToken(unsafe_data: EmailLinkSignIn, meta: UserSessionMeta) {
		const { email_signin_token, invitation_id } = parseSchema(
			EmailLinkSignIn,
			unsafe_data,
		);
		let token: Awaited<ReturnType<typeof decodeJwt>>;
		try {
			token = await decodeJwt(this.options.secret, email_signin_token);
		} catch {
			throw new DelightError({
				message: 'Invalid or expired email sign-in link',
				status: 400,
			});
		}
		if (token.typ !== 'email_signin') {
			throw new DelightError({ message: 'Invalid email sign-in link', status: 400 });
		}

		return this.completeEmailSignIn(
			{
				user_session_id: token.jti,
				user_auth_id: token.sub,
				user_id: token.uid,
				invitation_id,
				used_error: `Email sign-in link has already been used or is expired`,
			},
			meta,
		);
	}

	/**
	 * Signs in the user with a one-time code sent to their email.
	 * Call 'createEmailSignInToken' with `{ code: true }` to generate the code, then email it to the user.
	 * Codes are checked case-insensitively; only the most recently issued code for an email is
	 * valid, and a code is invalidated after too many wrong guesses.
	 */
	async signInWithEmailCode(unsafe_data: EmailCodeSignIn, meta: UserSessionMeta) {
		const { email, code, invitation_id } = parseSchema(EmailCodeSignIn, unsafe_data);

		// Limit the number of guesses that can be made from one address
		const is_allowed = this.rateLimit([meta.ip_address || '', 'email_code_signin'], {
			max_tokens: 5,
			refill_every_seconds: 10,
		});
		if (!is_allowed) {
			throw new DelightError({
				message: 'Too many failed sign in attempts. Please try again later',
				status: 429,
			});
		}

		// A single error for every failure mode so responses don't leak which emails exist
		const invalidCode = () =>
			new DelightError({ message: 'Incorrect or expired sign-in code', status: 401 });

		// Find the email sign-in method for this email
		const [user_auth] = this.sql.list('user_auth', {
			limit: 1,
			where: {
				and: [
					{ key: 'email', is: '=', value: email },
					{ key: 'oauth_token_id', is: '=', value: null },
				],
			},
		});
		if (!user_auth) throw invalidCode();

		// Only the most recently issued code is valid — older pending codes are ignored
		const pending = this.sql
			.list('user_session', {
				where: {
					and: [
						{ key: 'user_auth_id', is: '=', value: user_auth.id },
						{ key: 'type', is: '=', value: 'email_signin' },
					],
				},
			})
			.filter((s) => s.code_hash && (s.expires_at ?? 0) > Date.now())
			.sort((a, b) => b.created_at - a.created_at)[0];
		if (!pending) throw invalidCode();

		// Burn an attempt before comparing so every guess counts, even if the request is
		// interrupted. The counter is persistent, so guessing can't be reset by DO eviction
		// or spread across IP addresses. Past the limit even the correct code is rejected
		const attempts = (pending.code_attempts ?? 0) + 1;
		this.sql.update('user_session', pending.id, { code_attempts: attempts });
		if (attempts > EMAIL_CODE_MAX_ATTEMPTS) throw invalidCode();

		const code_hash = await hashEmailCode(pending.id, code);
		if (code_hash !== pending.code_hash) throw invalidCode();

		return this.completeEmailSignIn(
			{
				user_session_id: pending.id,
				user_auth_id: user_auth.id,
				user_id: user_auth.user_id,
				invitation_id,
				used_error: `Sign-in code has already been used or is expired`,
			},
			meta,
		);
	}

	/**
	 * Shared completion for email link & code sign-ins: consumes the pending 'email_signin'
	 * session, marks the email verified (the user proved they own it), and trades it for a
	 * regular auth session.
	 */
	private async completeEmailSignIn(
		params: {
			user_session_id: string;
			user_auth_id: string;
			user_id: string;
			invitation_id?: string;
			used_error: string;
		},
		meta: UserSessionMeta,
	) {
		const { user_session_id, user_auth_id, user_id, invitation_id, used_error } = params;

		// Check if the token has already been used (deleted from database)
		this.sql.setError(used_error, 400).get('user_session', user_session_id);

		const user = this.sql
			.setError(`Couldn't find user with given id`)
			.get('user', user_id);
		if (user.deleted_at) {
			throw new DelightError({
				message: `This account has been deleted. Please contact support for help.`,
				status: 401,
			});
		}

		// Check if the user auth exists still
		const user_auth = this.sql
			.setError(`Could not find email sign in method`)
			.get('user_auth', user_auth_id);

		// Check if the user was invited to an existing organization
		let org_id: string | undefined;
		let permission: number | undefined;
		if (invitation_id) {
			const invitation = this.sql
				.setError(`Could not find invitation`)
				.get('org_invitation', invitation_id);
			permission = invitation.permission;
			org_id = invitation.org_id;
		}
		if (org_id && permission) {
			const [existing_permission] = this.sql.list('org_user', {
				limit: 1,
				where: {
					and: [
						{ key: 'org_id', is: '=', value: org_id },
						{ key: 'user_id', is: '=', value: user_auth.user_id },
					],
				},
			});
			if (existing_permission) {
				const existing_permissions = decodePermissions(
					this.options.permissions,
					existing_permission.permission,
				);
				const new_permissions = decodePermissions(this.options.permissions, permission);
				const all_permissions = encodePermissions(
					this.options.permissions,
					Array.from(new Set([...existing_permissions, ...new_permissions])),
				);
				this.sql.update('org_user', existing_permission.id, {
					permission: all_permissions,
				});
			} else {
				this.sql.insert('org_user', null, {
					org_id,
					user_id: user_auth.user_id,
					permission,
				});
			}
		}

		// Create a new session token for the user because we encode the email verification status in the token
		const new_session_id = generateID();
		const new_session = await this.createSessionToken({
			user_auth_id,
			user_id,
			verified: true,
			user_session_id: new_session_id,
		});

		this.sql.transaction(() => {
			// Re-check inside the transaction: the awaits above yield the Durable Object's
			// input gate, so a concurrent request may have already consumed this token
			this.sql.setError(used_error, 400).get('user_session', user_session_id);
			// Mark the user as verified if they haven't been verified yet
			// They can be verified if they clicked the email link (meaning they own the email)
			if (!user_auth.verified_at) {
				this.sql.update('user_auth', user_auth_id, { verified_at: Date.now() });
			}
			// Delete every outstanding sign-in code/link for this method, not just the one
			// redeemed. Otherwise a superseded code would resurrect as the "newest" valid
			// code once the newer one is consumed (signInWithEmailCode picks by created_at).
			// Active `auth` sessions on other devices are a different type and untouched.
			this.sql
				.list('user_session', {
					where: {
						and: [
							{ key: 'user_auth_id', is: '=', value: user_auth_id },
							{ key: 'type', is: '=', value: 'email_signin' },
						],
					},
				})
				.forEach((session) => {
					this.sql.delete('user_session', session.id);
				});
			this.sql.insert('user_session', new_session_id, {
				type: 'auth',
				jwt: new_session.jwt,
				user_id,
				user_auth_id,
				expires_at: new_session.decoded_jwt.exp * 1000,
				json: JSON.stringify(meta || {}),
			});
		});

		return {
			jwt: new_session.jwt,
			decoded_jwt: new_session.decoded_jwt,
			user_id: user_id,
			user_auth_id: user_auth_id,
			user_session_id: new_session_id,
			type: 'signin',
		} satisfies AuthOperationResult;
	}

	/** Creates a new user (an optionally a new organization). Returns the user id */
	async signUpWithEmail(
		unsafe_data: Omit<EmailSignUp, 'org_name' | 'org_plan_id'>,
		meta: UserSessionMeta,
	) {
		const user = parseSchema(EmailSignUp, unsafe_data);
		const ip_address = meta.ip_address;
		const email = user.email.trim().toLowerCase();
		const user_id = generateID();
		const user_auth_id = generateID();
		const user_session_id = generateID();
		if (user.password) await this.checkPasswordStrength(user.password);

		// Limit the number of requests that can be made to this endpoint
		const is_allowed = this.rateLimit([ip_address || '', 'signup_attempt'], {
			max_tokens: 3,
			refill_every_seconds: 10,
		});
		if (!is_allowed) {
			throw new DelightError({
				message: 'Too many failed sign up attempts. Please try again later',
				status: 429,
			});
		}

		// Check if the email is already in use
		this.checkEmailAvailability({
			email,
			ip_address: ip_address,
		});
		let org_id: string | undefined;
		let org: AuthDatabaseSchema['org'] | undefined;
		let permission: number | undefined;

		// Check if the user was invited to an existing organization
		if (user.invitation_id) {
			const invitation = this.sql
				.setError(`Could not find invitation`)
				.get('org_invitation', user.invitation_id);
			permission = invitation.permission;
			org_id = invitation.org_id;
			org = this.sql.setError(`Could not find organization`).get('org', org_id);
		}

		// Hash the password and create a session token
		const passwordHash = !user.password
			? undefined
			: await this.hashPassword(user.password);
		const { jwt, decoded_jwt } = await this.createSessionToken({
			user_auth_id,
			user_id,
			user_session_id,
			org:
				org_id && org && permission
					? {
							[org_id]: {
								p: permission,
								n: org.name,
								...(org.db_id ? { d: org.db_id } : {}),
								...(org.plan != null ? { e: org.plan } : {}),
							},
						}
					: undefined,
			name: user.name,
			email,
			verified: false,
		});

		// Save the user data in the database
		this.sql.transaction(() => {
			this.sql.insert('user', user_id, {
				name: user.name,
				image: user.image,
				json: JSON.stringify({}),
			});
			this.sql.insert('user_auth', user_auth_id, {
				user_id,
				email,
				password_hash: passwordHash,
			});
			this.sql.insert('user_session', user_session_id, {
				user_id,
				user_auth_id,
				jwt,
				type: 'auth',
				expires_at: decoded_jwt.exp * 1000,
				json: JSON.stringify(meta),
			});
			if (org_id && permission) {
				this.sql.insert('org_user', null, {
					org_id,
					user_id,
					permission,
				});
			}
		});
		return {
			user_id,
			user_auth_id,
			user_session_id,
			decoded_jwt,
			jwt,
			type: 'signup',
		} satisfies AuthOperationResult;
	}

	/** Creates a new email sign in method for an existing user account */
	async createEmailSignIn(
		user_id: string,
		raw_email: string,
		password: string | undefined,
		meta: UserSessionMeta,
	) {
		const ip_address = meta.ip_address;
		const user_auth_id = generateID();
		const user_session_id = generateID();
		const email = raw_email.trim().toLowerCase();
		if (!email)
			throw new DelightError({ message: `Must provide an email address`, status: 400 });
		const user = this.sql.setError(`Could not find user`).get('user', user_id);
		if (user.deleted_at) {
			throw new DelightError({
				message: 'This account has been deleted. Please contact support for help.',
				status: 401,
			});
		}
		if (password) await this.checkPasswordStrength(password);

		// Limit the number of requests that can be made to this endpoint
		const is_allowed = this.rateLimit([ip_address || '', 'create_email_sign_in'], {
			max_tokens: 3,
			refill_every_seconds: 10,
		});
		if (!is_allowed) {
			throw new DelightError({
				message: 'Too many failed sign up attempts. Please try again later',
				status: 429,
			});
		}

		// Check if the email is already in use
		this.checkEmailAvailability({ email, ip_address });

		// Hash the password and create a session token
		const password_hash = !password ? undefined : await this.hashPassword(password);
		const { jwt, decoded_jwt } = await this.createSessionToken({
			user_auth_id,
			user_id,
			user_session_id,
			name: user.name,
			email,
			verified: false,
		});

		// Save the user data in the database
		this.sql.transaction(() => {
			this.sql.insert('user_auth', user_auth_id, {
				user_id,
				email,
				password_hash,
			});
			this.sql.insert('user_session', user_session_id, {
				user_id,
				user_auth_id,
				jwt,
				type: 'auth',
				expires_at: decoded_jwt.exp * 1000,
				json: JSON.stringify(meta),
			});
		});

		return {
			user_id,
			user_auth_id,
			user_session_id,
			decoded_jwt,
			jwt,
			type: 'new-signin-method',
		} satisfies AuthOperationResult;
	}

	/**
	 * Refreshes an expired token by checking if it is still a valid session.
	 * IMPORTANT - The provided token should already have it's signature verified before passing it here.
	 * @returns the new session token
	 */
	async refreshSession(user_session_id: string, meta: UserSessionMeta) {
		this.cleanupExpiredSessions();
		const session = this.sql
			.setError(`Can't refresh a revoked session`)
			.get('user_session', user_session_id);
		const new_session = await this.createSessionToken({
			user_auth_id: session.user_auth_id,
			user_id: session.user_id,
			user_session_id,
		});
		const old_meta = JSON.parse(session.json || '{}') as UserSessionMeta;
		this.sql.update('user_session', session.id, {
			jwt: new_session.jwt,
			expires_at: new_session.decoded_jwt.exp * 1000,
			json: JSON.stringify({ ...old_meta, ...meta }),
		});
		return {
			user_id: session.user_id,
			user_auth_id: session.user_auth_id,
			user_session_id: session.id,
			decoded_jwt: new_session.decoded_jwt,
			jwt: new_session.jwt,
			type: 'refresh-session',
		} satisfies AuthOperationResult;
	}

	/** Returns a paginated list of active user sessions for the user with the given id */
	listSessions(user_id: string, options?: { offset?: number; limit?: number }) {
		const limit = Math.min(Math.max(options?.limit ?? 10, 1), 50);
		const offset = Math.max(options?.offset ?? 0, 0);
		const sessions = this.sql.list('user_session', {
			limit: limit + 1,
			offset,
			select: ['user_auth_id', 'json', 'expires_at', 'created_at', 'updated_at', 'id'],
			order: [{ key: 'updated_at', direction: 'DESC' }],
			where: {
				and: [
					{ key: 'type', is: '=', value: 'auth' },
					{ key: 'user_id', is: '=', value: user_id },
				],
			},
		});
		const hasMore = sessions.length > limit;
		if (hasMore) sessions.pop();
		const list = sessions.map((session) => {
			const user_auth = this.sql.get('user_auth', session.user_auth_id);
			const oauth_token = user_auth.oauth_token_id
				? this.sql.get('oauth_token', user_auth.oauth_token_id)
				: undefined;
			const meta = JSON.parse(session.json || '{}') as UserSessionMeta;
			return {
				...meta,
				email: user_auth.email,
				vendor: oauth_token?.vendor,
				id: session.id,
				created_at: session.created_at,
				expires_at: session.expires_at,
				updated_at: session.updated_at,
			} satisfies UserSession;
		});
		return {
			list,
			count: list.length,
			hasMore,
		};
	}

	/** Signs in (or up) to an account using an oauth callback url */
	async signInWithOauth(
		oauth_token: Omit<OauthToken, 'id' | 'created_at' | 'updated_at'>,
		data: { connect_user_id?: string; invitation_id?: string },
		meta: UserSessionMeta,
	) {
		const email = oauth_token.account_email?.trim()?.toLowerCase();
		if (!email) {
			throw new DelightError({
				message: `Oauth account does not have a verified email`,
				status: 400,
				code: 'oauth/no_account_email',
			});
		}
		if (!oauth_token.vendor_id) {
			throw new DelightError({
				message: `Oauth account does not have a vendor id`,
				status: 400,
				code: 'oauth/no_vendor_id',
			});
		}
		let type: AuthOperationResult['type'] | undefined;
		let user_id: string | undefined;
		let user_auth: AuthDatabaseSchema['user_auth'] | undefined;

		// Check if the oauth account has been attached in the past
		const [existing_token] = this.sql.list('oauth_token', {
			limit: 1,
			where: {
				and: [
					{ key: 'vendor', is: '=', value: oauth_token.vendor },
					{ key: 'vendor_id', is: '=', value: oauth_token.vendor_id },
				],
			},
		});

		// The user is attempting to sign in to an existing account
		if (existing_token) {
			if (data.connect_user_id) {
				throw new DelightError({
					message: `Can't connect an oauth account that is already connected to another user`,
					status: 400,
				});
			}
			// Check if the existing oauth token is being used as a sign in method
			[user_auth] = this.sql.list('user_auth', {
				limit: 1,
				where: { key: 'oauth_token_id', is: '=', value: existing_token.id },
			});
			if (user_auth) {
				user_id = user_auth.user_id;
				type = 'signin';
			}
			if (!user_auth) {
				const hasProfilePermision = decodeOauthScopes(
					this.options.oauth_scopes,
					existing_token.capability,
				).includes(this.oauthProfileScope);
				if (!hasProfilePermision) {
					throw new DelightError({
						message: `This oauth account is already connected to another user and doesn't have the ${this.oauthProfileScope} scope`,
						status: 400,
					});
				}
				// The oauth token is not being used as a sign in method. It is being used for another vendor api (like Google Drive)
				// Check if the existing oauth token has user that "owns" it
				const [oauth_token_permission] = this.sql.list('oauth_token_permission', {
					limit: 1,
					order: [{ key: 'created_at', direction: 'ASC' }],
					where: {
						and: [
							{ key: 'oauth_token_id', is: '=', value: existing_token.id },
							{ key: 'user_id', is: '!=', value: null },
						],
					},
				});
				if (!oauth_token_permission?.user_id) {
					throw new DelightError({
						message: `This oauth account is already connected to another user and doesn't have a user id`,
						status: 400,
					});
				}

				// The existing oauth token has a user that "owns" it.
				// Allow them to sign in with this oauth token by adding it as a sign in method
				user_id = oauth_token_permission.user_id;
				type = 'new-signin-method';
			}
		}

		// Check if the user is attempting to connect an oauth account to an existing user
		if (data.connect_user_id) {
			if (user_id && user_id !== data.connect_user_id) {
				throw new DelightError({
					message: `Can't connect an oauth account that is already connected to another user`,
					status: 400,
				});
			}
			user_id = data.connect_user_id;
			const user = this.sql
				.setError(`Could not find user with id ${user_id}`, 404)
				.get('user', user_id);
			if (user.deleted_at) {
				throw new DelightError({
					message: 'This account has been deleted. Please contact support for help.',
					status: 401,
				});
			}
			type = 'new-signin-method';
		} else if (!user_id) {
			// Check if an existing user already has a sign in method with the same verified email
			const [alternative_auth] = this.sql.list('user_auth', {
				where: {
					and: [
						{ key: 'email', is: '=', value: email },
						{ key: 'verified_at', is: '!=', value: null },
					],
				},
			});
			if (alternative_auth?.user_id) {
				user_id = alternative_auth.user_id;
				const user = this.sql
					.setError(`Could not find user with id ${user_id}`, 404)
					.get('user', user_id);
				if (user.deleted_at) {
					throw new DelightError({
						message: 'This account has been deleted. Please contact support for help.',
						status: 401,
					});
				}
				type = 'new-signin-method';
			}
		}

		let org_id: string | undefined;
		let permission: number | undefined;

		// Check if the user was invited to an existing organization
		if (data.invitation_id) {
			const invitation = this.sql
				.setError(`Could not find invitation`)
				.get('org_invitation', data.invitation_id);
			permission = invitation.permission;
			org_id = invitation.org_id;
			this.sql.get('org', org_id); // this will throw if the org doesn't exist

			// Check if the user already has permission to the organization
			// If so, merge their current permissions with the new ones
			if (user_id) {
				const [existing_permission] = this.sql.list('org_user', {
					limit: 1,
					where: {
						and: [
							{ key: 'org_id', is: '=', value: org_id },
							{ key: 'user_id', is: '=', value: user_id },
						],
					},
				});
				if (existing_permission) {
					const existing_permissions = decodePermissions(
						this.options.permissions,
						existing_permission.permission,
					);
					const new_permissions = decodePermissions(this.options.permissions, permission);
					const all_permissions = encodePermissions(
						this.options.permissions,
						Array.from(new Set([...existing_permissions, ...new_permissions])),
					);
					permission = all_permissions;
				}
			}
		}

		// Check if the existing user exists and hasn't been deleted
		if (user_id) {
			const user = this.sql
				.setError(`Couldn't find user with given id`)
				.get('user', user_id);
			if (user.deleted_at) {
				throw new DelightError({
					message: `Can't sign-in to a deleted account. Please contact support for help.`,
					status: 401,
				});
			}
		}

		// The user doesn't exist yet, so create a new user
		if (!user_id) {
			user_id = generateID();
			this.sql.insert('user', user_id, {
				name: oauth_token.account_name || 'Unnamed',
				image: oauth_token.account_image,
				json: JSON.stringify({}),
			});
			type = 'signup';
		}

		// The user was invited to an existing organization, so add them to the organization
		// This needs to be done here before the 'createSessionToken' call,
		// so that the org permission data is available in the token
		if (org_id && permission) {
			this.sql.insert('org_user', null, {
				org_id,
				user_id,
				permission,
			});
		}

		const user_auth_id = user_auth?.id || generateID();
		const user_session_id = generateID();
		const oauth_token_id = existing_token?.id || generateID();

		// Hash the password and create a session token
		const { jwt, decoded_jwt } = await this.createSessionToken({
			user_auth_id,
			user_id,
			user_session_id,
			email,
			verified: true,
		});

		// Save the user data in the database
		this.sql.transaction(() => {
			if (!existing_token) {
				this.sql.insert('oauth_token', oauth_token_id, {
					json: JSON.stringify({ payload: oauth_token.payload }),
					access_token: oauth_token.access_token,
					refresh_token: oauth_token.refresh_token,
					access_token_expires_at: oauth_token.access_token_expires_at,
					refresh_token_expires_at: oauth_token.refresh_token_expires_at,
					vendor: oauth_token.vendor,
					vendor_id: oauth_token.vendor_id,
					account_email: email,
					account_name: oauth_token.account_name,
					account_image: oauth_token.account_image,
					capability: encodeOauthScopes(
						this.options.oauth_scopes,
						oauth_token.capabilities,
					),
				});
				this.sql.insert('oauth_token_permission', undefined, {
					oauth_token_id,
					user_id,
					permission: encodePermissions(this.options.permissions, [
						this.orgAdminPermission,
					]),
				});
			}
			if (existing_token) {
				const updated_email = existing_token.account_email !== email;
				const updated_name =
					oauth_token.account_name &&
					existing_token.account_name !== oauth_token.account_name;
				const updated_image =
					oauth_token.account_image &&
					existing_token.account_image !== oauth_token.account_image;
				if (updated_email || updated_name || updated_image) {
					this.sql.update('oauth_token', existing_token.id, {
						account_email: email,
						account_name: oauth_token.account_name || existing_token.account_name,
						account_image: oauth_token.account_image || existing_token.account_image,
					});
				}
			}
			if (!user_auth) {
				this.sql.insert('user_auth', user_auth_id, {
					user_id,
					email,
					verified_at: Date.now(),
					oauth_token_id,
				});
			}
			if (user_auth && user_auth.email !== email) {
				this.sql.update('user_auth', user_auth.id, { email });
			}
			this.sql.insert('user_session', user_session_id, {
				user_id,
				user_auth_id,
				jwt,
				type: 'auth',
				expires_at: decoded_jwt.exp * 1000,
				json: JSON.stringify(meta),
			});
		});

		return {
			user_id,
			user_auth_id,
			user_session_id,
			org_id,
			decoded_jwt,
			jwt,
			type: type || 'signin',
		} satisfies AuthOperationResult<'auth'>;
	}

	/** Returns the sign in method with the given id */
	getSignInMethod(user_auth_id: string) {
		const user_auth = this.sql
			.setError(`Could not find sign in method with id ${user_auth_id}`, 404)
			.get('user_auth', user_auth_id);
		const oauth_token = user_auth.oauth_token_id
			? this.sql.get('oauth_token', user_auth.oauth_token_id)
			: undefined;
		const passkey = oauth_token ? undefined : this.getPasskeyByAuthId(user_auth.id);
		return {
			id: user_auth.id,
			email: user_auth.email,
			vendor: oauth_token?.vendor || (passkey ? 'passkey' : undefined),
			vendor_id: oauth_token?.vendor_id || passkey?.id,
			created_at: user_auth.created_at,
			updated_at: user_auth.updated_at,
			refreshed_at: undefined,
			verified_at: user_auth.verified_at,
			has_password: 'password_hash' in user_auth && !!user_auth.password_hash,
		} satisfies UserSignInMethod;
	}

	/** Lists all the oauth accounts the user has permission to access */
	listSignInMethods(user_id: string) {
		const limit = 100;
		const user_auths = this.sql.list('user_auth', {
			limit,
			select: [
				'email',
				'id',
				'created_at',
				'updated_at',
				'oauth_token_id',
				'password_hash',
				'verified_at',
			],
			where: { key: 'user_id', is: '=', value: user_id },
		});
		const list = user_auths.map((user_auth) => {
			const oauth_token = user_auth.oauth_token_id
				? this.sql.get('oauth_token', user_auth.oauth_token_id)
				: undefined;
			const passkey = oauth_token ? undefined : this.getPasskeyByAuthId(user_auth.id);
			const [latest_session] = this.sql.list('user_session', {
				limit: 1,
				select: ['updated_at'],
				order: [{ key: 'updated_at', direction: 'DESC' }],
				where: {
					and: [
						{ key: 'type', is: '=', value: 'auth' },
						{ key: 'user_auth_id', is: '=', value: user_auth.id },
					],
				},
			});
			return {
				id: user_auth.id,
				email: user_auth.email,
				vendor: oauth_token?.vendor || (passkey ? 'passkey' : undefined),
				vendor_id: oauth_token?.vendor_id || passkey?.id,
				created_at: user_auth.created_at,
				updated_at: user_auth.updated_at,
				refreshed_at: latest_session?.updated_at,
				verified_at: user_auth.verified_at,
				has_password: 'password_hash' in user_auth && !!user_auth.password_hash,
			} satisfies UserSignInMethod;
		});
		return {
			list,
			count: list.length,
			hasMore: list.length === limit,
		};
	}

	/** Removes the sign in method & associated sessions/tokens for the given sign in method id */
	revokeSignInMethod(user_auth_id: string) {
		const user_auth = this.sql
			.setError(`Could not find sign in method with id ${user_auth_id}`, 404)
			.get('user_auth', user_auth_id);
		const user_id = user_auth.user_id;
		const user = this.sql
			.setError(`Could not find user with id ${user_id}`, 404)
			.get('user', user_id);
		if (user.deleted_at) {
			throw new DelightError({
				message: `Can't revoke a sign-in method for an account that is being deleted`,
				status: 401,
			});
		}
		const alternative_auths = this.sql.list('user_auth', {
			limit: 100,
			select: ['id', 'created_at', 'updated_at', 'oauth_token_id'],
			where: {
				and: [
					{ key: 'id', is: '!=', value: user_auth_id },
					{ key: 'user_id', is: '=', value: user_id },
					{ key: 'verified_at', is: '!=', value: null },
				],
			},
		});
		if (!alternative_auths.length) {
			throw new DelightError({
				message: `You cannot revoke the last verified sign in method. Please add a new sign in method before revoking this one`,
				status: 400,
			});
		}
		if (
			user.created_at < Date.now() - 1000 * 60 * 60 * 24 &&
			!alternative_auths.some(
				(auth) => auth.created_at < Date.now() - 1000 * 60 * 60 * 24,
			)
		) {
			throw new DelightError({
				message: `For security reasons, you cannot revoke a sign in method if you added a new sign in method recently. Please wait 24 hours before revoking this sign in method`,
				status: 400,
			});
		}
		let oauth_token: AuthDatabaseSchema['oauth_token'] | undefined;
		if (user_auth.oauth_token_id) {
			oauth_token = this.sql.get('oauth_token', user_auth.oauth_token_id);
		}
		const [passkey] = this.sql.list('user_passkey', {
			limit: 1,
			where: { key: 'user_auth_id', is: '=', value: user_auth_id },
		});
		this.sql.transaction(() => {
			if (user_auth.verified_at) {
				// Save the verified user auth in a deleted table in case their account is compromised and we need to prove who owned the account before
				this.sql.insert('user_auth_deleted', user_auth.id, {
					email: user_auth.email,
					user_id,
					vendor: oauth_token?.vendor || (passkey ? 'passkey' : undefined),
					vendor_id: oauth_token?.vendor_id || passkey?.id,
					password_hash: user_auth.password_hash,
					created_at: user_auth.created_at,
					updated_at: user_auth.updated_at,
					deleted_at: Date.now(),
				});
			}
			if (user_auth.oauth_token_id) {
				this.sql.delete('oauth_token', user_auth.oauth_token_id);
			}
			if (passkey) {
				this.sql.delete('user_passkey', passkey.id);
			}
			this.sql.delete('user_auth', user_auth_id);
		});
	}

	/** Changes the password for the user auth of the given user session. Returns new session information */
	async updateSignInMethodPassword(user_session_id: string, password: string) {
		if (!user_session_id) {
			throw new DelightError({ message: 'User session ID is required', status: 400 });
		}
		const user_session = this.sql
			.setError(`User session not found`)
			.get('user_session', user_session_id);
		const user_auth = this.sql
			.setError(`User sign in method not found`)
			.get('user_auth', user_session.user_auth_id);
		const user_id = user_auth.user_id;
		const user = this.sql
			.setError(`Couldn't find user with given id`)
			.get('user', user_auth.user_id);
		if (user.deleted_at) {
			throw new DelightError({
				message: `Can't update password for an account that is being deleted`,
				status: 401,
			});
		}

		if (user_auth.oauth_token_id) {
			throw new DelightError({
				message: 'You cannot change your password when using an OAuth account',
				status: 400,
			});
		}
		const signedInToday = user_session.created_at > Date.now() - 1000 * 60 * 60 * 24;
		if (!signedInToday) {
			throw new DelightError({
				message: 'For security reasons, you must sign in again to change your password',
				status: 400,
			});
		}

		await this.checkPasswordStrength(password);
		const password_hash = await this.hashPassword(password);
		const changed_password = password_hash !== user_auth.password_hash;

		// Create a new session token for the user
		const new_session = await this.createSessionToken({
			user_auth_id: user_auth.id,
			user_id,
			email: user_auth.email,
			verified: !!user_auth.verified_at,
			user_session_id,
		});

		this.sql.transaction(() => {
			if (changed_password) {
				const revoke_sessions = this.sql.list('user_session', {
					where: {
						and: [
							{ key: 'id', is: '!=', value: user_session.id },
							{ key: 'user_auth_id', is: '=', value: user_auth.id },
						],
					},
				});
				// Revoke all the user's sessions
				revoke_sessions.forEach((session) => {
					this.sql.delete('user_session', session.id);
				});
				// Update the user's password hash
				this.sql.update('user_auth', user_auth.id, {
					password_hash,
				});
			}
			this.sql.update('user_session', user_session_id, {
				type: 'auth',
				jwt: new_session.jwt,
				expires_at: new_session.decoded_jwt.exp * 1000,
			});
		});

		return {
			user_id,
			user_auth_id: user_auth.id,
			user_session_id,
			decoded_jwt: new_session.decoded_jwt,
			jwt: new_session.jwt,
			type: 'password-change',
		} satisfies AuthOperationResult<'auth'>;
	}

	/**
	 * Creates WebAuthn registration options for adding a passkey to an existing account.
	 * The returned options should be passed to `navigator.credentials.create()` in the browser
	 * (e.g. via `@simplewebauthn/browser`'s `startRegistration()`), and the browser's response
	 * passed to `verifyPasskeyRegistration()`. The challenge is stored server-side (single-use).
	 */
	async createPasskeyRegistrationOptions(
		user_id: string,
		rp: PasskeyRelyingParty,
		meta: UserSessionMeta,
	) {
		const is_allowed = this.rateLimit([meta.ip_address || '', 'passkey_options'], {
			max_tokens: 10,
			refill_every_seconds: 10,
		});
		if (!is_allowed) {
			throw new DelightError({
				message: 'Too many passkey requests. Please try again later',
				status: 429,
			});
		}
		const user = this.sql.setError(`Could not find user`).get('user', user_id);
		if (user.deleted_at) {
			throw new DelightError({
				message: 'This account has been deleted. Please contact support for help.',
				status: 401,
			});
		}
		const email = this.getPrimaryEmail(user_id);
		const existing = this.sql.list('user_passkey', {
			limit: 100,
			where: { key: 'user_id', is: '=', value: user_id },
		});
		const options = await generateRegistrationOptions({
			rpName: rp.rp_name,
			rpID: rp.rp_id,
			userID: new TextEncoder().encode(user_id),
			userName: email || user.name,
			userDisplayName: user.name,
			attestationType: 'none',
			excludeCredentials: existing.map((passkey) => ({
				id: passkey.id,
				transports: this.parsePasskeyTransports(passkey.transports),
			})),
			authenticatorSelection: {
				residentKey: 'required',
				userVerification: 'preferred',
			},
		});
		this.saveWebauthnChallenge(options.challenge, 'registration', user_id);
		return options;
	}

	/**
	 * Verifies a WebAuthn registration response and adds the passkey as a new sign-in
	 * method for the user. Must be called with the response from the browser's
	 * `navigator.credentials.create()` (started with `createPasskeyRegistrationOptions()`).
	 */
	async verifyPasskeyRegistration(
		user_id: string,
		unsafe_response: PasskeyRegistrationResponse,
		rp: PasskeyRelyingParty,
		data: { name?: string },
		_meta: UserSessionMeta,
	) {
		const response = parseSchema(PasskeyRegistrationResponse, unsafe_response);
		const user = this.sql.setError(`Could not find user`).get('user', user_id);
		if (user.deleted_at) {
			throw new DelightError({
				message: 'This account has been deleted. Please contact support for help.',
				status: 401,
			});
		}

		// Consume the single-use challenge BEFORE the async verification so a concurrent
		// request can't replay it while the input gate is open during the await
		const challenge = this.extractWebauthnChallenge(response.response.clientDataJSON);
		this.consumeWebauthnChallenge(challenge, 'registration', user_id);

		let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
		try {
			verification = await verifyRegistrationResponse({
				response: response as RegistrationResponseJSON,
				expectedChallenge: challenge,
				expectedOrigin: rp.origins,
				expectedRPID: rp.rp_id,
				requireUserVerification: false,
			});
		} catch (error) {
			throw new DelightError({
				message: `Passkey could not be verified: ${DelightError.from(error).message}`,
				status: 400,
			});
		}
		if (!verification.verified || !verification.registrationInfo) {
			throw new DelightError({ message: 'Passkey could not be verified', status: 400 });
		}
		const { credential, credentialDeviceType, credentialBackedUp, aaguid } =
			verification.registrationInfo;

		// Reject credentials that are already registered (to this or another account)
		const [existing] = this.sql.list('user_passkey', {
			limit: 1,
			select: ['id'],
			where: { key: 'id', is: '=', value: credential.id },
		});
		if (existing) {
			throw new DelightError({
				message: 'This passkey is already registered',
				status: 400,
			});
		}

		// The passkey inherits the account's email. It counts as verified if the user
		// already has a verified sign-in method (the passkey was added from an
		// authenticated session, so it's as trustworthy as the method used to sign in)
		const email = this.getPrimaryEmail(user_id) || '';
		const [verified_auth] = this.sql.list('user_auth', {
			limit: 1,
			select: ['id'],
			where: {
				and: [
					{ key: 'user_id', is: '=', value: user_id },
					{ key: 'verified_at', is: '!=', value: null },
				],
			},
		});

		const user_auth_id = generateID();
		let passkey: AuthDatabaseSchema['user_passkey'] | undefined;
		this.sql.transaction(() => {
			this.sql.insert('user_auth', user_auth_id, {
				user_id,
				email,
				verified_at: verified_auth ? Date.now() : undefined,
			});
			passkey = this.sql.insert('user_passkey', credential.id, {
				user_id,
				user_auth_id,
				public_key: isoBase64URL.fromBuffer(credential.publicKey),
				counter: credential.counter,
				device_type: credentialDeviceType,
				backed_up: credentialBackedUp ? 1 : 0,
				transports: JSON.stringify(credential.transports || []),
				name: data.name,
				aaguid,
			});
		});
		return this.convertPasskeyFromDB(passkey!);
	}

	/**
	 * Creates WebAuthn authentication options for signing in with a passkey.
	 * Uses discoverable credentials (empty allowCredentials) so the user doesn't need to
	 * enter an email first. Pass the returned options to `navigator.credentials.get()` in
	 * the browser and the response to `signInWithPasskey()`.
	 */
	async createPasskeyAuthenticationOptions(
		rp: PasskeyRelyingParty,
		meta: UserSessionMeta,
	) {
		const is_allowed = this.rateLimit([meta.ip_address || '', 'passkey_options'], {
			max_tokens: 10,
			refill_every_seconds: 10,
		});
		if (!is_allowed) {
			throw new DelightError({
				message: 'Too many passkey requests. Please try again later',
				status: 429,
			});
		}
		const options = await generateAuthenticationOptions({
			rpID: rp.rp_id,
			userVerification: 'preferred',
			allowCredentials: [],
		});
		this.saveWebauthnChallenge(options.challenge, 'authentication');
		return options;
	}

	/**
	 * Verifies a WebAuthn authentication response and signs the user in.
	 * Must be called with the response from the browser's `navigator.credentials.get()`
	 * (started with `createPasskeyAuthenticationOptions()`).
	 */
	async signInWithPasskey(
		unsafe_response: PasskeyAuthenticationResponse,
		data: { invitation_id?: string },
		rp: PasskeyRelyingParty,
		meta: UserSessionMeta,
	) {
		const response = parseSchema(PasskeyAuthenticationResponse, unsafe_response);
		const is_allowed = this.rateLimit([meta.ip_address || '', 'passkey_signin'], {
			max_tokens: 5,
			refill_every_seconds: 10,
		});
		if (!is_allowed) {
			throw new DelightError({
				message: 'Too many failed sign in attempts. Please try again later',
				status: 429,
			});
		}

		// Consume the single-use challenge BEFORE the async verification so a concurrent
		// request can't replay it while the input gate is open during the await
		const challenge = this.extractWebauthnChallenge(response.response.clientDataJSON);
		this.consumeWebauthnChallenge(challenge, 'authentication');

		const [passkey] = this.sql.list('user_passkey', {
			limit: 1,
			where: { key: 'id', is: '=', value: response.id },
		});
		if (!passkey) {
			throw new DelightError({ message: 'Passkey not recognized', status: 401 });
		}
		const user = this.sql
			.setError(`Couldn't find user with given id`)
			.get('user', passkey.user_id);
		if (user.deleted_at) {
			throw new DelightError({
				message: 'This account has been deleted. Please contact support for help.',
				status: 401,
			});
		}
		const user_auth = this.sql
			.setError(`Could not find passkey sign in method`)
			.get('user_auth', passkey.user_auth_id);

		// If the authenticator reports which user it belongs to, make sure it matches
		if (response.response.userHandle) {
			const user_handle = isoBase64URL.toUTF8String(response.response.userHandle);
			if (user_handle !== passkey.user_id) {
				throw new DelightError({ message: 'Passkey not recognized', status: 401 });
			}
		}

		let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
		try {
			verification = await verifyAuthenticationResponse({
				response: response as AuthenticationResponseJSON,
				expectedChallenge: challenge,
				expectedOrigin: rp.origins,
				expectedRPID: rp.rp_id,
				requireUserVerification: false,
				credential: {
					id: passkey.id,
					publicKey: isoBase64URL.toBuffer(passkey.public_key),
					counter: passkey.counter,
					transports: this.parsePasskeyTransports(passkey.transports),
				},
			});
		} catch (error) {
			throw new DelightError({
				message: `Passkey could not be verified: ${DelightError.from(error).message}`,
				status: 401,
			});
		}
		if (!verification.verified) {
			throw new DelightError({ message: 'Passkey could not be verified', status: 401 });
		}

		// Check if the user was invited to an existing organization
		let org_id: string | undefined;
		let permission: number | undefined;
		if (data.invitation_id) {
			const invitation = this.sql
				.setError(`Could not find invitation`)
				.get('org_invitation', data.invitation_id);
			permission = invitation.permission;
			org_id = invitation.org_id;
		}
		if (org_id && permission) {
			const [existing_permission] = this.sql.list('org_user', {
				limit: 1,
				where: {
					and: [
						{ key: 'org_id', is: '=', value: org_id },
						{ key: 'user_id', is: '=', value: passkey.user_id },
					],
				},
			});
			if (existing_permission) {
				const existing_permissions = decodePermissions(
					this.options.permissions,
					existing_permission.permission,
				);
				const new_permissions = decodePermissions(this.options.permissions, permission);
				const all_permissions = encodePermissions(
					this.options.permissions,
					Array.from(new Set([...existing_permissions, ...new_permissions])),
				);
				this.sql.update('org_user', existing_permission.id, {
					permission: all_permissions,
				});
			} else {
				this.sql.insert('org_user', null, {
					org_id,
					user_id: passkey.user_id,
					permission,
				});
			}
		}

		const user_session_id = generateID();
		const { jwt, decoded_jwt } = await this.createSessionToken({
			user_auth_id: passkey.user_auth_id,
			user_id: passkey.user_id,
			user_session_id,
			email: user_auth.email,
			verified: !!user_auth.verified_at,
		});
		this.sql.transaction(() => {
			this.sql.update('user_passkey', passkey.id, {
				counter: verification.authenticationInfo.newCounter,
				last_used_at: Date.now(),
			});
			this.sql.insert('user_session', user_session_id, {
				type: 'auth',
				jwt,
				user_id: passkey.user_id,
				user_auth_id: passkey.user_auth_id,
				expires_at: decoded_jwt.exp * 1000,
				json: JSON.stringify(meta),
			});
		});
		return {
			jwt,
			decoded_jwt,
			user_id: passkey.user_id,
			user_auth_id: passkey.user_auth_id,
			user_session_id,
			org_id,
			type: 'signin',
		} satisfies AuthOperationResult;
	}

	/** Lists the passkeys registered to the user with the given id */
	listPasskeys(user_id: string) {
		const passkeys = this.sql.list('user_passkey', {
			limit: 100,
			order: [{ key: 'created_at', direction: 'ASC' }],
			where: { key: 'user_id', is: '=', value: user_id },
		});
		const list = passkeys.map((passkey) => this.convertPasskeyFromDB(passkey));
		return { list, count: list.length, hasMore: false };
	}

	/** Updates the user-facing label of a passkey. The passkey must belong to the given user */
	updatePasskey(user_id: string, passkey_id: string, data: { name?: string }) {
		const passkey = this.getOwnedPasskey(user_id, passkey_id);
		const updated = this.sql.update('user_passkey', passkey.id, { name: data.name });
		return this.convertPasskeyFromDB(updated);
	}

	/**
	 * Removes a passkey (and its backing sign-in method) from the user's account.
	 * Applies the same safety rules as revoking any other sign-in method
	 * (e.g. can't remove the last verified method).
	 */
	deletePasskey(user_id: string, passkey_id: string) {
		const passkey = this.getOwnedPasskey(user_id, passkey_id);
		this.revokeSignInMethod(passkey.user_auth_id);
	}

	/** Returns the passkey with the given id, throwing if it doesn't belong to the user */
	private getOwnedPasskey(user_id: string, passkey_id: string) {
		const [passkey] = this.sql.list('user_passkey', {
			limit: 1,
			where: {
				and: [
					{ key: 'id', is: '=', value: passkey_id },
					{ key: 'user_id', is: '=', value: user_id },
				],
			},
		});
		if (!passkey) {
			throw new DelightError({ message: 'Could not find passkey', status: 404 });
		}
		return passkey;
	}

	/** Returns the passkey backing the given user_auth id (if any) */
	private getPasskeyByAuthId(user_auth_id: string) {
		const [passkey] = this.sql.list('user_passkey', {
			limit: 1,
			select: ['id', 'user_auth_id'],
			where: { key: 'user_auth_id', is: '=', value: user_auth_id },
		});
		return passkey;
	}

	/** Returns the user's primary email (preferring verified sign-in methods) */
	private getPrimaryEmail(user_id: string): string | undefined {
		const auths = this.sql.list('user_auth', {
			limit: 100,
			select: ['email', 'verified_at', 'created_at'],
			order: [{ key: 'created_at', direction: 'ASC' }],
			where: { key: 'user_id', is: '=', value: user_id },
		});
		return (auths.find((auth) => auth.verified_at) || auths[0])?.email;
	}

	/** How long a WebAuthn challenge stays valid before the ceremony must be restarted */
	private static readonly WEBAUTHN_CHALLENGE_TTL_MS = 1000 * 60 * 5;

	/** Stores a single-use WebAuthn challenge (and sweeps expired ones) */
	private saveWebauthnChallenge(
		challenge: string,
		type: 'registration' | 'authentication',
		user_id?: string,
	) {
		const now = Date.now();
		this.sql.run((sql) => sql`DELETE FROM webauthn_challenge WHERE expires_at < ${now}`);
		this.sql.insert('webauthn_challenge', challenge, {
			type,
			user_id,
			expires_at: now + AuthDatabaseServer.WEBAUTHN_CHALLENGE_TTL_MS,
		});
	}

	/**
	 * Validates & deletes a stored WebAuthn challenge (single-use).
	 * Throws if the challenge wasn't issued by this server, is expired, or was
	 * issued for a different ceremony type/user.
	 */
	private consumeWebauthnChallenge(
		challenge: string,
		type: 'registration' | 'authentication',
		user_id?: string,
	) {
		const [stored] = this.sql.list('webauthn_challenge', {
			limit: 1,
			where: { key: 'id', is: '=', value: challenge },
		});
		const valid =
			stored &&
			stored.type === type &&
			stored.expires_at > Date.now() &&
			(!user_id || stored.user_id === user_id);
		if (stored) this.sql.delete('webauthn_challenge', stored.id);
		if (!valid) {
			throw new DelightError({
				message: 'Invalid or expired passkey challenge. Please try again',
				status: 400,
			});
		}
	}

	/** Extracts the challenge from a WebAuthn response's clientDataJSON (base64url) */
	private extractWebauthnChallenge(client_data_json: string): string {
		try {
			const client_data = JSON.parse(isoBase64URL.toUTF8String(client_data_json)) as {
				challenge?: string;
			};
			if (typeof client_data.challenge === 'string' && client_data.challenge) {
				return client_data.challenge;
			}
		} catch {
			// fall through to the error below
		}
		throw new DelightError({ message: 'Invalid passkey response', status: 400 });
	}

	/** Parses the JSON transports column into the typed array simplewebauthn expects */
	private parsePasskeyTransports(
		transports: string | undefined,
	): AuthenticatorTransportFuture[] | undefined {
		if (!transports) return undefined;
		try {
			const parsed = JSON.parse(transports);
			return Array.isArray(parsed) ? parsed : undefined;
		} catch {
			return undefined;
		}
	}

	private convertPasskeyFromDB(passkey: AuthDatabaseSchema['user_passkey']): Passkey {
		return {
			id: passkey.id,
			user_auth_id: passkey.user_auth_id,
			name: passkey.name || undefined,
			device_type: passkey.device_type as Passkey['device_type'],
			backed_up: !!passkey.backed_up,
			transports: this.parsePasskeyTransports(passkey.transports),
			last_used_at: passkey.last_used_at || undefined,
			created_at: passkey.created_at,
			updated_at: passkey.updated_at,
		};
	}

	/** Updates an existing oauth permission to allow (or disallow users) */
	async updateOauthAccountPermissions(
		oauth_token_permission_id: string,
		oauth_token_permission: AuthDatabaseSchema['oauth_token_permission'],
	) {
		return this.sql.update(
			'oauth_token_permission',
			oauth_token_permission_id,
			oauth_token_permission,
		);
	}

	/** Updates an existing oauth permission to allow (or disallow users) */
	async createOauthAccountPermissions(
		oauth_token_permission: AuthDatabaseSchema['oauth_token_permission'],
	) {
		if (oauth_token_permission.user_id) {
			const [existing_permission] = this.sql.list('oauth_token_permission', {
				limit: 1,
				where: {
					and: [
						{
							key: 'oauth_token_id',
							is: '=',
							value: oauth_token_permission.oauth_token_id,
						},
						{ key: 'user_id', is: '=', value: oauth_token_permission.user_id },
					],
				},
			});
			if (existing_permission) {
				throw new DelightError({
					message: `User already has permission to access this oauth account`,
					status: 400,
				});
			}
		}
		return this.sql.insert('oauth_token_permission', undefined, oauth_token_permission);
	}

	/** Adds the given new oauth token to the given user's account */
	connectOauthAccount(
		oauth_token: Omit<OauthToken, 'id' | 'created_at' | 'updated_at'>,
		user_id: string,
	) {
		const update: AuthDatabaseSchema['oauth_token'] = this.convertOauthTokenToDB(
			oauth_token as any,
		);
		delete (update as any)['id'];
		delete (update as any)['created_at'];
		delete (update as any)['updated_at'];

		const [existing_token] = this.sql.list('oauth_token', {
			where: {
				and: [
					{ key: 'vendor', is: '=', value: oauth_token.vendor },
					{ key: 'vendor_id', is: '=', value: oauth_token.vendor_id },
				],
			},
			limit: 1,
		});

		let new_token: AuthDatabaseSchema['oauth_token'];
		if (existing_token) {
			new_token = this.sql.update('oauth_token', existing_token.id, update);
		} else {
			new_token = this.sql.insert('oauth_token', undefined, update);
		}
		const [existing_permission] = this.sql.list('oauth_token_permission', {
			where: {
				and: [
					{ key: 'user_id', is: '=', value: user_id },
					{ key: 'oauth_token_id', is: '=', value: new_token.id },
				],
			},
			limit: 1,
		});
		if (existing_permission) {
			this.sql.update('oauth_token_permission', existing_permission.id, {
				oauth_token_id: new_token.id,
			});
		} else {
			this.sql.insert('oauth_token_permission', undefined, {
				oauth_token_id: new_token.id,
				user_id,
				permission: encodePermissions(this.options.permissions, [
					this.orgAdminPermission,
				]),
			});
		}

		return this.convertOauthTokenFromDB(new_token);
	}

	/** Removes an oauth account/token from all user's accounts */
	disconnectOauthAccount(oauth_token: OauthToken) {
		const [user_auth] = this.sql.list('user_auth', {
			select: ['id'],
			limit: 1,
			where: {
				and: [{ key: 'oauth_token_id', is: '=', value: oauth_token.id }],
			},
		});
		if (user_auth) {
			throw new DelightError({
				message: `You cannot revoke an oauth account that is used to sign in`,
				status: 400,
			});
		}
		this.sql.delete('oauth_token', oauth_token.id);
	}

	/** Updates the oauth token id with the given oauth token */
	updateOauthToken(
		oauth_token_id: string,
		oauth_token: Omit<OauthToken, 'id' | 'created_at' | 'updated_at'>,
	) {
		const update: Partial<AuthDatabaseSchema['oauth_token']> = this.convertOauthTokenToDB(
			oauth_token as any,
		);
		delete update['id'];
		delete update['created_at'];
		delete update['updated_at'];
		const updated = this.sql.update('oauth_token', oauth_token_id, update);
		return this.convertOauthTokenFromDB(updated);
	}

	/** Returns the oauth token with the given id */
	getOauthToken(oauth_token_id: string): OauthToken {
		const token = this.sql.get('oauth_token', oauth_token_id);
		return this.convertOauthTokenFromDB(token);
	}

	/** Lists all the oauth accounts the user has permission to access */
	listOauthAccounts(user_id: string, org_id: string) {
		const { list: org_permissions } = this.getUserPermissions(user_id, org_id);
		const token_permissions = this.sql.list('oauth_token_permission', {
			where: {
				or: [
					{ key: 'user_id', is: '=', value: user_id },
					...org_permissions.map((permission) => {
						const org_permission = encodePermissions(this.options.permissions, [
							permission,
						]);
						return {
							and: [
								{ key: 'org_id', is: '=', value: org_id } as const,
								{ key: 'org_permission', is: '&=', value: org_permission } as const,
							],
						};
					}),
				],
			},
		});
		const oauth_token_permissions = token_permissions.reduce(
			(acc, token_permission) => {
				const new_permissions = decodePermissions(
					this.options.permissions,
					token_permission.permission,
				);
				acc[token_permission.oauth_token_id] = Array.from(
					new Set([...(acc[token_permission.oauth_token_id] || []), ...new_permissions]),
				);
				return acc;
			},
			{} as Record<string, string[]>,
		);
		const list = Object.entries(oauth_token_permissions).map(
			([token_id, permissions]) => {
				const oauth_token = this.sql.get('oauth_token', token_id);
				return {
					id: token_id,
					vendor: oauth_token.vendor,
					vendor_id: oauth_token.vendor_id,
					permissions: permissions,
					capabilities: decodeOauthScopes(
						this.options.oauth_scopes,
						oauth_token.capability,
					),
					account_name: oauth_token.account_name,
					account_email: oauth_token.account_email,
					account_image: oauth_token.account_image,
					created_at: oauth_token.created_at,
					updated_at: oauth_token.updated_at,
				} satisfies OauthAccount;
			},
		);
		return {
			list,
			count: list.length,
			hasMore: false,
		};
	}

	/** Returns the permissions the user has for the given oauth account */
	getOauthAccountPermissions(user_id: string, org_id: string, oauth_token_id: string) {
		const { list: org_permissions } = this.getUserPermissions(user_id, org_id);
		const token_permissions = this.sql.list('oauth_token_permission', {
			limit: 1,
			where: {
				and: [
					{ key: 'oauth_token_id', is: '=', value: oauth_token_id },
					{
						or: [
							{ key: 'user_id', is: '=', value: user_id },
							...org_permissions.map((permission) => {
								const org_permission = encodePermissions(this.options.permissions, [
									permission,
								]);
								return {
									and: [
										{ key: 'org_id', is: '=', value: org_id } as const,
										{ key: 'org_permission', is: '&=', value: org_permission } as const,
									],
								};
							}),
						],
					},
				],
			},
		});
		let permissions: string[] = [];
		token_permissions.forEach((token_permission) =>
			permissions.push(
				...decodePermissions(this.options.permissions, token_permission.permission),
			),
		);
		permissions = Array.from(new Set(permissions));
		return {
			list: permissions,
			count: permissions.length,
			hasMore: false,
		};
	}

	/** Updates the user with the given id with the given user data */
	updateUser(user_id: string, unsafe_data: UpdateUser) {
		const user = parseSchema(UpdateUser, unsafe_data);
		const current_user = this.sql.get('user', user_id);
		if (current_user.deleted_at) {
			throw new DelightError({
				message: `Can't update an account that is being deleted`,
				status: 401,
			});
		}
		if (!Object.keys(user).length) return current_user;
		return this.sql.update('user', user_id, {
			name: user.name || current_user.name,
			image: user.image || current_user.image,
			json: JSON.stringify({ ...JSON.parse(current_user?.json || '{}'), ...user }),
		});
	}

	/**
	 * Reads the user's preferences from the `user.json` column.
	 * Preferences are stored under the `preferences` key within the JSON object.
	 * Returns an empty object if no preferences exist.
	 */
	getUserPreferences(user_id: string): Record<string, unknown> {
		const user = this.sql.get('user', user_id);
		const json = JSON.parse(user?.json || '{}');
		return (json.preferences as Record<string, unknown>) || {};
	}

	/**
	 * Writes user preferences into the `user.json` column under the `preferences` key.
	 * Preserves any other data already stored in the JSON column.
	 */
	setUserPreferences(user_id: string, preferences: Record<string, unknown>): void {
		const user = this.sql.get('user', user_id);
		const json = JSON.parse(user?.json || '{}');
		json.preferences = preferences;
		this.sql.update('user', user_id, { json: JSON.stringify(json) });
	}

	/** Returns the list of permissions the user has in the given org */
	getUserPermissions(user_id: string, org_id: string) {
		const [org_user] = this.sql.list('org_user', {
			limit: 1,
			select: ['permission'],
			where: {
				and: [
					{ key: 'org_id', is: '=', value: org_id },
					{ key: 'user_id', is: '=', value: user_id },
				],
			},
		});
		if (!org_user) return { list: [], count: 0, hasMore: false };
		const list = decodePermissions(this.options.permissions, org_user.permission);
		return {
			list,
			count: list.length,
			hasMore: false,
		};
	}

	/**
	 * Updates the user's permissions in the given organization
	 * Use '0' or an empty array to remove the user from the organization
	 * If a number is provided, it is treated as an encoded permission integer
	 * If an array of permission strings is provided, it is encoded before being used
	 */
	updateUserPermission(
		user_id: string,
		org_id: string,
		encodedOrDecodedPermission: number | string[],
	) {
		const permission =
			typeof encodedOrDecodedPermission === 'number'
				? encodedOrDecodedPermission
				: encodePermissions(this.options.permissions, encodedOrDecodedPermission);
		const decoded = decodePermissions(this.options.permissions, permission);
		if (decoded.includes('superadmin:read') || decoded.includes('superadmin:write')) {
			throw new DelightError({
				message: `You cannot assign superadmin permissions to a user`,
				status: 400,
			});
		}
		const [current_org_user] = this.sql.list('org_user', {
			limit: 1,
			where: {
				and: [
					{ key: 'user_id', is: '=', value: user_id },
					{ key: 'org_id', is: '=', value: org_id },
				],
			},
		});
		const current_permissions = decodePermissions(
			this.options.permissions,
			current_org_user?.permission || 0,
		);

		// Check if the user doesn't belong to the org yet
		if (!current_org_user) {
			if (!permission) return;
			this.sql.insert('org_user', null, {
				org_id,
				user_id,
				permission,
			});
			return;
		}
		if (permission === current_org_user.permission) return;

		// Update the user's role in the organization
		if (permission) {
			this.sql.update('org_user', current_org_user.id, {
				permission,
			});
			return;
		}

		// Remove the user from the organization if they are not currently an
		// admin. (This must use the configured admin permission — a hardcoded
		// name silently disabled the only-admin protection for every app with
		// its own permission set.)
		if (!current_permissions.includes(this.orgAdminPermission)) {
			this.sql.delete('org_user', current_org_user.id);
			return;
		}

		// Check if the user is the only admin in the org
		const [other_admin] = this.sql.query('org_user', {
			limit: 1,
			where: {
				and: [
					{ key: 'user_id', is: '!=', value: user_id },
					{ key: 'org_id', is: '=', value: org_id },
					{
						key: 'permission',
						is: '&=',
						value: encodePermissions(this.options.permissions, [this.orgAdminPermission]),
					},
				],
			},
		});
		if (!other_admin) {
			throw new DelightError({
				message: 'Cannot remove the only admin from the organization',
				status: 400,
			});
		}
		this.sql.delete('org_user', current_org_user.id);
	}

	/** Deletes the user data with the given ID */
	deleteUser(id: string) {
		this.sql
			.list('oauth_token_permission', {
				where: { key: 'user_id', is: '=', value: id },
				limit: 10000,
			})
			.forEach((permission) => {
				this.sql.delete('oauth_token', permission.oauth_token_id);
			});
		this.sql.delete('user', id);
	}

	/** Marks the user as deleted so no further actions can be taken on the account while their data is deleted */
	markUserDeleted(user_id: string, undeleted = false) {
		this.sql.update('user', user_id, {
			deleted_at: undeleted ? (null as unknown as undefined) : Date.now(),
		});
	}

	/** Checks if the email is available for signup. @throws if not available */
	checkEmailAvailability({
		email: raw_email,
		ip_address,
	}: {
		email: string;
		ip_address?: string;
	}) {
		const email = raw_email.trim().toLowerCase();
		if (!email) {
			throw new DelightError({ message: 'Email is required', status: 400 });
		}
		if (email.length > 255) {
			throw new DelightError({ message: 'Email is too long', status: 400 });
		}
		if (!email.includes('@')) {
			throw new DelightError({
				message: `Invalid email. Email doesn't contain '@' symbol`,
				status: 400,
			});
		}
		if (!email.match(/^[^@]+@/)) {
			throw new DelightError({
				message: `Invalid email. Email doesn't contain a character before the '@' symbol`,
				status: 400,
			});
		}
		if (!email.match(/@[^.]+\.[^.]+/)) {
			throw new DelightError({ message: `Invalid email domain`, status: 400 });
		}

		// Limit the number of requests that can be made to this endpoint
		const is_allowed = this.rateLimit([ip_address || '', 'email_availability_check'], {
			max_tokens: 10,
			refill_every_seconds: 10,
		});
		if (!is_allowed) {
			throw new DelightError({
				message: 'Too many email availability checks. Please try again later',
				status: 429,
			});
		}

		const [user_auth] = this.sql.list('user_auth', {
			select: ['id'],
			limit: 1,
			where: {
				and: [
					{ key: 'email', is: '=', value: email },
					{ key: 'oauth_token_id', is: '=', value: null },
				],
			},
		});
		if (user_auth) {
			throw new DelightError({ message: 'Email is already in use', status: 400 });
		}
	}

	/** Creates an email verification JWT that can be sent to the user's email */
	async createEmailVerificationToken(
		user_session_id: string,
		meta: UserSessionMeta,
		options?: { code?: boolean },
	) {
		if (!user_session_id) {
			throw new DelightError({ message: 'User session ID is required', status: 400 });
		}
		const user_session = this.sql
			.setError(`User session not found`)
			.get('user_session', user_session_id);
		const user_auth = this.sql
			.setError(`User sign in method not found`)
			.get('user_auth', user_session.user_auth_id);
		const now = Date.now();
		const user_auth_id = user_auth.id;
		const user_id = user_auth.user_id;

		let jwt: Awaited<ReturnType<typeof generateJwt<'email_verification'>>>;
		try {
			jwt = await generateJwt(this.options.secret, {
				sub: user_auth_id, // The ID of the user's auth method used to sign in
				uid: user_id, // The user's ID
				iat: Math.floor(now / 1000),
				exp: Math.floor(now / 1000) + 60 * 60,
				typ: 'email_verification',
				iss: this.options.issuer,
			});
		} catch {
			throw new DelightError({
				message: 'Failed to generate email verification token',
				status: 500,
			});
		}

		// Optionally generate a one-time code the user can type instead of clicking the link
		const code = options?.code ? generateEmailCode() : undefined;
		const code_hash = code ? await hashEmailCode(jwt.decoded_jwt.jti, code) : undefined;

		try {
			this.sql.insert('user_session', jwt.decoded_jwt.jti, {
				type: 'email_verification',
				user_id,
				user_auth_id,
				jwt: jwt.jwt,
				expires_at: jwt.decoded_jwt.exp * 1000,
				json: JSON.stringify(meta || {}),
				code_hash,
				code_attempts: code ? 0 : undefined,
			});
		} catch {
			throw new DelightError({
				message: 'Failed to create email verification token',
				status: 500,
			});
		}
		return {
			user_id,
			user_auth_id,
			user_session_id,
			jwt: jwt.jwt,
			decoded_jwt: jwt.decoded_jwt,
			type: 'other',
			code,
		} satisfies AuthOperationResult & { code?: string };
	}

	/**
	 * Creates an email sign in token that can be used to sign in the user via a "magic" email link
	 * This token is valid for 1 hour and can be used to sign in the user without a password
	 * The token will be traded for a session token when the user clicks the link in the email.
	 * Pass `{ code: true }` to also generate a one-time code (returned as `code`) that can be
	 * traded for a session via 'signInWithEmailCode'.
	 */
	async createEmailSignInToken(
		email: string,
		meta: UserSessionMeta,
		options?: { code?: boolean },
	): Promise<AuthOperationResult<'email_signin'> & { code?: string }> {
		if (!email) {
			throw new DelightError({ message: 'Email is required', status: 400 });
		}

		// Limit how often sign-in emails can be requested from one address
		const is_allowed = this.rateLimit([meta.ip_address || '', 'create_email_signin'], {
			max_tokens: 5,
			refill_every_seconds: 30,
		});
		if (!is_allowed) {
			throw new DelightError({
				message: 'Too many sign-in email requests. Please try again later',
				status: 429,
			});
		}

		// Get the user's auth details
		const [user_auth] = this.sql.list('user_auth', {
			limit: 1,
			where: {
				and: [
					{ key: 'email', is: '=', value: email.trim().toLowerCase() },
					{ key: 'oauth_token_id', is: '=', value: null },
				],
			},
		});
		const user = this.sql
			.setError(`Couldn't find user with given email`)
			.get('user', user_auth.user_id);
		if (user.deleted_at) {
			throw new DelightError({
				message: 'This account has been deleted. Please contact support for help.',
				status: 401,
			});
		}

		const now = Date.now();
		let jwt: Awaited<ReturnType<typeof generateJwt<'email_signin'>>>;
		try {
			jwt = await generateJwt(this.options.secret, {
				sub: user_auth.id, // The ID of the user's auth method used to sign in
				iat: Math.floor(now / 1000),
				exp: Math.floor(now / 1000) + 60 * 60,
				typ: 'email_signin',
				uid: user_auth.user_id, // The user's ID
				iss: this.options.issuer,
			});
		} catch {
			throw new DelightError({
				message: 'Failed to generate email sign in token',
				status: 500,
			});
		}

		// Optionally generate a one-time code the user can type instead of clicking the link
		const code = options?.code ? generateEmailCode() : undefined;
		const code_hash = code ? await hashEmailCode(jwt.decoded_jwt.jti, code) : undefined;

		try {
			this.sql.insert('user_session', jwt.decoded_jwt.jti, {
				type: 'email_signin',
				jwt: jwt.jwt,
				user_id: user_auth.user_id,
				user_auth_id: user_auth.id,
				expires_at: jwt.decoded_jwt.exp * 1000,
				json: JSON.stringify(meta || {}),
				code_hash,
				code_attempts: code ? 0 : undefined,
			});
		} catch {
			throw new DelightError({
				message: 'Failed to create email sign in token',
				status: 500,
			});
		}
		return {
			user_id: user_auth.user_id,
			user_auth_id: user_auth.id,
			user_session_id: jwt.decoded_jwt.jti,
			jwt: jwt.jwt,
			decoded_jwt: jwt.decoded_jwt,
			type: 'other',
			code,
		} satisfies AuthOperationResult & { code?: string };
	}

	/** Marks the user's email verified based on the provided email verification token */
	async verifyEmail(email_verification_token: string, meta: UserSessionMeta) {
		let token: Awaited<ReturnType<typeof decodeJwt>>;
		try {
			token = await decodeJwt(this.options.secret, email_verification_token);
		} catch {
			throw new DelightError({
				message: 'Invalid or expired email verification link',
				status: 400,
			});
		}
		if (token.typ !== 'email_verification') {
			throw new DelightError({ message: 'Invalid email verification link', status: 400 });
		}

		return this.completeEmailVerification(
			{
				user_session_id: token.jti,
				user_auth_id: token.sub,
				user_id: token.uid,
				used_error: `Email verification link has already been used`,
			},
			meta,
		);
	}

	/**
	 * Marks the user's email verified with a one-time code sent to their email.
	 * Call 'createEmailVerificationToken' with `{ code: true }` to generate the code, then
	 * email it to the user. Codes are checked case-insensitively; only the most recently
	 * issued code is valid, and a code is invalidated after too many wrong guesses.
	 * @param auth_session_id - The id (jti) of the signed-in user's current auth session
	 */
	async verifyEmailWithCode(
		auth_session_id: string,
		raw_code: string,
		meta: UserSessionMeta,
	) {
		const code = (raw_code || '').trim().toLowerCase();

		// Limit the number of guesses that can be made from one address
		const is_allowed = this.rateLimit([meta.ip_address || '', 'email_code_verify'], {
			max_tokens: 5,
			refill_every_seconds: 10,
		});
		if (!is_allowed) {
			throw new DelightError({
				message: 'Too many failed sign in attempts. Please try again later',
				status: 429,
			});
		}

		const invalidCode = () =>
			new DelightError({
				message: 'Incorrect or expired verification code',
				status: 400,
			});
		if (!code) throw invalidCode();

		// Resolve the sign-in method being verified from the caller's auth session
		const auth_session = this.sql
			.setError(`User session not found`)
			.get('user_session', auth_session_id);

		// Only the most recently issued code is valid — older pending codes are ignored
		const pending = this.sql
			.list('user_session', {
				where: {
					and: [
						{ key: 'user_auth_id', is: '=', value: auth_session.user_auth_id },
						{ key: 'type', is: '=', value: 'email_verification' },
					],
				},
			})
			.filter((s) => s.code_hash && (s.expires_at ?? 0) > Date.now())
			.sort((a, b) => b.created_at - a.created_at)[0];
		if (!pending) throw invalidCode();

		// Burn an attempt before comparing so every guess counts, even if the request is
		// interrupted. The counter is persistent, so guessing can't be reset by DO eviction
		// or spread across IP addresses. Past the limit even the correct code is rejected
		const attempts = (pending.code_attempts ?? 0) + 1;
		this.sql.update('user_session', pending.id, { code_attempts: attempts });
		if (attempts > EMAIL_CODE_MAX_ATTEMPTS) throw invalidCode();

		const code_hash = await hashEmailCode(pending.id, code);
		if (code_hash !== pending.code_hash) throw invalidCode();

		return this.completeEmailVerification(
			{
				user_session_id: pending.id,
				user_auth_id: pending.user_auth_id,
				user_id: pending.user_id,
				used_error: `Verification code has already been used`,
			},
			meta,
		);
	}

	/**
	 * Shared completion for email verification via link & code: consumes the pending
	 * 'email_verification' session, marks the sign-in method verified, revokes the user's
	 * existing sessions, and returns a fresh auth session.
	 */
	private async completeEmailVerification(
		params: {
			user_session_id: string;
			user_auth_id: string;
			user_id: string;
			used_error: string;
		},
		meta: UserSessionMeta,
	) {
		const { user_session_id, user_auth_id, user_id, used_error } = params;

		// Check if the token has already been used (deleted from database)
		this.sql.setError(used_error, 400).get('user_session', user_session_id);

		const user = this.sql
			.setError(`Couldn't find user with given id`)
			.get('user', user_id);
		if (user.deleted_at) {
			throw new DelightError({
				message: `This account has been deleted. Please contact support for help.`,
				status: 401,
			});
		}

		// Check if the user is already verified
		const user_auth = this.sql
			.setError(`Could not find email sign in method`)
			.get('user_auth', user_auth_id);
		if (user_auth.verified_at) {
			throw new DelightError({
				message: `Email is already verified. You can now sign in using this email`,
				status: 400,
			});
		}

		// Create a new session token for the user because we encode the email verification status in the token
		const new_session_id = generateID();
		const new_session = await this.createSessionToken({
			user_auth_id,
			user_id,
			verified: true,
			user_session_id: new_session_id,
		});

		this.sql.transaction(() => {
			// Re-check inside the transaction: the awaits above yield the Durable Object's
			// input gate, so a concurrent request with the same token may have already
			// consumed it between the checks above and this point
			this.sql.setError(used_error, 400).get('user_session', user_session_id);
			if (this.sql.get('user_auth', user_auth_id).verified_at) {
				throw new DelightError({
					message: `Email is already verified. You can now sign in using this email`,
					status: 400,
				});
			}
			const user_sessions = this.sql.list('user_session', {
				where: { key: 'user_auth_id', is: '=', value: user_auth_id },
			});
			// Revoke all the user's sessions (including the email verification session so it can't be used again)
			user_sessions.forEach((session) => {
				this.sql.delete('user_session', session.id);
			});
			this.sql.update('user_auth', user_auth_id, { verified_at: Date.now() });
			this.sql.insert('user_session', new_session_id, {
				type: 'auth',
				jwt: new_session.jwt,
				user_id,
				user_auth_id,
				expires_at: new_session.decoded_jwt.exp * 1000,
				json: JSON.stringify(meta || {}),
			});
		});

		return {
			jwt: new_session.jwt,
			decoded_jwt: new_session.decoded_jwt,
			user_id: user_id,
			user_auth_id: user_auth_id,
			user_session_id: new_session_id,
			type: 'signin',
		} satisfies AuthOperationResult;
	}

	/** Checks the strength of the password. @throws an error if it's not strong enough */
	async checkPasswordStrength(password: string) {
		if (password.length < 8) {
			throw new DelightError({
				message: 'Password must be at least 8 characters long',
				status: 400,
			});
		}
		if (password.length > 255) {
			throw new DelightError({
				message: 'Password must be less than 256 characters long',
				status: 400,
			});
		}
		const sha1 = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
		const hashArray = Array.from(new Uint8Array(sha1));
		const hash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
		const hashPrefix = hash.slice(0, 5);
		const response = await fetch(`https://api.pwnedpasswords.com/range/${hashPrefix}`);
		if (!response.ok) return;
		const data = await response.text();
		const items = data.split('\n');
		for (const item of items) {
			const hashSuffix = item.slice(0, 35).toLowerCase();
			if (hash === hashPrefix + hashSuffix) {
				throw new DelightError({
					message:
						'Password is too common or has been compromised. Please choose a unique password.',
					status: 400,
				});
			}
		}
	}

	/** Checks if the email and password match a user in the database. @throws if email or password is incorrect */
	async checkEmailAndPassword({
		email,
		password,
		ip_address,
	}: {
		email: string;
		password: string;
		ip_address?: string;
	}) {
		// Limit the number of requests that can be made to this endpoint
		const is_allowed = this.rateLimit([ip_address || '', 'check_email_and_password'], {
			max_tokens: 5,
			refill_every_seconds: 10,
		});
		if (!is_allowed) {
			throw new DelightError({
				message: 'Too many email & password checks. Please try again later',
				status: 429,
			});
		}

		const formatted_email = email.trim().toLowerCase();
		if (!formatted_email) {
			throw new DelightError({ message: 'Email is required', status: 400 });
		}
		if (!password) {
			throw new DelightError({ message: 'Password is required', status: 400 });
		}
		const [user_auth] = this.sql.list('user_auth', {
			limit: 1,
			where: {
				and: [
					{ key: 'email', is: '=', value: formatted_email },
					{ key: 'password_hash', is: '!=', value: null },
				],
			},
		});
		if (!user_auth?.password_hash) {
			await argon2Verify({ hash: await getDummyHash(), password }).catch(() => {});
			throw new DelightError({ message: 'Incorrect email or password', status: 401 });
		}
		await this.verifyPasswordHash(password, user_auth.password_hash);
	}

	/** Creates a password reset JWT that can be sent to the user so they can visit the link and reset their password */
	async createPasswordResetToken(email: string, meta: UserSessionMeta) {
		// Limit the number of requests that can be made to this endpoint
		const is_allowed = this.rateLimit([meta.ip_address || '', 'create_password_reset'], {
			max_tokens: 2,
			refill_every_seconds: 60,
		});
		if (!is_allowed) {
			throw new DelightError({
				message: 'Too many password reset requests. Please try again later',
				status: 429,
			});
		}

		const formatted_email = email.trim().toLowerCase();
		const now = Date.now();
		const [user_auth] = this.sql.list('user_auth', {
			limit: 1,
			where: {
				and: [
					{ key: 'email', is: '=', value: formatted_email },
					{ key: 'password_hash', is: '!=', value: null },
				],
			},
		});
		if (!user_auth) {
			throw new DelightError({
				message: `Account with provided email doesn't exist or is using an oauth vendor to sign in`,
				status: 400,
			});
		}
		const user_id = user_auth.user_id;
		const user_auth_id = user_auth.id;
		let jwt: Awaited<ReturnType<typeof generateJwt>>;
		try {
			jwt = await generateJwt(this.options.secret, {
				sub: user_auth_id, // The ID of the user's auth method used to sign in
				uid: user_id, // The user's ID
				iat: Math.floor(now / 1000),
				exp: Math.floor(now / 1000) + 60 * 60,
				typ: 'password_reset',
				iss: this.options.issuer,
			});
		} catch {
			throw new DelightError({
				message: 'Failed to generate password reset token',
				status: 500,
			});
		}

		try {
			this.sql.insert('user_session', jwt.decoded_jwt.jti, {
				type: 'password_reset',
				user_id,
				user_auth_id,
				jwt: jwt.jwt,
				expires_at: jwt.decoded_jwt.exp * 1000,
				json: JSON.stringify(meta || {}),
			});
		} catch {
			throw new DelightError({
				message: 'Failed to create password reset token',
				status: 500,
			});
		}
		return {
			user_id,
			user_auth_id,
			user_session_id: jwt.decoded_jwt.jti,
			jwt: jwt.jwt,
			decoded_jwt: jwt.decoded_jwt,
			type: 'other',
		} satisfies AuthOperationResult;
	}

	/** Returns a secure hash of the given password */
	async hashPassword(password: string) {
		const salt = new Uint8Array(16);
		crypto.getRandomValues(salt);
		return await argon2id({
			salt,
			password,
			...ARGON2_PARAMS,
			outputType: 'encoded',
		});
	}

	/** Verifies the given password matches the given hash. @throws if incorrect */
	async verifyPasswordHash(password: string, hash: string) {
		const matches = await argon2Verify({ hash, password });
		if (!matches) {
			throw new DelightError({ message: 'Incorrect email or password', status: 401 });
		}
	}

	/** Resets the user's password based on the provided password reset token */
	async resetPassword(
		password_reset_token: string,
		password: string,
		meta: UserSessionMeta,
	) {
		let token: Awaited<ReturnType<typeof decodeJwt>>;
		try {
			token = await decodeJwt(this.options.secret, password_reset_token);
		} catch {
			throw new DelightError({
				message: 'Invalid or expired reset password link',
				status: 400,
			});
		}
		if (token.typ !== 'password_reset') {
			throw new DelightError({ message: 'Invalid reset password link', status: 400 });
		}

		// Check if the token has already been used (deleted from database)
		const user_session_id = token.jti;
		const user_auth_id = token.sub;
		const user_id = token.uid;
		this.sql
			.setError(`Reset password link has already been used`)
			.get('user_session', user_session_id);
		const user = this.sql
			.setError(`Couldn't find user with given id`)
			.get('user', user_id);
		if (user.deleted_at) {
			throw new DelightError({
				message: `This account has been deleted. Please contact support for help.`,
				status: 401,
			});
		}

		// Throw an error if the password is not strong enough
		await this.checkPasswordStrength(password);

		// Hash the new password and create a new session for the user
		const hash = await this.hashPassword(password);

		// Check if the password hash is the same as the user's current password hash
		const user_auth = this.sql.get('user_auth', user_auth_id);
		if (user_auth.password_hash === hash) {
			throw new DelightError({
				message: 'Password must be different from the current password',
				status: 400,
			});
		}

		// Create a new session token for the user
		const new_session_id = generateID();
		const new_session = await this.createSessionToken({
			user_auth_id,
			user_id,
			// The user's email has been verified if they are resetting their password by sending a link to their email
			verified: true,
			user_session_id: new_session_id,
		});

		this.sql.transaction(() => {
			// Re-check inside the transaction: the awaits above yield the Durable Object's
			// input gate, so a concurrent request may have already consumed this token
			this.sql
				.setError(`Reset password link has already been used`)
				.get('user_session', user_session_id);
			const user_sessions = this.sql.list('user_session', {
				where: { key: 'user_auth_id', is: '=', value: user_auth_id },
			});
			// Revoke all the user's sessions
			user_sessions.forEach((session) => {
				this.sql.delete('user_session', session.id);
			});
			// Update the user's password hash
			this.sql.update('user_auth', user_auth_id, {
				password_hash: hash,
				verified_at: user_auth.verified_at || Date.now(),
			});
			// Create a new session for the user
			this.sql.insert('user_session', new_session_id, {
				type: 'auth',
				jwt: new_session.jwt,
				user_id,
				user_auth_id,
				expires_at: new_session.decoded_jwt.exp * 1000,
				json: JSON.stringify(meta || {}),
			});
		});

		return {
			jwt: new_session.jwt,
			decoded_jwt: new_session.decoded_jwt,
			user_id,
			user_auth_id,
			user_session_id: new_session_id,
			type: 'signin',
		} satisfies AuthOperationResult;
	}

	/** Creates a new session JWT for the user */
	async createSessionToken({
		user_auth_id,
		user_id,
		user_session_id,
		expires_in,
		org,
		verified,
		email,
		name,
	}: {
		/** The ID of the user record to encode in this token */
		user_id: string;
		/** The ID of the user auth record to encode in this token */
		user_auth_id: string;
		/** The ID of the user session record to encode in this token */
		user_session_id?: string;
		/** A record of organizations the user belongs to (short keys: p=permissions, d=db, e=entitlements, n=name) */
		org?: Record<string, { p: number; d?: string; e?: number; n: string }>;
		/** The number of seconds the token will expire in. @default 3600 */
		expires_in?: number;
		/** The name of the user. If not provided, it will look it up in the database */
		name?: string;
		/** The email of the user. If not provided, it will look it up in the database */
		email?: string;
		/** Whether the user's email has been verified. If not provided, it will look up in the database */
		verified?: boolean;
	}) {
		let orgPermissions: SessionToken<'auth'>['org'] = {};
		if (!org) {
			const orgs = this.sql.list('org_user', {
				where: { key: 'user_id', is: '=', value: user_id },
			});
			orgPermissions = orgs.reduce(
				(acc, org_user) => {
					// A permission-0 row is not a membership (updateUserPermission
					// deletes rows on removal, but rows written by older versions
					// or external tooling may linger) — never encode it into the
					// session token, where downstream membership checks trust it.
					if (!org_user.permission) return acc;
					const org = this.sql.get('org', org_user.org_id);
					if (org.deleted_at) return acc;
					acc[org_user.org_id] = {
						p: org_user.permission,
						n: org.name,
						...(org.db_id ? { d: org.db_id } : {}),
						...(org.plan != null ? { e: org.plan } : {}),
					};
					return acc;
				},
				{} as SessionToken<'auth'>['org'],
			);
		}

		if (name === undefined) {
			const user = this.sql.get('user', user_id);
			if (user.deleted_at) {
				throw new DelightError({
					message: `This account has been deleted. Please contact support for help.`,
					status: 401,
				});
			}
			name = user.name;
		}

		if (verified === undefined || email === undefined) {
			const user_auth = this.sql.get('user_auth', user_auth_id);
			verified = verified ?? !!user_auth.verified_at;
			email = email ?? user_auth.email;
		}

		const iat = Math.floor(new Date().getTime() / 1000);
		return generateJwt<'auth'>(this.options.secret, {
			typ: 'auth',
			iss: this.ctx.id.toString(), // The 'issuer' of the token
			sub: user_auth_id, // The ID of the user's auth method used to sign in
			uid: user_id, // The user's ID
			jti: user_session_id, // A unique identifier for the token (can be saved to user_session to revoke the token later)
			iat: iat, // The time the token was issued
			exp: iat + Math.max(0, expires_in || 60 * 60), // The time the token expires (1 hour from now)
			org: org || orgPermissions, // The record of orgs the user is a part of and their role/permissions
			name,
			email,
			verified, // The user's email verification status
		});
	}

	/** Revokes the session(s) with the given id(s) */
	revokeSession(session_ids: string | string[]) {
		const ids = Array.isArray(session_ids) ? session_ids : [session_ids];
		ids.forEach((session_id) => {
			this.sql.delete('user_session', session_id);
		});
	}

	/** Revokes all sessions of the user with the given id */
	revokeUserSessions(user_id: string) {
		this.sql
			.list('user_session', {
				where: {
					and: [
						{ key: 'type', is: '=', value: 'auth' },
						{ key: 'user_id', is: '=', value: user_id },
					],
				},
			})
			.forEach((session) => {
				this.sql.delete('user_session', session.id);
			});
	}

	/** Revokes all sessions of all the users in the organization with the given id */
	revokeOrgSessions(org_id: string) {
		this.sql
			.list('org_user', {
				where: { key: 'org_id', is: '=', value: org_id },
			})
			.forEach((org_user) => {
				this.revokeUserSessions(org_user.user_id);
			});
	}

	/** Revokes the given session jwt */
	async revokeSessionToken(jwt: string) {
		const session = await decodeJwt(this.options.secret, jwt);
		this.revokeSession(session.jti);
	}

	/** Returns information about the session with the given id */
	async getSession(session_id: string) {
		return this.sql.get('user_session', session_id);
	}

	/** Lists the orgs that match the given query */
	listOrgs(query?: SqlEntityQuery<AuthDatabaseSchema['org']>) {
		return this.sql.list('org', query);
	}

	/** Returns the organization with the given id */
	getOrg(id: string) {
		return this.sql.get('org', id);
	}

	/** Creates a new organization on behalf of the given user */
	createOrg(org: AuthDatabaseSchema['org']) {
		this.sql
			.setError(`Can't create an organization with a user that doesn't exist`)
			.get('user', org.owner_id); // throws if not found
		let created_org: AuthDatabaseSchema['org'] | undefined;
		this.sql.transaction(() => {
			created_org = this.sql.insert('org', org.id, org);
			this.sql.insert('org_user', null, {
				org_id: created_org.id,
				user_id: org.owner_id,
				permission: encodePermissions(this.options.permissions, [
					this.orgAdminPermission,
				]),
			});
		});
		return created_org;
	}

	/**
	 * Updates the organization with the given id with the given data
	 * If the organization's owner is changed, the new owner's permissions are updated to include 'org:write'
	 */
	updateOrg(id: string, org: Partial<AuthDatabaseSchema['org']>) {
		const current_org = this.sql.get('org', id);
		if (org.owner_id && current_org.owner_id !== org.owner_id) {
			this.sql
				.setError(`Can't change organization ownership to a user that doesn't exist`)
				.get('user', org.owner_id); // throws if not found
			const [new_owners_permissions] = this.sql.list('org_user', {
				where: {
					and: [
						{ key: 'org_id', is: '=', value: id },
						{ key: 'user_id', is: '=', value: org.owner_id },
					],
				},
			});
			if (new_owners_permissions) {
				const current_permissions = decodePermissions(
					this.options.permissions,
					new_owners_permissions.permission,
				);
				this.sql.update('org_user', new_owners_permissions.id, {
					permission: encodePermissions(this.options.permissions, [
						...current_permissions,
						this.orgAdminPermission,
					]),
				});
			} else {
				this.sql.insert('org_user', null, {
					org_id: id,
					user_id: org.owner_id,
					permission: encodePermissions(this.options.permissions, [
						this.orgAdminPermission,
					]),
				});
			}
		}
		return this.sql.update('org', id, org);
	}

	/** Deletes the organization with the given ID */
	deleteOrg(id: string) {
		this.sql.delete('org', id);
	}

	/** Marks the organization as deleted so no further actions can be taken on the org while its data is deleted */
	markOrgDeleted(id: string, undeleted = false) {
		this.sql.update('org', id, {
			deleted_at: undeleted ? (null as unknown as undefined) : Date.now(),
		});
	}

	/** Creates a new invitation to an organization with the given information. Returns the newly created invitation */
	createInvitation(
		invitation: Omit<
			AuthDatabaseSchema['org_invitation'],
			'id' | 'created_at' | 'updated_at'
		>,
	) {
		return this.sql.insert('org_invitation', undefined, invitation);
	}

	/** Returns the invitation with the given id */
	getInvitation(id: string) {
		return this.sql.get('org_invitation', id);
	}

	/** Returns the invitation with the given id if it is valid. @throws if it's an invalid invitation or doesn't exist */
	getInvitationIfValid(id: string) {
		const invitation = this.sql.get('org_invitation', id);
		if ((invitation.expires_at || Infinity) < Date.now()) {
			throw new DelightError({
				message: 'Invitation has been deleted or is expired',
				status: 400,
			});
		}
		const max_redemptions = invitation.max_redemptions || -1;
		let no_redemptions_left = max_redemptions === 0;
		if (max_redemptions > 0) {
			const redemptions = this.sql.list('org_invitation_log', {
				limit: 1000,
				where: { key: 'invitation_id', is: '=', value: id },
			});
			no_redemptions_left = redemptions.length >= max_redemptions;
		}
		if (no_redemptions_left) {
			throw new DelightError({
				message: 'Invitation has reached its maximum number of redemptions',
				status: 400,
			});
		}
		return invitation;
	}

	/** Updates the invitation with the given id with the given data */
	updateInvitation(
		id: string,
		invitation: Partial<
			Omit<
				AuthDatabaseSchema['org_invitation'],
				'email' | 'expires_at' | 'id' | 'created_at' | 'deleted_at'
			>
		> & {
			email?: string | null;
			expires_at?: number | null;
		},
	) {
		return this.sql.update('org_invitation', id, invitation);
	}

	/** Deletes the invitation with the given id */
	deleteInvitation(id: string) {
		this.sql.delete('org_invitation', id);
	}

	/** Returns the list of invitations available for the given organization */
	listInvitations(
		org_id: string,
		query?: SqlEntityQuery<AuthDatabaseSchema['org_invitation']>,
	) {
		const filters =
			query?.where && 'and' in query.where
				? query.where.and
				: query?.where
					? [query.where]
					: [];
		const list = this.sql.list('org_invitation', {
			...query,
			where: {
				and: [
					...filters.filter((v) => v && 'key' in v && v.key !== 'org_id'),
					{ key: 'org_id', is: '=', value: org_id },
				],
			},
		});
		return {
			list,
			count: list.length,
			hasMore: false,
		};
	}

	/** Accepts the inivitation with the given id on behalf of the user with the given user_id */
	acceptInvitation(id: string, user_id: string) {
		// Check if the user exists
		const user = this.sql.setError(`User not found`).get('user', user_id);

		// Check if the invitation exists and has not expired
		const invitation = this.sql
			.setError(`Invitation not found`)
			.get('org_invitation', id);
		if ((invitation.expires_at || Infinity) < Date.now()) {
			throw new DelightError({
				message: 'Invitation has been deleted or is expired',
				status: 400,
			});
		}

		// Check if the user already belongs to the org
		const [org_user] = this.sql.list('org_user', {
			limit: 1,
			where: {
				and: [
					{ key: 'user_id', is: '=', value: user.id },
					{ key: 'org_id', is: '=', value: invitation.org_id },
				],
			},
		});
		if (org_user) {
			throw new DelightError({
				message: 'User already belongs to the organization',
				status: 400,
			});
		}

		// Check if the invitation has reached its maximum number of redemptions
		const max_redemptions = invitation.max_redemptions || -1;
		let no_redemptions_left = max_redemptions === 0;
		if (max_redemptions > 0) {
			const redemptions = this.sql.list('org_invitation_log', {
				limit: 1000,
				where: { key: 'invitation_id', is: '=', value: id },
			});
			no_redemptions_left = redemptions.length >= max_redemptions;
		}
		if (no_redemptions_left) {
			throw new DelightError({
				message: 'Invitation has reached its maximum number of redemptions',
				status: 400,
			});
		}

		// Check if the user has a valid auth method
		const user_auths = this.sql.list('user_auth', {
			where: { key: 'user_id', is: '=', value: user.id },
		});
		const user_auth = user_auths.find((auth) => {
			return !invitation.email || auth.email === invitation.email;
		});
		if (!user_auth) {
			throw new DelightError({
				message:
					'The email used to sign in does not match the email that was invited to join this organization. Please sign in/up with the email that was invited to join this organization',
				status: 400,
			});
		}

		// Accept the invitation
		this.sql.transaction(() => {
			this.sql.insert('org_user', null, {
				org_id: invitation.org_id,
				user_id: user.id,
				permission: invitation.permission,
			});
			this.sql.insert('org_invitation_log', undefined, {
				invitation_id: id,
				invitee_id: user.id,
				inviter_id: invitation.user_id,
				permission: invitation.permission,
				created_at: invitation.updated_at,
				updated_at: Date.now(),
				org_id: invitation.org_id,
				email: user_auth.email,
			});
		});
	}

	/**
	 * Creates a new OAuth application with the given information.
	 * An Oauth application is a 3rd party application that is attempting to access the user's data
	 * on their behalf. The application must be authorized by the user before it can access their data.
	 * An example might be Zapier - where Zapier is the OAuth application and thus would be the one to call this method.
	 * And OAuth application should have a unique ID, name, logo url, description, and a redirect URL.
	 */
	createOauthApplication(application: {
		/** The publicily visible name of the application. Must be unique */
		name: string;
		/** The ID of the user that is creating the application */
		user_id: string;
		/** The URL to the logo to display on the oauth application consent page */
		logo?: string;
		/** An optional url to the application's home page */
		url?: string;
		/** An optional description of the application. Shown on the oauth consent page */
		description?: string;
		/** The url to the application's privacy policy */
		privacy_policy_url?: string;
		/** The url to the application's terms of service */
		terms_of_service_url?: string;
		/** The list of redirect urls that user's can be redirected to */
		redirect_urls?: string[];
		/** The default redirect url when not specified in the query params */
		default_redirect_url?: string;
	}): OauthApplication {
		if (!application.name) {
			throw new DelightError({ message: 'Application name is required', status: 400 });
		}
		if (!application.user_id) {
			throw new DelightError({ message: 'Application admin is required', status: 400 });
		}
		// Ensure the application name is unique
		const existing_applications = this.sql.list('oauth_application', {
			limit: 1,
			where: { key: 'name', is: '=', value: application.name },
		});
		if (existing_applications.length) {
			throw new DelightError({
				message: `Application with name "${application.name}" already exists`,
				status: 400,
			});
		}

		// Ensure the user exists
		this.sql.setError(`User not found`).get('user', application.user_id); // throws if not found

		// Ensure the redirect URLs are valid
		if (application.redirect_urls) {
			if (!Array.isArray(application.redirect_urls)) {
				throw new DelightError({
					message: 'Redirect URLs must be an array of strings',
					status: 400,
				});
			}
			application.redirect_urls.forEach((href) => {
				try {
					new URL(href);
				} catch {
					throw new DelightError({
						message: `Invalid redirect URL: "${href}". Must be a valid URL`,
						status: 400,
					});
				}
			});
		}

		// Ensure the default redirect URL is valid and is one of the redirect URLs
		if (application.default_redirect_url) {
			try {
				new URL(application.default_redirect_url);
			} catch {
				throw new DelightError({
					message: `Invalid default redirect URL: "${application.default_redirect_url}". Must be a valid URL`,
					status: 400,
				});
			}
			if (
				!application.redirect_urls ||
				!application.redirect_urls.includes(application.default_redirect_url)
			) {
				throw new DelightError({
					message: `Default redirect URL must be one of the redirect URLs`,
					status: 400,
				});
			}
		}

		// Create the application
		const id = generateID();
		const oauth_application = this.sql.insert('oauth_application', id, {
			name: application.name,
			logo: application.logo || undefined,
			url: application.url || undefined,
			description: application.description || undefined,
			privacy_policy_url: application.privacy_policy_url || undefined,
			terms_of_service_url: application.terms_of_service_url || undefined,
			json: JSON.stringify({
				client_secrets: [],
				redirect_urls: application.redirect_urls || [],
				default_redirect_url: application.default_redirect_url || undefined,
			}),
		});
		const json = JSON.parse(oauth_application.json || '{}') as Record<string, any>;
		delete oauth_application.json;

		// Add the user to the oauth application
		this.sql.insert('oauth_application_user', undefined, {
			oauth_application_id: oauth_application.id,
			user_id: application.user_id,
			json: '{}',
		});

		return {
			...json,
			...oauth_application,
			client_secrets: [],
			redirect_urls: json.redirect_urls || [],
			default_redirect_url: json.default_redirect_url || undefined,
		} satisfies OauthApplication;
	}

	/**
	 * Creates a new application secret and returns the secret.
	 * After this point, the secret will no longer be retrievable, so it's on application developers to store it securely.
	 */
	async createOauthApplicationSecret(application_id: string) {
		// Ensure the application exists
		const existing_application = this.sql
			.setError(`OAuth application not found`)
			.get('oauth_application', application_id);

		// Create a new client secret
		const secret_bytes = new Uint32Array(10);
		crypto.getRandomValues(secret_bytes);
		const secret = Array.from(secret_bytes, (b) => b.toString(16).padStart(8, '0')).join(
			'',
		);
		const hash = await this.hashPassword(secret);
		const id = generateID();
		const json = JSON.parse(existing_application.json || '{}') as Record<string, any>;

		// Ensure the application has a max of 5 client secrets
		if (
			json.client_secrets &&
			Array.isArray(json.client_secrets) &&
			json.client_secrets.length >= 5
		) {
			throw new DelightError({
				message: 'Application already has the maximum number of client secrets (5)',
				status: 400,
			});
		}

		this.sql.update('oauth_application', application_id, {
			json: JSON.stringify({
				...json,
				client_secrets: [
					...(json.client_secrets || []),
					{ hash, id, created_at: Date.now() },
				],
			}),
		});
		return { secret, id };
	}

	/**
	 * Deletes an application secret for the application with the given id and the first 10 characters of the hashed version of the oauth secret
	 * We only need the first 10 characters of the hash to identify the secret, so the client doesn't need to store the full hash.
	 */
	deleteOauthApplicationSecret(application_id: string, secret_id: string) {
		// Ensure the application exists
		const existing_application = this.sql
			.setError(`OAuth application not found`)
			.get('oauth_application', application_id);

		const json = JSON.parse(existing_application.json || '{}') as Record<string, any>;
		if (!json.client_secrets || !Array.isArray(json.client_secrets)) {
			throw new DelightError({
				message: 'No client secrets found for this application',
				status: 404,
			});
		}

		let secret_found = false;
		const updated_secrets = json.client_secrets.filter((client_secret) => {
			if (!client_secret.id) return false; // Skip if no id is present
			if (client_secret.id === secret_id) {
				secret_found = true;
				return false; // Remove this secret
			}
			return true; // Keep this secret
		});

		if (!secret_found) {
			throw new DelightError({
				message: 'Client secret not found for this application',
				status: 404,
			});
		}

		this.sql.update('oauth_application', application_id, {
			json: JSON.stringify({
				...json,
				client_secrets: updated_secrets,
			}),
		});
	}

	/**
	 * Verifies the given secret against the application's secrets
	 * @throws if the application doesn't exist or the secret is invalid
	 */
	async verifyOauthApplicationSecret(application_id: string, secret: string) {
		// Ensure the application exists
		const existing_application = this.sql
			.setError(`OAuth application not found`)
			.get('oauth_application', application_id);

		const json = JSON.parse(existing_application.json || '{}') as Record<string, any>;
		if (!json.client_secrets || !Array.isArray(json.client_secrets)) {
			throw new DelightError({
				message: 'No client secrets found for this application',
				status: 403,
			});
		}

		for (const client_secret of json.client_secrets) {
			try {
				await this.verifyPasswordHash(secret, client_secret.hash);
				return; // If the secret matches, return successfully
			} catch {
				continue; // Try the next secret if this one doesn't match
			}
		}
		throw new DelightError({
			message: 'Invalid client secret for this application',
			status: 403,
		});
	}

	/** Updates an OAuth application with the given information */
	updateOauthApplication(
		id: string,
		updates?: {
			/** The publicily visible name of the application. Must be unique */
			name?: string;
			/** The URL to the logo to display on the oauth application consent page */
			logo?: string;
			/** An optional url to the application's home page */
			url?: string;
			/** An optional description of the application. Shown on the oauth consent page */
			description?: string;
			/** The url to the application's privacy policy */
			privacy_policy_url?: string;
			/** The url to the application's terms of service */
			terms_of_service_url?: string;
			/** The list of redirect urls that user's can be redirected to */
			redirect_urls?: string[];
			/** The default redirect url when not specified in the query params */
			default_redirect_url?: string;
		},
	): OauthApplication {
		if (!updates) {
			throw new DelightError({ message: 'No updates provided', status: 400 });
		}

		const existing_application = this.sql.get('oauth_application', id);
		const existing_json = JSON.parse(existing_application.json || '{}') as Record<
			string,
			any
		>;

		// Ensure the application name is unique
		if (updates.name && updates.name !== existing_application.name) {
			const existing_applications = this.sql.list('oauth_application', {
				limit: 1,
				where: { key: 'name', is: '=', value: updates.name },
			});
			if (existing_applications.length) {
				throw new DelightError({
					message: `Application with name "${updates.name}" already exists`,
					status: 400,
				});
			}
		}

		// Ensure the redirect URLs are valid
		if (updates.redirect_urls) {
			if (!Array.isArray(updates.redirect_urls)) {
				throw new DelightError({
					message: 'Redirect URLs must be an array of strings',
					status: 400,
				});
			}
			updates.redirect_urls.forEach((href) => {
				try {
					new URL(href);
				} catch {
					throw new DelightError({
						message: `Invalid redirect URL: "${href}". Must be a valid URL`,
						status: 400,
					});
				}
			});
		}

		// Ensure the default redirect URL is valid and is one of the redirect URLs
		if (updates.default_redirect_url) {
			try {
				new URL(updates.default_redirect_url);
			} catch {
				throw new DelightError({
					message: `Invalid default redirect URL: "${updates.default_redirect_url}". Must be a valid URL`,
					status: 400,
				});
			}
			if (
				!updates.redirect_urls ||
				!updates.redirect_urls.includes(updates.default_redirect_url)
			) {
				throw new DelightError({
					message: `Default redirect URL must be one of the redirect URLs`,
					status: 400,
				});
			}
		}

		// Create the application
		const oauth_application = this.sql.update('oauth_application', id, {
			name: updates.name || existing_application.name,
			logo: updates.logo || existing_application.logo,
			url: updates.url || existing_application.url,
			description: updates.description || existing_application.description,
			privacy_policy_url:
				updates.privacy_policy_url || existing_application.privacy_policy_url,
			terms_of_service_url:
				updates.terms_of_service_url || existing_application.terms_of_service_url,
			json: JSON.stringify({
				client_secrets: existing_json.client_secrets || [],
				redirect_urls: updates.redirect_urls || existing_json.redirect_urls || [],
				default_redirect_url:
					updates.default_redirect_url || existing_json.default_redirect_url || undefined,
			}),
		});
		const json = JSON.parse(oauth_application.json || '{}') as Record<string, any>;
		delete oauth_application.json;
		return {
			...json,
			...oauth_application,
			client_secrets: (json.client_secrets || []).map(
				(secret: { id: string; created_at: number }) => ({
					...secret,
					hash: undefined, // Don't return the hash for security reasons
				}),
			),
			redirect_urls: json.redirect_urls || [],
			default_redirect_url: json.default_redirect_url,
		} satisfies OauthApplication;
	}

	/** Gets the oauth application with the given id */
	getOauthApplication(id: string): OauthApplication {
		const oauth_application = this.sql.get('oauth_application', id);
		const json = JSON.parse(oauth_application.json || '{}') as Record<string, any>;
		delete oauth_application.json;
		return {
			...json,
			...oauth_application,
			client_secrets: (json.client_secrets || []).map(
				(secret: { id: string; created_at: number }) => ({
					...secret,
					hash: undefined, // Don't return the hash for security reasons
				}),
			),
			redirect_urls: json.redirect_urls || [],
			default_redirect_url: json.default_redirect_url,
		};
	}

	/** Deletes the oauth application with the given id and revokes all oauth application tokens */
	deleteOauthApplication(id: string) {
		this.sql.delete('oauth_application', id);
	}

	/**
	 * Returns the list of oauth applications a user has created or has access to.
	 * NOTE: This does not return the applications the user has granted access to, but rather the applications they have created or are admins of.
	 * This is typically used by application developers to list the applications a user has created or is an admin of, so they can manage them.
	 */
	listOauthApplications(
		user_id: string,
		query?: SqlEntityQuery<AuthDatabaseSchema['oauth_application_user']>,
	) {
		const filters =
			query?.where && 'and' in query.where
				? query.where.and
				: query?.where
					? [query.where]
					: [];
		const oauth_application_users = this.sql.list('oauth_application_user', {
			...query,
			where: {
				and: [
					...filters.filter((v) => v && 'key' in v && v.key !== 'user_id'),
					{ key: 'user_id', is: '=', value: user_id },
				],
			},
		});
		const list: OauthApplication[] = Array.from(
			new Set(
				oauth_application_users.map(
					(oauth_application_user) => oauth_application_user.oauth_application_id,
				),
			),
		).map((oauth_application_id) => {
			const oauth_application = this.sql.get('oauth_application', oauth_application_id);
			const json = JSON.parse(oauth_application.json || '{}') as Record<string, any>;
			delete oauth_application.json;
			return {
				...json,
				...oauth_application,
				client_secrets: (json.client_secrets || []).map(
					(secret: { id: string; created_at: number }) => ({
						...secret,
						hash: undefined, // Don't return the hash for security reasons
					}),
				),
				redirect_urls: json.redirect_urls || [],
				default_redirect_url: json.default_redirect_url,
			};
		});
		return {
			list,
			count: list.length,
			hasMore: !!query?.limit && list.length >= query.limit,
		};
	}

	/**
	 * Adds the user with the given ID as an admin of the given oauth application.
	 * NOTE, this is different from the normal user granting access to an oauth application.
	 * This is for adding a user as an admin of the application, allowing them to manage the application.
	 * This is typically used by the application developer to add other developers to the application.
	 */
	addUserToOauthApplication(application_id: string, user_id: string) {
		// Ensure the application exists
		this.sql
			.setError(`OAuth application not found`)
			.get('oauth_application', application_id);

		// Ensure the user exists
		this.sql.setError(`User not found`).get('user', user_id); // throws if not found

		// Check if the user is already an admin of the application
		const existing = this.sql.list('oauth_application_user', {
			where: {
				and: [
					{ key: 'oauth_application_id', is: '=', value: application_id },
					{ key: 'user_id', is: '=', value: user_id },
				],
			},
		});
		if (existing.length) {
			throw new DelightError({
				message: `User with ID ${user_id} is already an admin of the application with ID ${application_id}`,
				status: 400,
			});
		}

		// Add the user to the oauth application
		this.sql.insert('oauth_application_user', undefined, {
			oauth_application_id: application_id,
			user_id,
			json: '{}',
		});
	}

	/**
	 * Removes the user with the given ID from the given oauth application
	 * NOTE, this is different from the normal user granting access to an oauth application.
	 * This is for adding a user as an admin of the application, allowing them to manage the application.
	 * This is typically used by the application developer to add other developers to the application.
	 */
	removeUserFromOauthApplication(application_id: string, user_id: string) {
		// Ensure the application exists
		this.sql
			.setError(`OAuth application not found`)
			.get('oauth_application', application_id);

		// Ensure the user exists
		this.sql.setError(`User not found`).get('user', user_id); // throws if not found

		// Check if the user is an admin of the application
		const existing = this.sql.list('oauth_application_user', {
			where: {
				and: [
					{ key: 'oauth_application_id', is: '=', value: application_id },
					{ key: 'user_id', is: '=', value: user_id },
				],
			},
		});
		if (!existing.length) {
			throw new DelightError({
				message: `User with ID ${user_id} is not an admin of the application with ID ${application_id}`,
				status: 400,
			});
		}

		// Remove the user from the application
		this.sql.delete('oauth_application_user', existing[0].id);
	}

	/**
	 * Creates an oauth authorization code that can be exhanged for an access/refresh token.
	 */
	createOauthApplicationAuthorizationCode(
		application_id: string,
		authorization: {
			user_id: string;
			org_id: string;
			permission: number;
			redirect_uri: string;
		},
	) {
		// Ensure the user exists
		this.sql.setError(`User not found`).get('user', authorization.user_id); // throws if not found

		// Ensure the org exists
		this.sql.setError(`Organization not found`).get('org', authorization.org_id); // throws if not found

		// Ensure the application exists
		const existing_application = this.sql
			.setError(`OAuth application not found`)
			.get('oauth_application', application_id);

		// Validate the provided redirect_uri against the registered URIs for the application
		const app_json = JSON.parse(existing_application.json || '{}') as {
			redirect_urls?: string[];
		};
		const registered_redirect_urls = app_json.redirect_urls || [];
		if (
			!authorization.redirect_uri ||
			!registered_redirect_urls.includes(authorization.redirect_uri)
		) {
			throw new DelightError({
				message:
					'Invalid redirect_uri. The provided redirect_uri is not registered for this application or is missing.',
				status: 400,
			});
		}

		// Generate a random code for the authorization
		const code = generateID();

		// Create the authorization code
		const auth_code = this.sql.insert('oauth_application_auth_code', code, {
			oauth_application_id: existing_application.id,
			expires_at: Date.now() + 60 * 60 * 1000, // 1 hour from now
			org_id: authorization.org_id,
			user_id: authorization.user_id,
			permission: authorization.permission,
			redirect_uri: authorization.redirect_uri,
			json: '{}',
		});

		return {
			auth_code: auth_code.id,
			expires_at: auth_code.expires_at,
			client_id: auth_code.oauth_application_id,
			redirect_uri: auth_code.redirect_uri,
			state: auth_code.state,
			permission: auth_code.permission,
			org_id: auth_code.org_id,
			user_id: auth_code.user_id,
		};
	}

	/**
	 * Creates or updates an oauth application access token based on the given auth_code or refresh_token.
	 * IMPORTANT - The caller must have already authenticated the client (`verifyOauthApplicationSecret()`);
	 * `client_id` is only used to bind the grant to the authenticated application.
	 */
	async createOauthApplicationToken({
		client_id,
		auth_code,
		refresh_token,
	}: {
		client_id: string;
		auth_code?: string;
		refresh_token?: string;
	}) {
		if (!auth_code && !refresh_token) {
			throw new DelightError({
				message: 'Either auth_code or refresh_token must be provided',
				status: 400,
			});
		}

		const now = Date.now();
		const bytes = new Uint32Array(10);
		crypto.getRandomValues(bytes);
		const new_refresh_token = Array.from(bytes, (b) =>
			b.toString(16).padStart(8, '0'),
		).join('');

		// Handle the case where an auth code is provided
		if (auth_code) {
			// Ensure the auth code exists
			const oauth_application_auth_code = this.sql
				.setError(`OAuth application authorization code not found`)
				.get('oauth_application_auth_code', auth_code);

			// Ensure the auth code was issued to the authenticated application
			if (oauth_application_auth_code.oauth_application_id !== client_id) {
				throw new DelightError({
					message: 'Authorization code was not issued to this application',
					status: 403,
				});
			}

			// Ensure the auth code has not expired
			if (oauth_application_auth_code.expires_at < Date.now()) {
				throw new DelightError({
					message: 'OAuth application authorization code has expired',
					status: 400,
				});
			}

			const jti = generateID();
			const new_access_token = await generateJwt(this.options.secret, {
				jti,
				typ: 'oauth_application',
				sub: oauth_application_auth_code.org_id, // The org ID the user is signing in to
				uid: oauth_application_auth_code.user_id, // The user's ID
				p: oauth_application_auth_code.permission,
				iat: Math.floor(now / 1000),
				exp: Math.floor(now / 1000) + 60 * 60,
				iss: this.options.issuer,
			});

			let token: AuthDatabaseSchema['oauth_application_token'] | undefined;
			this.sql.transaction(() => {
				this.sql.delete('oauth_application_auth_code', oauth_application_auth_code.id);
				token = this.sql.insert('oauth_application_token', jti, {
					oauth_application_id: oauth_application_auth_code.oauth_application_id,
					access_token: new_access_token.jwt,
					access_token_expires_at: now + 60 * 60 * 1000, // 1 hour from now
					refresh_token: new_refresh_token,
					refresh_token_expires_at: undefined, // No expiration for refresh tokens
					org_id: oauth_application_auth_code.org_id,
					user_id: oauth_application_auth_code.user_id,
					permission: oauth_application_auth_code.permission,
					json: '{}',
				});
			});
			if (!token) {
				throw new DelightError({
					message: 'Failed to create OAuth application token',
					status: 500,
				});
			}
			return {
				...token,
				state: oauth_application_auth_code.state,
				redirect_uri: oauth_application_auth_code.redirect_uri,
			};
		}

		// Find the token with the given refresh token
		const [token] = this.sql.list('oauth_application_token', {
			where: { key: 'refresh_token', is: '=', value: refresh_token },
		});
		if (!token) {
			throw new DelightError({
				message:
					'Refresh token not found for this application. It may have been revoked or expired.',
				status: 404,
			});
		}

		// Ensure the refresh token was issued to the authenticated application
		if (token.oauth_application_id !== client_id) {
			throw new DelightError({
				message: 'Refresh token was not issued to this application',
				status: 403,
			});
		}

		// Generate a new access token and update the database
		const new_access_token = await generateJwt(this.options.secret, {
			typ: 'oauth_application',
			jti: token.id,
			sub: token.org_id, // The org ID the user is signing in to
			uid: token.user_id, // The user's ID
			iat: Math.floor(now / 1000),
			exp: Math.floor(now / 1000) + 60 * 60,
			p: token.permission,
			iss: this.options.issuer,
		});
		const updated_token = this.sql.update('oauth_application_token', token.id, {
			access_token: new_access_token.jwt,
			access_token_expires_at: now + 60 * 60 * 1000, // 1 hour from now
			refresh_token: new_refresh_token,
			refresh_token_expires_at: undefined, // No expiration for refresh tokens
		});

		return updated_token;
	}

	/**
	 * Lists the oauth applications that the organization has authorized to make API calls on their behalf.
	 * This doesn't include applications that the user has created, but rather applications that the user has authorized to access their data.
	 * If a user_id is provided, it will only return the applications that the user has authorized.
	 * If no user_id is provided, it will return all applications that the organization has authorized.
	 */
	listAuthorizedOauthApplications(org_id: string, user_id?: string) {
		const oauth_application_tokens = this.sql.list('oauth_application_token', {
			where: {
				and: [
					{ key: 'org_id', is: '=', value: org_id },
					...(user_id ? ([{ key: 'user_id', is: '=', value: user_id }] as const) : []),
				],
			},
		});

		const list: OauthApplication[] = Array.from(
			new Set(oauth_application_tokens.map((token) => token.oauth_application_id)),
		).map((oauth_application_id) => {
			const oauth_application = this.sql.get('oauth_application', oauth_application_id);
			const json = JSON.parse(oauth_application.json || '{}') as Record<string, any>;
			delete oauth_application.json;
			return {
				...json,
				...oauth_application,
				client_secrets: [], // Don't return this as it is not needed for non-admin users
				redirect_urls: [], // Don't return this as it is not needed for non-admin users
				default_redirect_url: undefined, // Don't return this as it is not needed for non-admin users
			};
		});
		return {
			list,
			count: list.length,
			hasMore: false,
		};
	}

	/** Revokes the authorization of an oauth application to make API calls on behalf of a user/org */
	revokeAuthorizedOauthApplication(application_id: string, org_id: string) {
		// Ensure the application exists
		this.sql
			.setError(`OAuth application not found`)
			.get('oauth_application', application_id);

		// Find the token for the application and org
		const tokens = this.sql.list('oauth_application_token', {
			where: {
				and: [
					{ key: 'oauth_application_id', is: '=', value: application_id },
					{ key: 'org_id', is: '=', value: org_id },
				],
			},
		});
		if (!tokens) {
			throw new DelightError({
				message: 'OAuth application token not found for this organization',
				status: 404,
			});
		}

		tokens.forEach((token) => {
			this.sql.delete('oauth_application_token', token.id);
		});
	}

	/**
	 * Reserves a global key on behalf of the org_id. @throws if the key is already taken
	 * This is used to reserve a key for the organization so that it can't be taken by another organization
	 * For example, a public site might have the key "example.com/page" reserved for the organization with the id "example"
	 * Then other orgs can't take the key "example.com/page"
	 */
	reserveGlobalKey(key: string, org_id: string, json?: string) {
		let existing_key;
		try {
			existing_key = this.sql.get('global_key', key);
		} catch {
			/* intentionally empty: key doesn't exist yet, treat as available */
		}
		if (existing_key && existing_key?.org_id !== org_id) {
			throw new DelightError({ message: `${key} is already taken`, status: 400 });
		}
		if (existing_key) {
			if (json) this.sql.update('global_key', key, { json });
		} else {
			this.sql.insert('global_key', key, { org_id, json });
		}
	}

	/** Returns the global key with the given key. @throws if it doesn't exist */
	getGlobalKey(key: string) {
		return this.sql.get('global_key', key);
	}

	/** Unreserves a global key on behalf of the org_id. @throws if the key isn't the org's key */
	unreserveGlobalKey(key: string, org_id: string) {
		let existing_key;
		try {
			existing_key = this.sql.get('global_key', key);
		} catch {
			/* intentionally empty: key doesn't exist, nothing to unreserve */
		}
		if (existing_key && existing_key?.org_id !== org_id) {
			throw new DelightError({
				message: `${key} is not reserved by this organization`,
				status: 400,
			});
		}
		if (existing_key) this.sql.delete('global_key', key);
	}

	/** A map of rate limited keys and the corresponding rate limit information */
	private rateLimitedKeys = new Map<
		string,
		{
			count: number;
			last_refill: number;
			max_tokens: number;
			refill_every_seconds: number;
		}
	>();

	/**
	 * Rate limits the given key by the given options
	 * Returns true if the request with the given key & options is allowed to proceed
	 * Returns false if the requst is rate limited
	 */
	private rateLimit(
		keyOrKeys: string | string[],
		options?: { max_tokens?: number; refill_every_seconds?: number },
	) {
		// Join with a separator so ['a','bc'] and ['ab','c'] can't collide on the same bucket
		const key = Array.isArray(keyOrKeys) ? keyOrKeys.join(':') : keyOrKeys;
		let bucket = this.rateLimitedKeys.get(key) ?? null;
		const now = Date.now();
		const max_tokens = options?.max_tokens ?? 10;
		const refill_every_seconds = options?.refill_every_seconds ?? 10;
		if (bucket === null) {
			bucket = {
				count: max_tokens,
				last_refill: now,
				max_tokens,
				refill_every_seconds,
			};
		} else {
			// Only advance last_refill by whole refill intervals — advancing it on every
			// call would let a steady stream of requests starve the refill forever
			const interval_ms = refill_every_seconds * 1000;
			const refills = Math.floor((now - bucket.last_refill) / interval_ms);
			if (refills > 0) {
				bucket.count = Math.min(bucket.count + refills, max_tokens);
				bucket.last_refill = Math.min(bucket.last_refill + refills * interval_ms, now);
			}
		}
		const allowed = bucket.count > 0;
		if (allowed) bucket.count -= 1;
		this.rateLimitedKeys.set(key, bucket);

		// Remove all really old buckets from memory
		// This shouldn't be necessary, but it helps keep memory usage down
		// We don't control when the DurableObject will be evicted from memory
		// so we need to clean up the old buckets in case the Durable Object is alive for a really long time
		for (const [key, bucket] of this.rateLimitedKeys.entries()) {
			if (bucket.last_refill < now - 1000 * 60 * 10) {
				this.rateLimitedKeys.delete(key);
			}
		}
		return allowed;
	}

	/** Timestamp of the last expired-session sweep (throttles cleanupExpiredSessions) */
	private last_session_cleanup = 0;

	/**
	 * Deletes expired single-use token sessions (email verification, password reset,
	 * email sign-in) and long-stale auth sessions so the table doesn't grow unbounded.
	 * Auth sessions stay refreshable for STALE_AUTH_SESSION_DAYS past their jwt expiry —
	 * deleting an auth row revokes its refresh grant, so they are kept well past expires_at.
	 * Runs at most once per hour.
	 */
	private cleanupExpiredSessions() {
		const now = Date.now();
		if (now - this.last_session_cleanup < 1000 * 60 * 60) return;
		this.last_session_cleanup = now;
		const STALE_AUTH_SESSION_DAYS = 30;
		const stale_auth_cutoff = now - STALE_AUTH_SESSION_DAYS * 24 * 60 * 60 * 1000;
		this.sql.run(
			(sql) => sql`DELETE FROM user_session
				WHERE (type IN ('email_verification', 'password_reset', 'email_signin') AND expires_at < ${now})
				OR (type = 'auth' AND expires_at < ${stale_auth_cutoff})`,
		);
		this.sql.run((sql) => sql`DELETE FROM webauthn_challenge WHERE expires_at < ${now}`);
	}

	private initializeDB() {
		console.log('Initializing Auth Database');
		// Sweep expired one-time tokens & stale sessions on cold start
		this.last_session_cleanup = 0;
		this.sql.run((sql) => {
			return sql`CREATE TABLE IF NOT EXISTS schema (
				version INTEGER PRIMARY KEY AUTOINCREMENT,
				updated_at INTEGER
			)`;
		});
		const version = this.sql
			.run<{ version: number }>((sql) => {
				return sql`SELECT version FROM schema ORDER BY version DESC LIMIT 1`;
			})
			.next().value?.version;

		console.log(
			`Current DB Version: ${version}. Latest DB Version: ${AUTH_DATABASE_UPGRADES.length}`,
		);

		// Upgrade the database to the latest schema if necessary
		if (AUTH_DATABASE_UPGRADES.length && version !== AUTH_DATABASE_UPGRADES.length) {
			this.sql.transaction(() => {
				AUTH_DATABASE_UPGRADES.slice(version || 0).forEach((upgrade, i) => {
					console.log(`Running upgrade: ${(version || 0) + i + 1}`);
					this.sql.run(upgrade);
				});
				console.log('Adding new schema version');
				this.sql.run(
					(sql) =>
						sql`INSERT INTO schema (
								version,
								updated_at
							) VALUES (
								${AUTH_DATABASE_UPGRADES.length},
								${Date.now()}
							)`,
				);
			});
		}
	}

	/** Runs the given SQL statement directly on the database. @dangerous */
	__dangerouslyRunSql__(sql_statement: string) {
		const result = this.sql.run(() => {
			return {
				query: sql_statement,
				values: [],
				__safelyInterpretedSql__: true,
			};
		});
		return { results: result.toArray() };
	}

	private convertOauthTokenFromDB(token: AuthDatabaseSchema['oauth_token']) {
		const json = JSON.parse(token.json || '{}');
		return {
			id: token.id,
			created_at: token.created_at,
			updated_at: token.updated_at,
			access_token: token.access_token,
			access_token_expires_at: token.access_token_expires_at,
			refresh_token: token.refresh_token,
			refresh_token_expires_at: token.refresh_token_expires_at,
			capabilities: decodeOauthScopes(this.options.oauth_scopes, token.capability),
			vendor: token.vendor,
			vendor_id: token.vendor_id,
			account_email: token.account_email,
			account_name: token.account_name,
			account_image: token.account_image,
			payload: json?.payload,
		} satisfies OauthToken;
	}

	private convertOauthTokenToDB(token: OauthToken) {
		return {
			id: token.id,
			created_at: token.created_at,
			updated_at: token.updated_at,
			access_token: token.access_token,
			access_token_expires_at: token.access_token_expires_at,
			refresh_token: token.refresh_token,
			refresh_token_expires_at: token.refresh_token_expires_at,
			capability: encodeOauthScopes(this.options.oauth_scopes, token.capabilities),
			vendor: token.vendor,
			vendor_id: token.vendor_id,
			account_email: token.account_email,
			account_name: token.account_name,
			account_image: token.account_image,
			json: JSON.stringify({ payload: token.payload }),
		} satisfies AuthDatabaseSchema['oauth_token'];
	}
}
