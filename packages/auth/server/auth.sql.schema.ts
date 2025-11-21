import { SqlTaggedTemplate } from '@delightstack/database';

/** A database schema for the auth server (durable object sqlite) */
export type AuthDatabaseSchema = {
	/** The user table that holds user information */
	user: {
		id: string;
		name: string;
		image?: string;
		json?: string;
		created_at: number;
		updated_at: number;
		deleted_at?: number;
	};
	/**
	 * The user_auth table that is used to authenticate a user with a provider.
	 * This allows a user to sign in with multiple providers (e.g. email, google, facebook, etc.)
	 * The user_auth table is used to store the user's email and password hash (if using email authentication).
	 */
	user_auth: {
		id: string;
		user_id: string;
		/** The oauth token used to authenticate the user with the provider/vendor. Null if using email instead of oauth */
		oauth_token_id?: string;
		email: string;
		verified_at?: number;
		password_hash?: string;
		created_at: number;
		updated_at: number;
	};
	/** A deleted sign in method that was previously verified. This is used to help recover an account if it is hacked */
	user_auth_deleted: {
		id: string;
		user_id: string;
		vendor?: string;
		vendor_id?: string;
		email: string;
		password_hash?: string;
		created_at: number;
		updated_at: number;
		deleted_at: number;
	};
	/**
	 * A table of user sessions. A row is created each time the user signs in.
	 * If a token is refreshed (without a sign in), the row is updated.
	 * This table is used to store the user's JWT and any extra data that needs to be stored with the session (e.g. user agent, ip address, etc.).
	 * The `type` field is used to differentiate between different types of sessions (e.g. auth, password reset, email verification).
	 * Only 'auth' sessions are used for regular sign ins.
	 * 'Password reset' sessions are used to reset the user's password, and 'email verification' sessions are used to verify the user's email address.
	 * 'email_signin' sessions are used to sign in with an email link.
	 */
	user_session: {
		id: string;
		type: 'auth' | 'password_reset' | 'email_verification' | 'email_signin';
		user_id: string;
		user_auth_id: string;
		jwt: string;
		/** Any extra data that needs to be stored with the session (e.g. user agent, ip address, etc.) */
		json?: string;
		/** The epoch timestamp when the session token expires */
		expires_at: number;
		/** The epoch timestamp (in ms) when the user's auth was checked (e.g. when the user signed in) */
		created_at: number;
		/** The epoch timestamp (in ms) when the user's auth was last updated (e.g. when the user signed in or the token was refreshed) */
		updated_at: number;
	};
	/**
	 * A table of oauth tokens used to access vendor APIs or to authenticate users using oauth.
	 * When a user signs in with oauth, an oauth token is created and this token is referenced in the user_auth table.
	 * An Oauth Token can also be added here if the user connects a vendor account to their profile (without using it to sign in).
	 * For example, they might add Dropbox to their profile to use it for file uploads, but not sign in with it.
	 */
	oauth_token: {
		id: string;
		/** The vendor of the oauth token - 'google' | 'facebook' | 'twitter' | 'github' | 'apple' */
		vendor: string;
		/** The account id of the user on the vendor's platform */
		vendor_id: string;
		/** The token used to make vendor API calls on behalf of a user */
		access_token: string;
		/** The epoch timestamp (in ms) when the access token will expire */
		access_token_expires_at?: number;
		/** The token used to generate new access tokens */
		refresh_token?: string;
		/** The epoch timestamp (in ms) when the refresh token will expire */
		refresh_token_expires_at?: number;
		/** The url to the profile image of the oauth account */
		account_image?: string;
		/** The email address of the user this token is for */
		account_email?: string;
		/** The name of the user this token is for */
		account_name?: string;
		/** A bitwise integer of capabilities that this token gives the user access to in this vendor account (e.g. 'mail', 'media', 'person', 'profile', etc.) */
		capability: number;
		/** Contains additional info needed for the oauth token. Like scopes, capabilities, oauth payload, email, name */
		json?: string;
		created_at: number;
		updated_at: number;
	};
	/**
	 * Oauth token permissions are used to store the permissions that a user has for a given oauth token.
	 * This is useful for allowing mutliple users to share a vendor account, but with different permissions.
	 * For example, a user might have access to a vendor account, but only be allowed to use it for certain actions.
	 */
	oauth_token_permission: {
		id: string;
		/** The oauth token that the permission is for */
		oauth_token_id: string;
		/**
		 * The id of the organization that the permission is for.
		 * If null, the permission is for the user with the same "user_id"
		 * Either the "org_id" or "user_id" must be set
		 */
		org_id?: string;
		/** The user that will be given the permission. If null, the permission is for every user in the org */
		user_id?: string;
		/**
		 * The bitwise encoded permissions that a person must have in the organization to be allowed to use this oauth token.
		 * Only applies if "org_id" is set.
		 * If null, the permission is for every user in the org.
		 */
		org_permission?: number;
		/**
		 * The bitwise encoded permissions granted to the user to access the vendor (assuming they match the org_id/org_permission/user_id).
		 * For example, this could be used to allow a user to only access certain scopes of the oauth token.
		 */
		permission: number;
		created_at: number;
		updated_at: number;
	};
	oauth_application: {
		/** The ID of the application. Used as the "client_id" in the oauth requests */
		id: string;
		/** The name of the application - usually the vendor name. Shown on the oauth consent page like "Zapier wants to connect to..." */
		name: string;
		/** The url to the logo to show on the oauth consent page */
		logo?: string;
		/** An optional url to the application's home page */
		url?: string;
		/** An optional description of the application. Shown on the oauth consent page */
		description?: string;
		/** The url to the application's privacy policy */
		privacy_policy_url?: string;
		/** The url to the application's terms of service */
		terms_of_service_url?: string;
		/** Contains additional info needed for the oauth application. Like redirect_uris and client_secrets */
		json?: string;
		/**
		 * The epoch timestamp in ms when the oauth application was verified (or undefined if it is not verified).
		 * Unverified applications could show "This app is not verified yet" on the oauth consent page.
		 * Verification is done by the server team and is required for applications that request sensitive scopes.
		 */
		verified_at?: number;
		/** The epoch timestamp in ms when the oauth application was created */
		created_at: number;
		/** The epoch timestamp in ms when the oauth application was last updated */
		updated_at: number;
	};
	/**
	 * A table of oauth application users. This associates a user with an oauth application.
	 * These users have full permissions to manage an oauth application and its tokens (including deleting the application).
	 */
	oauth_application_user: {
		id: string;
		/** The ID of the oauth application that this user is associated with */
		oauth_application_id: string;
		/** The ID of the user that is associated with the oauth application */
		user_id: string;
		/** Contains additional information (not used at the moment) */
		json?: string;
		/** The epoch timestamp in ms when the oauth application user was created */
		created_at: number;
		/** The epoch timestamp in ms when the oauth application user was last updated */
		updated_at: number;
	};
	/**
	 * An oauth application token is a token that is used to authenticate an oauth application with the server.
	 * For example, a "Zapier" application would have an oauth application token that is used to authenticate the application with the server.
	 * An application can have multiple tokens, each with different capabilities.
	 */
	oauth_application_token: {
		id: string;
		/** The ID of the oauth application that this token is for */
		oauth_application_id: string;
		/** The token used to authenticate the application with the server */
		access_token: string;
		/** The epoch timestamp in ms when the access token expires */
		access_token_expires_at?: number;
		/** The token used to refresh the access token */
		refresh_token?: string;
		/** The epoch timestamp in ms when the refresh token expires */
		refresh_token_expires_at?: number;
		/** The ID of the user that consented to the oauth application connection */
		user_id: string;
		/** The ID of the organization that consented to the oauth application connection */
		org_id: string;
		/**
		 * The bitwise encoded permissions that this token has for this org_id.
		 * This is used to limit what the application can do with the token
		 */
		permission: number;
		/** Additional information about the token */
		json?: string;
		/** The epoch timestamp in ms when the oauth application token was created (happens at the oauth consent page) */
		created_at: number;
		/** The epoch timestamp in ms when the oauth application token was last updated (happens when the oauth application refreshes their access_token) */
		updated_at: number;
	};
	/**
	 * An oauth application code is a standard oauth authorization code that starts the oauth connection
	 * The oauth code is used to authenticate the application with the server and is exchanged for an oauth application token.
	 */
	oauth_application_auth_code: {
		/** The ID of the oauth application code. Used as the "auth_code" in requests */
		id: string;
		/** The ID of the oauth application that this code is for */
		oauth_application_id: string;
		/** The ID of the user that consented to the oauth application connection */
		user_id: string;
		/** The ID of the organization that consented to the oauth application connection */
		org_id: string;
		/** The bitwise encoded permissions that this code has for this org_id */
		permission: number;
		/** The state string that was passed to the original oauth consent page */
		state?: string;
		// The redirect URI that the user will be redirected to after the oauth consent page
		redirect_uri?: string;
		/** Additional information about the token */
		json?: string;
		/** The epoch timestamp in ms when the code expires */
		expires_at: number;
		/** The epoch timestamp in ms when the oauth application code was created */
		created_at: number;
		/** The epoch timestamp in ms when the oauth application code was last updated */
		updated_at: number;
	};
	org: {
		id: string;
		/** The name of the organization */
		name: string;
		/**
		 * The ID of the user that owns the organization.
		 * They can't be removed from the organization until they are no longer the owner.
		 */
		owner_id: string;
		/**
		 * The durable object ID for the database of this organization
		 * This will be added to the auth JWT for faster durable object lookups
		 */
		db_id?: string;
		/**
		 * The integer representing the current subscription plan the organization is on.
		 * We use an integer here to save space since this will be saved in the JWT token as well.
		 */
		plan?: number;
		/** Additional json information about the organization */
		json?: string;
		/** The epoch timestamp in ms when the organization was created */
		created_at: number;
		/** The epoch timestamp in ms when the organization was last updated */
		updated_at: number;
		/** The epoch timestamp in ms when the organization was deleted */
		deleted_at?: number;
	};
	org_user: {
		id: number;
		org_id: string;
		user_id: string;
		permission: number;
		created_at: number;
		updated_at: number;
	};
	org_invitation: {
		id: string;
		/** The id of the organization that the user will be added to  */
		org_id: string;
		/** The user id of the person that is inviting the new user */
		user_id: string;
		/** The email address of the person being invited. If left blank, anyone with the link can join the organization */
		email?: string;
		/** The maximum number of times this invitation can be redeemed. If null, the invitation can be redeemed an unlimited number of times */
		max_redemptions?: number;
		/** The bitwise encoded permissions the user will be given after redeeming the invitation */
		permission: number;
		/** The epoch timestamp when the invitation was created */
		created_at: number;
		/** The epoch timestamp when the invitation was last updated */
		updated_at: number;
		/** The epoch timestamp when the invitation expires */
		expires_at?: number;
	};
	org_invitation_log: {
		id: string;
		/** The id of the organization that the user joined */
		org_id: string;
		/** The id of the invitation that was redeemed */
		invitation_id?: string;
		/** The id of the user that sent the invitation */
		inviter_id?: string;
		/** The id of the user that accepted the invitation */
		invitee_id: string;
		/** The email address of the person that was invited in the original org_invitation */
		email: string;
		/** The bitwise encoded permissions the user was given after redeeming the invitation */
		permission: number;
		/** The epoch timestamp when the invitation was created */
		created_at: number;
		/** The epoch timestamp when the invitation was accepted */
		updated_at: number;
	};
	global_key: {
		/** The key being reserved */
		id: string;
		/** The id of the organization that reserved the key */
		org_id: string;
		/** Any extra data that needs to be stored with the key */
		json?: string;
		created_at: number;
		updated_at: number;
	};
};

