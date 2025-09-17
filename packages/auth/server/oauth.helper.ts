/** The configuration used to authorize an oauth2 connection to an API */
export interface OauthConfig {
	/** The environment this code is being run in. (useful for calling a vendor's staging endpoint) */
	environment: 'staging' | 'production';

	/** The URL to initialize the oauth connection */
	authorizationURL: string;

	/** The URL to fetch an access token from a refresh token or auth code */
	accessTokenURL: string;

	/** The URL that the user will be redirected to after setting up the oauth connection */
	redirectURL: string;

	/** The oauth2 ID used to authenticate our servers with the vendor */
	clientID: string;

	/** The oauth2 secret used to authenticate our servers with the vendor */
	clientSecret: string;

	/** The secret used to authenticate that a webhook is coming from the vendor */
	webhookSecret?: string;

	/** The base url (without '/' at the end) of the vendor's api */
	apiURL?: string;

	[other: string]: string | undefined;
}

/** A credential used to interact with a vendor's API */
export interface OauthCredential extends Omit<OauthToken, 'authCode'> {
	/** The list of oauth2 scopes this token has permission to use */
	scopes: string[];

	/** The list of orgIDs that have connected this vendor account and have permission to use it */
	orgIDs?: string[];

	/** The name of the user that owns the vendor account. This name comes directly from the vendor oauth API. */
	name?: string;

	/** The email address used for the vendor's account (not the email used for Show & Tour) */
	email?: string;

	/**
	 * The list of IDs of connections to this credential.
	 * Used to allow multiple users to connect to the same credential with different permissions
	 */
	connectedVendorIDs?: string[];

	/** A record of vendor connections to this credential */
	connectedVendor?: {
		[vendorID: string]: {
			/** The ID of the organization that connected this vendor */
			orgID: string;

			/** The ID of the user that controls the connection to the vendor */
			owner: string;

			/** The list of permissions that users (or user roles) have for each vendor entity */
			permissions?: VendorPermission[];
		};
	};

	/** The list of errors that happened when attempting to connect to the vendor. Becomes null on successful connections */
	errors?: OauthCredentialError[] | null;

	/** The tag used to ID which 3rd party service this credential connects to */
	vendor?: string;

	/** The Show & Tour ID of the vendor object used to connect */
	vendorID?: string;

	/** The vendor's ID of the connected account's organization/group/team. */
	vendorOrgID?: string;

	/** The vendor's ID of the connected user's account. */
	vendorUserID?: string;

	/** The global ID used to search for entities from a vendor. In the format - `{vendor}~{vendorOrgID}~{vendorUserID}` */
	vendorUUID?: VendorUUID;
}

/** A pending credential used to interact with a vendor's API */
export interface PendingOauthCredential {
	/** The tag used to ID which 3rd party service this credential connects to */
	vendor?: string;

	/** The ID of the user that controls the connection to the vendor */
	owner: string;

	/** The ID of the organization making the connection to the vendor */
	orgID: string;

	/** The list of capabilities this vendor supports */
	capabilities?: VendorCapability[];

	/** The list of oauth2 scopes this token has permission to use */
	scopes: string[];
}

/** A generated oauth token used to interact with a vendor API on behalf of a user */
export interface OauthToken {
	/** The code used to initially connect via oauth (when their isn't a refresh token yet) */
	authCode?: string;

	/** The token used to make vendor API calls on behalf of a user */
	accessToken: string;

	/** The token used to generate new access tokens */
	refreshToken: string;

	/** The epoch timestamp (in ms) when the access token will expire */
	expires: number;

	/** The epoch timestamp (in ms) when the refresh token will expire */
	refreshExpires: number;
}

/** Info about an error that occurred when connecting to an OauthVendor */
export interface OauthCredentialError {
	/** The http status code the vendor returned */
	status: number;

	/** The error message the vendor returned */
	message: string;

