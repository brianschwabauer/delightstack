import { z } from 'zod/v4';
import { Meta } from './meta.type';

/** A bitwise encoded permission that the user has */
export const EncodedPermission = z.number().int().nonnegative();
export type EncodedPermission = z.infer<typeof EncodedPermission>;

/**
 * Encodes the given permission names into a bitwise integer for storing in the database.
 * The array index of each permission name is its bit position.
 *
 * @param permissions - The full list of permission names (array index = bit position). Append-only: never reorder or remove entries.
 * @param values - The permission names to encode (must be entries from `permissions`)
 */
export function encodePermissions<const T extends readonly string[]>(
	permissions: T,
	values: T[number][],
): EncodedPermission {
	let encoded = 0;
	for (const value of values) {
		const bit = permissions.indexOf(value);
		if (bit !== -1) encoded |= 1 << bit;
	}
	return encoded;
}

/**
 * Decodes a bitwise integer into the permission names it represents.
 * The array index of each permission name is its bit position.
 *
 * @param permissions - The full list of permission names (array index = bit position)
 * @param encoded - The bitwise integer to decode
 */
export function decodePermissions<const T extends readonly string[]>(
	permissions: T,
	encoded: EncodedPermission,
): T[number][] {
	const result: T[number][] = [];
	for (let i = 0; i < permissions.length; i++) {
		if (encoded & (1 << i)) result.push(permissions[i]);
	}
	return result;
}

/** Generic fields added to each JWT */
const GenericSessionToken = z.object({
	/** The 'issuer' of the token */
	iss: z.string(),
	/** The ID of the user's auth method used to sign in */
	sub: z.string(),
	/** The user's ID */
	uid: z.string(),
	/** A unique identifier for the token (can be saved to user_session to revoke the token later) */
	jti: z.string(),
	/** The time the token was issued (in epoch seconds) */
	iat: z.number(),
	/** The time the token expires (in epoch seconds) */
	exp: z.number(),
});

/** A session token that can be used to reset a user's password */
const PasswordResetToken = GenericSessionToken.merge(
	z.object({
		/** The type of token */
		typ: z.literal('password_reset'),
	}),
);

/** A session token that can be used to verify a user's email */
const EmailVerificationToken = GenericSessionToken.merge(
	z.object({
		/** The type of token */
		typ: z.literal('email_verification'),
	}),
);

/** A session token that can be used as a "magic link" so the user can sign in via a link sent to their email */
const EmailSignInToken = GenericSessionToken.merge(
	z.object({
		/** The type of token */
		typ: z.literal('email_signin'),
	}),
);

/** A session token that can be used to verify a user's email */
const OauthAuthorizationToken = GenericSessionToken.merge(
	z.object({
		/** The type of token */
		typ: z.literal('oauth_authorize'),
		/** The org_id that will be authorized to use this oauth account */
		org_id: z.string().optional(),
		/** The list of oauth scopes being requested  */
		scopes: z.array(z.string()).optional(),
		/** The list of capabilities being requested  */
		capabilities: z.array(z.string()).optional(),
		/** The redirect URL (or path) that the user will be redirected to after signing in */
		redirect: z.string().optional(),
		/** The info that will be used to sign up the user with a new account */
		signup: z
			.object({
				/** The name of the user */
				name: z.string().optional(),
				/** The name of the organization */
				org_name: z.string().optional(),
				/** The ID of the subscription plan that the user will be signed up to */
				org_subscription_plan_id: z.string().optional(),
				/** The ID of the invitation the user has accepted and thus will join the organization attached to the invitation */
				invitation_id: z.string().optional(),
			})
			.optional(),
	}),
);

/** The main session token for the user's session auth */
export const AuthSessionToken = GenericSessionToken.merge(
	z.object({
		/** The type of token. @default auth */
		typ: z.literal('auth'),
		/** The name of the user signed in */
		name: z.string(),
		/** The email of the user signed in */
		email: z.string(),
		/** Whether the user's email has been verified */
		verified: z.boolean(),
		/** The record of orgs the user is a part of and their role/permissions */
		org: z.record(
			z.string(),
			z.object({
				/** The bitwise encoded permission the user has in the organization */
				role: EncodedPermission,
				/** The ID of the durable object. This is encoded here for fast retrieval */
				db: z.string().optional(),
				/** The integer representing the current subscription plan the organization is on */
				plan: z.number().optional(),
				/** The name of the organization */
				name: z.string(),
			}),
		),
	}),
);

/**
 * The session token for 3rd party oauth apps (like Zapier).
 * The 'uid' is the user ID of the user that authorized the oauth app.
 * The 'sub' is the ID of the organization that this oauth application has access to.
 */