/** SQL Statements that need to be run to get the database to the correct state */
export const AUTH_DATABASE_UPGRADES = [
	(sql: SqlTaggedTemplate) => sql`
		-- Create a user table that holds user data
		CREATE TABLE IF NOT EXISTS user (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			image TEXT,
			json TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			deleted_at INTEGER
		);
	`,
	(sql: SqlTaggedTemplate) => sql`
		-- Create a user_auth table that is used to authenticate a user with a provider
		-- This allows a user to sign in with multiple providers (e.g. email, google, facebook, etc.)
		CREATE TABLE IF NOT EXISTS user_auth (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
			oauth_token_id TEXT, -- The oauth token used to authenticate the user with the provider/vendor. Null if using email instead of oauth
			email TEXT NOT NULL,
			password_hash TEXT,
			verified_at INTEGER,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);

		-- A deleted sign in method that was previously verified. This is used to help recover an account if it is hacked
		CREATE TABLE IF NOT EXISTS user_auth_deleted (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
			vendor TEXT, -- 'google' | 'facebook' | 'twitter' | 'github' | 'apple'. Null if using email instead of oauth
			vendor_id TEXT, -- the account id of the user on the vendor's platform. Null if using email instead of oauth
			email TEXT NOT NULL,
			password_hash TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			deleted_at INTEGER NOT NULL
		);
		
		-- Create a table of user sessions. A row is created each time the user signs in. If a token is refreshed (without a sign in), the row is updated
		CREATE TABLE IF NOT EXISTS user_session (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
			user_auth_id TEXT REFERENCES user_auth(id) ON DELETE CASCADE,
			jwt TEXT NOT NULL,
			type TEXT NOT NULL, -- 'auth' | 'password_reset' | 'email_verification' | 'email_signin'
			json TEXT, -- any extra data that needs to be stored with the session (e.g. user agent, ip address, etc.)
			expires_at INTEGER,
			created_at INTEGER NOT NULL, -- the timestamp when the user's auth was checked (e.g. when the user signed in)
			updated_at INTEGER NOT NULL -- the timestamp when the user's auth was last updated (e.g. when the user signed in or the token was refreshed)
		);

		-- Create a table of oauth tokens used to access vendor APIs or to authenticate users using oauth
		CREATE TABLE IF NOT EXISTS oauth_token (
			id TEXT PRIMARY KEY,
			vendor TEXT NOT NULL, -- 'google' | 'facebook' | 'twitter' | 'github' | 'apple'
			vendor_id TEXT NOT NULL, -- the account id of the user on the vendor's platform
			access_token TEXT NOT NULL, -- the token used to make vendor API calls on behalf of a user
			access_token_expires_at INTEGER, -- the epoch timestamp (in ms) when the access token will expire
			refresh_token TEXT, -- the token used to generate new access tokens
			refresh_token_expires_at INTEGER, -- the epoch timestamp (in ms) when the refresh token will expire
			account_image TEXT, -- The url to the profile image of the oauth account
			account_email TEXT, -- The email address of the user this token is for
			account_name TEXT, -- The name of the user this token is for
			capability INTEGER NOT NULL, -- A bitwise integer of capabilities (e.g. 'mail', 'media', 'person', 'profile', etc.)
			json TEXT, -- scopes, capabilities, oauth payload, email, name
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);

		-- Create a table of oauth token permissions. This is used to store the permissions that a user has for a given oauth token
		CREATE TABLE IF NOT EXISTS oauth_token_permission (
			id TEXT PRIMARY KEY,
			oauth_token_id TEXT NOT NULL REFERENCES oauth_token(id) ON DELETE CASCADE, -- The oauth token that the permission is for
			org_id TEXT,
			user_id TEXT, -- The user that will be given the permission. If null, the permission is for every user in the org
			org_permission INTEGER, -- A bitwise integer of permissions that a person must have in the organization to be allowed to use this oauth token. If null, the permission is for every user in the org
			permission INTEGER NOT NULL, -- A bitwise integer of permissions the user is allowed for this oauth token
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);

		-- Create a table of organizations. An organization can have multiple users
		CREATE TABLE IF NOT EXISTS org (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, -- user_id of the org's owner
			db_id TEXT, -- The durable object ID for the database of this organization
			plan INTEGER, -- The integer representing the current subscription plan the organization is on
			json TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			deleted_at INTEGER
		);

		-- Create a table of users in an organization
		CREATE TABLE IF NOT EXISTS org_user (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			org_id TEXT NOT NULL REFERENCES org(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
			permission INTEGER NOT NULL, -- A bitwise integer of permissions
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);

		-- Create a table of invitations that can be sent to users to join an organization
		CREATE TABLE IF NOT EXISTS org_invitation (
			id TEXT PRIMARY KEY,
			org_id TEXT NOT NULL REFERENCES org(id) ON DELETE CASCADE, -- The organization that the new user will join
			user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, -- The user that sent the invitation
			email TEXT, -- The email address of the person being invited. If left blank, anyone with the link can join the organization
			permission INTEGER NOT NULL, -- A bitwise integer of permissions the user will have in the organization
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
	`,
	(sql: SqlTaggedTemplate) => sql`
		ALTER TABLE org_invitation ADD COLUMN max_redemptions INTEGER;
		ALTER TABLE org_invitation ADD COLUMN expires_at INTEGER;

		-- Create a table of invitations that can be sent to users to join an organization
		CREATE TABLE IF NOT EXISTS org_invitation_log (
			id TEXT PRIMARY KEY,
			org_id TEXT NOT NULL REFERENCES org(id) ON DELETE CASCADE, -- The organization that the user joined
			invitation_id TEXT REFERENCES org_invitation(id) ON DELETE SET NULL, -- The id of the invitation that was redeemed
			inviter_id TEXT REFERENCES user(id) ON DELETE SET NULL, -- The id of the user that sent the invitation
			invitee_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, -- The id of the user that accepted the invitation
			email TEXT NOT NULL, -- The email address of the person that was invited in the original org_invitation
			permission INTEGER NOT NULL, -- A bitwise integer of permissions from the original org_invitation
			created_at INTEGER NOT NULL, -- the epoch timestamp when the invitation was created
			updated_at INTEGER NOT NULL -- the epoch timestamp when the invitation was accepted
		);
	`,
	(sql: SqlTaggedTemplate) => sql`
		-- Create a table of global keys that can be reserved for an organization
		CREATE TABLE IF NOT EXISTS global_key (
			id TEXT PRIMARY KEY, -- the key being reserved
			org_id TEXT NOT NULL REFERENCES org(id) ON DELETE CASCADE, -- The organization that reserved the key
			json TEXT, -- any extra data that needs to be stored with the key
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
	`,
	(sql: SqlTaggedTemplate) => sql`
		CREATE TABLE IF NOT EXISTS oauth_application (
			id TEXT PRIMARY KEY, -- The ID of the application. Used as the "client_id" in the oauth requests
			name TEXT NOT NULL UNIQUE, -- The name of the application - usually the vendor name. Shown on the oauth consent page like "Zapier wants to connect to..."
			logo TEXT, -- The url to the logo to show on the oauth consent page
			url TEXT, -- An optional url to the application's home page
			description TEXT, -- An optional description of the application. Shown on the oauth consent page
			privacy_policy_url TEXT, -- The url to the application's privacy policy
			terms_of_service_url TEXT, -- The url to the application's terms of service
			json TEXT, -- Contains additional info needed for the oauth application. Like redirect_uris and client_secrets
			verified_at INTEGER, -- The epoch timestamp in ms when the oauth application was verified (or undefined if it is not verified)
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS oauth_application_user (
			id TEXT PRIMARY KEY, -- The ID of the oauth application user
			oauth_application_id TEXT NOT NULL REFERENCES oauth_application(id) ON DELETE CASCADE, -- The ID of the oauth application that this user is associated with
			user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, -- The ID of the user that is associated with the oauth application
			json TEXT, -- Contains additional information (not used at the moment)
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS oauth_application_token (
			id TEXT PRIMARY KEY, -- The ID of the oauth application token
			oauth_application_id TEXT NOT NULL REFERENCES oauth_application(id) ON DELETE CASCADE, -- The ID of the oauth application that this token is for
			access_token TEXT NOT NULL, -- The token used to authenticate the application with the server
			access_token_expires_at INTEGER, -- The epoch timestamp in ms when the access token expires
			refresh_token TEXT, -- The token used to refresh the access token
			refresh_token_expires_at INTEGER, -- The epoch timestamp in ms when the refresh token expires
			user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, -- The ID of the user that consented to the oauth application connection
			org_id TEXT NOT NULL REFERENCES org(id) ON DELETE CASCADE, -- The ID of the organization that consented to the oauth application connection
			permission INTEGER NOT NULL, -- The bitwise encoded permissions that this token has for this org_id
			json TEXT, -- Additional information about the token
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS oauth_application_auth_code (
			id TEXT PRIMARY KEY, -- The ID of the oauth application code
			oauth_application_id TEXT NOT NULL REFERENCES oauth_application(id) ON DELETE CASCADE, -- The ID of the oauth application that this code is for
			user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, -- The ID of the user that consented to the oauth application connection
			org_id TEXT NOT NULL REFERENCES org(id) ON DELETE CASCADE, -- The ID of the organization that consented to the oauth application connection
			permission INTEGER NOT NULL, -- The bitwise encoded permissions that this code has for this org_id
			json TEXT, -- Additional information about the token
			expires_at INTEGER NOT NULL, -- The epoch timestamp in ms when the code expires
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
	`,
	(sql: SqlTaggedTemplate) => sql`
		ALTER TABLE oauth_application_auth_code ADD COLUMN state TEXT;
		ALTER TABLE oauth_application_auth_code ADD COLUMN redirect_uri TEXT;
	`,
];