	/** The error code the vendor returned */
	code: string;

	/** The epoch timestamp of the error */
	time: number;

	/** The URL that was being requested */
	url: string;

	/** The HTTP method that was being requested */
	method: string;

	/** The Show & Tour ApiEntity that was being interacted with */
	entity: string;

	/** The full body payload of the vendor */
	payload?: any;
}

/**
 * Returns an oauth token for the given oauth credential
 * If an authCode is provided, this means it's the initial setup (using the callback URL)
 * If no authCode is provided, this uses the refresh token in the credential to get the access code
 * If a valid access token is already provided, it will simply return that token
 * If an expired token is provided, it will refresh the token and return the new one
 */
export const getOauthToken = async (
	config: Partial<OauthConfig>,
	token: Partial<OauthToken>,
): Promise<OauthToken & { payload?: Record<string, any> }> => {
	if (!config.accessTokenURL) {
		throw { status: 400, message: `Access token URL not provided` };
	}

	// Check if the provided token is not expired. If not expired, return it
	if ((token?.expires || 0) - 5 * 60 * 1000 > Date.now()) {
		if (token.accessToken && token.refreshToken) {
			return token as OauthToken;
		}
	}

	// Generate a new access token with the given config & refresh token
	const response = await fetch(config.accessTokenURL, {
		method: 'POST',
		headers: {
			Accept: 'application/json, application/x-www-form-urlencoded',
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			...(!token.authCode ? {} : { code: token.authCode }),
			...(token.authCode ? {} : { refresh_token: token.refreshToken }),
			client_id: config.clientID || '',
			client_secret: config.clientSecret || '',
			grant_type: token.authCode ? 'authorization_code' : 'refresh_token',
			...(token.authCode ? { redirect_uri: config.redirectURL || '' } : {}),
		}).toString(),
	});

	// Parse the body as JSON if possible
	const raw = await response.text();
	let body: any = {};
	try {
		body = JSON.parse(raw);
	} catch (error) {
		new URLSearchParams(raw).forEach((val, key) => (body[key] = val));
	}

	// Check if an error happened when getting the access token
	if (!response.ok) {
		const message =
			body.error_description || body.error || `Unknown error. Couldn't connect to vendor`;
		const code = `oauth/${body.error || 'unknown'}`;
		console.error(`Error getting access token: ${message}`, body);
		throw { status: response.status || 500, code, message };
	}

	// Get the access token expiry information
	let expiresIn: number = +body.expires_in || +body.x_expires_in || 0;
	expiresIn = expiresIn * (expiresIn > 100000000000 ? 1 : 1000);
	let expiresAt: number = body.expires_at || body.x_expires_at || 0;
	expiresAt = `${expiresAt}`.match(/^\d+$/)
		? +expiresAt * (+expiresAt > 100000000000 ? 1 : 1000)
		: Date.parse(`${expiresAt}`) || 0;
	const expires = expiresIn ? expiresIn + Date.now() : expiresAt;

	// Get the refresh token expiry information
	let refreshExpiresIn: number =
		+body.refresh_token_expires_in || +body.x_refresh_token_expires_in || 0;
	refreshExpiresIn = refreshExpiresIn * (refreshExpiresIn > 100000000000 ? 1 : 1000);
	let refreshExpiresAt: number =
		body.refresh_token_expires_at || body.x_refresh_token_expires_at || 0;
	refreshExpiresAt = `${refreshExpiresAt}`.match(/^\d+$/)
		? +refreshExpiresAt * (+refreshExpiresAt > 100000000000 ? 1 : 1000)
		: Date.parse(`${refreshExpiresAt}`) || 0;
	const refreshExpires = refreshExpiresIn
		? refreshExpiresIn + Date.now()
		: refreshExpiresAt;

	return {
		accessToken: body.access_token,
		refreshToken: body.refresh_token,
		expires,
		refreshExpires,
		payload: body,
	};
};
