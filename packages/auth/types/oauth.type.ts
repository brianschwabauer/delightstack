import { z } from 'zod/v4';
import { Meta } from './meta.type';

/**
 * Encodes the given OAuth scope names into a bitwise integer for storing in the database.
 * The array index of each scope name is its bit position.
 *
 * @param scopes - The full list of OAuth scope names (array index = bit position). Append-only: never reorder or remove entries.
 * @param values - The scope names to encode (must be entries from `scopes`)
 */
export function encodeOauthScopes<const T extends readonly string[]>(
	scopes: T,
	values: T[number][],
): number {
	let encoded = 0;
	for (const value of values) {
		const bit = scopes.indexOf(value);
		if (bit !== -1) encoded |= 1 << bit;
	}
	return encoded;
}

/**
 * Decodes a bitwise integer into the OAuth scope names it represents.
 * The array index of each scope name is its bit position.
 *
 * @param scopes - The full list of OAuth scope names (array index = bit position)
 * @param encoded - The bitwise integer to decode
 */
export function decodeOauthScopes<const T extends readonly string[]>(
	scopes: T,
	encoded: number,
): T[number][] {
	const result: T[number][] = [];
	for (let i = 0; i < scopes.length; i++) {
		if (encoded & (1 << i)) result.push(scopes[i]);
	}
	return result;
}

/** The configuration used to authorize an oauth2 connection to an API */
export const OauthConfig = z
	.object({
		/** The environment this code is being run in. (useful for calling a vendor's staging endpoint) */
		environment: z.enum(['staging', 'production']),
		/** The URL to initialize the oauth connection */
		authorization_url: z.string(),
		/** The URL to fetch an access token from a refresh token or auth code */
		access_token_url: z.string(),
		/** The oauth2 ID used to authenticate our servers with the vendor */
		client_id: z.string(),
		/** The oauth2 secret used to authenticate our servers with the vendor */
		client_secret: z.string(),
		/** The secret used to authenticate that a webhook is coming from the vendor */
		webhook_secret: z.string().optional(),
		/** The base url (without '/' at the end) of the vendor's api */
		api_url: z.string().optional(),
	})
	.catchall(z.string().optional());

export type OauthConfig = z.infer<typeof OauthConfig>;

/** A oauth account that the user has connected to their account */
export const OauthAccount = z.object({
	...Meta.shape,
	/** The vendor this token is for (e.g. 'google', 'stripe', etc.) */
	vendor: z.string(),

	/** The vendor ID of the user this token is for (e.g. '1234567890' for google) */
	vendor_id: z.string(),

	/** The list of permissions the user has for this oauth account */
	permissions: z.array(z.string()),

	/** The list of capabilities this oauth token grants */
	capabilities: z.array(z.string()),

	/** The url to an profile image of oauth account */
	account_image: z.string().optional(),

	/** The email address of the user this token is for */
	account_email: z.string().optional(),

	/** The name of the user this token is for */
	account_name: z.string().optional(),
});

export type OauthAccount = z.infer<typeof OauthAccount>;

/** A generated oauth token used to interact with a vendor API on behalf of a user */
export const OauthToken = z.object({
	...Meta.shape,
	/** The vendor this token is for (e.g. 'google', 'stripe', etc.) */
	vendor: z.string(),

	/** The vendor ID of the user this token is for (e.g. '1234567890' for google) */
	vendor_id: z.string(),

	/** The token used to make vendor API calls on behalf of a user */
	access_token: z.string(),

	/** The epoch timestamp (in ms) when the access token will expire */
	access_token_expires_at: z.number().optional(),

	/** The token used to generate new access tokens */
	refresh_token: z.string().optional(),

	/** The epoch timestamp (in ms) when the refresh token will expire */
	refresh_token_expires_at: z.number().optional(),

	/** The list of capabilities this oauth token grants */
	capabilities: z.array(z.string()),

	/** The url to an profile image of oauth account */
	account_image: z.string().optional(),

	/** The email address of the user this token is for */
	account_email: z.string().optional(),

	/** The name of the user this token is for */
	account_name: z.string().optional(),

	/** The additional information provided by the vendor's oauth server. This is the full payload returned */
	payload: z.record(z.string(), z.any()).optional(),
});

export type OauthToken = z.infer<typeof OauthToken>;

/** The information needed to create a new oauth token (from the auth_code passed in the callback url) */
export const CreateOauthToken = z.object({
	/** The vendor this token is for (e.g. 'google', 'stripe', etc.) */
	vendor: z.string(),

	/** The code used to initially connect via oauth (when their isn't a refresh token yet) */
	auth_code: z.string(),

	/** The url that the user will be redirected to after completing the oauth flow */
	redirect_url: z.string(),
});

export type CreateOauthToken = z.infer<typeof CreateOauthToken>;

/**
 * An oauth application that 3rd party developers can use to connect their application to our oauth server
 */
export const OauthApplication = z.object({
	/** The ID of the application. Used as the "client_id" in oauth requests */
	id: z.string(),
	/** The name of the application to display on the oauth consent page */
	name: z.string(),
	/** The url to the logo to display on the oauth consent page */
	logo: z.string().optional(),
	/**
	 * The list of client secrets to check against the "client_secret" field when an oauth application uses client_id and client_secret.
	 * We allow multiple client secrets to be used for the same application, so that you can rotate them without breaking existing clients.
	 * We store the hash of the client secret, so that we can verify it without storing the actual secret.
	 * Only the first 10 characters of the hash are returned to the client to avoid leaking information about the secret.
	 */
	client_secrets: z.array(
		z.object({
			hash: z.string().optional(),
			id: z.string(),
			created_at: z.number(),
		}),
	),
	/** The list of urls that the application can be redirected to after oauth authorization */
	redirect_urls: z.array(z.string()),
	/** The default url that the user will be redirected to after authorization (used if not specified in query params) */
	default_redirect_url: z.string().optional(),
	/** An optional url to the application's home page */
	url: z.string().optional(),
	/** An optional description of the application. Shown on the oauth consent page */
	description: z.string().optional(),
	/** The url to the application's privacy policy */
	privacy_policy_url: z.string().optional(),
	/** The url to the application's terms of service */
	terms_of_service_url: z.string().optional(),
	/**
	 * The epoch timestamp in ms when the oauth application was verified (or undefined if it is not verified).
	 * Unverified applications could show "This app is not verified yet" on the oauth consent page.
	 * Verification is done by the server team and is required for applications that request sensitive scopes.
	 */
	verified_at: z.number().optional(),
	/** The epoch timestamp in ms when the oauth application was created */
	created_at: z.number(),
	/** The epoch timestamp in ms when the oauth application was last updated */
	updated_at: z.number(),
});
export type OauthApplication = z.infer<typeof OauthApplication>;

/** An API that supports an oauth2 connection to their API */
export interface OauthApi {
	/** Methods for modifying the oauth connection */
	oauth: {
		/** Returns information about the user account attached via Oauth */
		account: () => Promise<{
			/** The ID of the account in the oauth vendor's database */
			id: string;
			/** Whether or not the oauth account email has been verified. If not, the "email" field can't be trusted */
			verified: boolean;
			/** The name of the user */
			name?: string;
			/** The email of the user */
			email?: string;
			/** The url to the user's profile image */
			image?: string;
		}>;

		/** Returns the required oauth2 scopes required to use the application for the requested capabilities */
		scopes: (capabilities?: string[]) => string[];

		/** Returns the capabilities based on the given oauth2 scopes */
		capabilities: (scopes?: string[]) => string[];

		/** Disconnects the user's account & disables future use */
		revoke: () => Promise<void>;
	};
}