export const OauthApplicationSessionToken = GenericSessionToken.merge(
	z.object({
		/** The type of token. @default auth */
		typ: z.literal('oauth_application'),
		/** The permissions this token has */
		role: EncodedPermission,
	}),
);

/** A JWT session token used to authenticate a user */
export const SessionToken = z.union([
	PasswordResetToken,
	EmailVerificationToken,
	EmailSignInToken,
	AuthSessionToken,
	OauthAuthorizationToken,
	OauthApplicationSessionToken,
]);
export type SessionToken<Type = z.infer<typeof SessionToken>['typ']> = z.infer<
	typeof SessionToken
> & { typ: Type };

/** The data needed on signin via email and password */
export const EmailPasswordSignIn = z.object({
	/** The email of the account */
	email: z.email().toLowerCase(),
	/** The password of the account */
	password: z.string(),
	/** The ID of the invitation the user was sent (to join an organization) */
	invitation_id: z.string().optional(),
});
export type EmailPasswordSignIn = z.infer<typeof EmailPasswordSignIn>;

/** The data needed on signin via email magic link */
export const EmailLinkSignIn = z.object({
	/** The JWT extracted from the query params of the link sent to the user's email */
	email_signin_token: z.string(),
	/** The ID of the invitation the user was sent (to join an organization) */
	invitation_id: z.string().optional(),
});
export type EmailLinkSignIn = z.infer<typeof EmailLinkSignIn>;

/** The data needed on signup */
export const EmailSignUp = z.object({
	/** The name of the person signing up */
	name: z.string(),
	/** The email of the account */
	email: z.email().toLowerCase(),
	/** The url to the user's profile image */
	image: z.string().optional(),
	/** The password of the account. This isn't required if using "magic link" signins */
	password: z.string().optional(),
	/**
	 * The name of the organization that will be created on signup.
	 * This is required for creating a new organization, but not allowed if 'invitation_id' is provided.
	 */
	org_name: z.string().optional(),
	/** The plan ID of the subscription the organization that will be subscribed to on signup */
	org_subscription_plan_id: z.string().optional(),
	/** The ID of the invitation the user was sent (to join an organization) */
	invitation_id: z.string().optional(),
});
export type EmailSignUp = z.infer<typeof EmailSignUp>;

/** A person with a login that can belong to one or many organizations */
export const User = z.object({
	...Meta.shape,
	name: z.string(),
	image: z.string().optional(),
	/** The timestamp when the organization started to be deleted */
	deleted_at: z.number().optional(),
});
export type User = z.infer<typeof User>;

/** The fields in a user that can be updated */
export const UpdateUser = User.pick({
	name: true,
	image: true,
}).partial();
export type UpdateUser = z.infer<typeof UpdateUser>;

/** Additional metadata information attached to every request from a user */
export const UserSessionMeta = z.object({
	ip_address: z.string().optional(),
	city: z.string().optional(),
	country: z.string().optional(),
	latitude: z.string().optional(),
	longitude: z.string().optional(),
	region: z.string().optional(),
	timezone: z.string().optional(),
	user_agent: z.string().optional(),
	browser: z.string().optional(),
	os: z.string().optional(),
	device: z.string().optional(),
});
export type UserSessionMeta = z.infer<typeof UserSessionMeta>;

/** A record of session data for a signed in user */
export const UserSession = z.object({
	...UserSessionMeta.shape,
	id: z.string(),
	/** The oauth vendor used to sign in (like 'google') */
	vendor: z.string().optional(),
	/** The email address used to sign in to this session */
	email: z.email().optional(),
	/** The epoch timestamp when the session token expires */
	expires_at: z.number().positive(),
	/** The epoch timestamp (in ms) when the user's auth was checked (e.g. when the user signed in) */
	created_at: z.number().positive(),
	/** The epoch timestamp (in ms) when the user's auth was last updated (e.g. when the user signed in or the token was refreshed) */
	updated_at: z.number().positive(),
});
export type UserSession = z.infer<typeof UserSession>;

/** A method a user used to sign in */
export const UserSignInMethod = z.object({
	...Meta.shape,
	/** The email used to sign in (or the email from the oauth vendor) */
	email: z.email().trim().toLowerCase().optional(),
	/** The vendor of the oauth account this sign in method used to sign in */
	vendor: z.string().optional(),
	/** The ID of the oauth account this sign in method used to sign in */
	vendor_id: z.string().optional(),
	/** Whether the sign in method has a password associated with it */
	has_password: z.boolean(),
	/** The epoch timestamp (in ms) when the sign in method's jwt was last refreshed */
	refreshed_at: z.number().optional(),
	/** The epoch timestamp (in ms) when the email was verified. Oauth vendor accounts are always verified */
	verified_at: z.number().optional(),
});
export type UserSignInMethod = z.infer<typeof UserSignInMethod>;
