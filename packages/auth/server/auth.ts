/* eslint-disable @typescript-eslint/no-explicit-any */
import { ApiAuthScope } from '@packages/api';

/**
 * Interface representing a decoded Firebase ID token, returned from the
 * {@link auth.Auth.verifyIdToken `verifyIdToken()`} method.
 *
 * Firebase ID tokens are OpenID Connect spec-compliant JSON Web Tokens (JWTs).
 * See the
 * [ID Token section of the OpenID Connect spec](http://openid.net/specs/openid-connect-core-1_0.html#IDToken)
 * for more information about the specific properties below.
 */
export interface DecodedIdToken extends DecodedJwtBody {
	/** A record of organizations the user belongs to with their role (0-12) */
	org: Record<string, number>;

	/** A record of organizations the user belongs to and the additional scopes they have for the org */
	scopes: Record<string, ApiAuthScope[]>;

	/** The user's super admin role (0-12) if they are a super admin */
	superAdmin?: number;

	firebase?: {
		/**
		 * Provider-specific identity details corresponding
		 * to the provider used to sign in the user.
		 */
		identities: {
			[key: string]: any;
		};
		/**
		 * The ID of the provider used to sign in the user.
		 * One of `"anonymous"`, `"password"`, `"facebook.com"`, `"github.com"`,
		 * `"google.com"`, `"twitter.com"`, `"apple.com"`, `"microsoft.com"`,
		 * "yahoo.com"`, `"phone"`, `"playgames.google.com"`, `"gc.apple.com"`,
		 * or `"custom"`.
		 *
		 * Additional Identity Platform provider IDs include `"linkedin.com"`,
		 * OIDC and SAML identity providers prefixed with `"saml."` and `"oidc."`
		 * respectively.
		 */
		sign_in_provider: string;
		/**
		 * The type identifier or `factorId` of the second factor, provided the
		 * ID token was obtained from a multi-factor authenticated user.
		 * For phone, this is `"phone"`.
		 */
		sign_in_second_factor?: string;
		/**
		 * The `uid` of the second factor used to sign in, provided the
		 * ID token was obtained from a multi-factor authenticated user.
		 */
		second_factor_identifier?: string;
		/**
		 * The ID of the tenant the user belongs to, if available.
		 */
		tenant?: string;
		[key: string]: any;
	};
	/**
	 * The `uid` corresponding to the user who the ID token belonged to.
	 *
	 * This value is not actually in the JWT token claims itself. It is added as a
	 * convenience, and is set as the value of the [`sub`](#sub) property.
	 */
	uid: string;
	[key: string]: any;
}

/** A generic JSON web token */
export interface DecodedJwt {
	/** The header of the JWT */
	header: DecodedJwtHeader;

	/** The body of the JWT */
	body: DecodedJwtBody;
}

/** A generic JSON web token header */
export interface DecodedJwtHeader {
	/** The type of token */
	typ: 'JWT';

	/** The algorithm used to sign the JWT */
	alg:
		| 'HS256'
		| 'HS384'
		| 'HS512'
		| 'RS256'
		| 'RS384'
		| 'RS512'
		| 'ES256'
		| 'ES384'
		| 'ES512'
		| 'PS256'
		| 'PS384'
		| 'PS512'
		| 'none';

	/** The ID of the public key that should be used to decode this JWT */
	kid?: string;
}

/** A generic JSON web token body */
export interface DecodedJwtBody {
	/** The name of the user associated with the account */
	name: string;

	/**
	 * The audience for which this token is intended.
	 *
	 * For Firebase, this value is a string equal to your Firebase project ID, the unique
	 * identifier for your Firebase project, which can be found in [your project's
	 * settings](https://console.firebase.google.com/project/_/settings/general/android:com.random.android).
	 */
	aud: string;
	/**
	 * Time, in seconds since the Unix epoch, when the end-user authentication
	 * occurred.
	 *
	 * This value is not set when this particular ID token was created, but when the
	 * user initially logged in to this session. In a single session, the Firebase
	 * SDKs will refresh a user's ID tokens every hour. Each ID token will have a
	 * different [`iat`](#iat) value, but the same `auth_time` value.
	 */
	auth_time: number;
	/**
	 * The email of the user to whom the ID token belongs, if available.
	 */
	email?: string;
	/**
	 * Whether or not the email of the user to whom the ID token belongs is
	 * verified, provided the user has an email.
	 */
	email_verified?: boolean;
	/**
	 * The ID token's expiration time, in seconds since the Unix epoch. That is, the
	 * time at which this ID token expires and should no longer be considered valid.
	 *
	 * The Firebase SDKs transparently refresh ID tokens every hour, issuing a new
	 * ID token with up to a one hour expiration.
	 */
	exp: number;
	/**
	 * The ID token's issued-at time, in seconds since the Unix epoch. That is, the
	 * time at which this ID token was issued and should start to be considered
	 * valid.
	 *
	 * The Firebase SDKs transparently refresh ID tokens every hour, issuing a new
	 * ID token with a new issued-at time. If you want to get the time at which the
	 * user session corresponding to the ID token initially occurred, see the
	 * [`auth_time`](#auth_time) property.
	 */
	iat: number;
	/**
	 * The issuer identifier for the issuer of the response.
	 *
	 * This value is a URL with the format
	 * `https://securetoken.google.com/<PROJECT_ID>`, where `<PROJECT_ID>` is the
	 * same project ID specified in the [`aud`](#aud) property.
	 */
	iss: string;
	/**
	 * The phone number of the user to whom the ID token belongs, if available.
	 */
	phone_number?: string;
	/**
	 * The photo URL for the user to whom the ID token belongs, if available.
	 */
	picture?: string;
	/**
	 * The `uid` corresponding to the user who the ID token belonged to.
	 *
	 * As a convenience, this value is copied over to the [`uid`](#uid) property.
	 */
	sub: string;

	/** Additional JWT claims */
	[key: string]: any;
}

/** Given a user's role (0-12) in an organization, it returns the auth scopes */
export function convertRoleToScopes(role: number): ApiAuthScope[] {
	const val = Math.max(0, Math.min(12, typeof role === 'number' ? role : 0));
	if (val < 3) return [];
	if (val < 6) {
		return ['client:read', 'org:read', 'content:write'];
	}
	if (val < 9) {
		return ['client:write', 'org:read', 'content:admin', 'invoice:write'];
	}
	if (val < 12) {
		return ['client:admin', 'org:write', 'content:admin', 'invoice:admin', 'mail:write'];
	}
	return ['client:admin', 'org:admin', 'content:admin', 'invoice:admin', 'mail:write'];
}

/** Returns the auth permission scopes the given JWT token has for the given orgID */
export function getAuthScopes(
	jwt?: DecodedIdToken,
	orgID?: string | null,
	userID?: string,
): ApiAuthScope[] {
	if (!jwt) return ['public'];
	if ((jwt?.superAdmin || 0) >= 6 || jwt?.aud === 'show-and-tour-pubsub') {
		return ['superadmin:write'];
	}
	if (!orgID) return userID && jwt?.uid === userID ? ['profile:write'] : ['public'];
	const authScopes = new Set<ApiAuthScope>(jwt?.scopes?.[orgID] || []);
	if ((jwt?.superAdmin || 0) >= 3) authScopes.add('superadmin:read');
	convertRoleToScopes(jwt?.org?.[orgID] || 0).forEach((scope) => authScopes.add(scope));
	if (userID && jwt?.uid === userID) authScopes.add('profile:write');

	// Returns the priority of each auth permission operation. Used for sorting scopes
	const rankOperation = (operation: string) => {
		if (operation === 'admin') return 4;
		if (operation === 'write') return 3;
		if (operation === 'edit') return 2;
		if (operation === 'read') return 1;
		return 0;
	};

	// Sort the scopes by biggest permission and remove duplicate scope permissions
	return Array.from(authScopes)
		.sort((a, b) => rankOperation(b.split(':')[1]) - rankOperation(a.split(':')[1]))
		.filter((scope, i, array) => {
			const [entity] = scope.split(':');
			return array.slice(0, i).every((checkScope) => entity !== checkScope.split(':')[0]);
		});
}

/**
 * Returns whether the user's auth permission scopes have enough permission for the given scope
 * If given a number as the scope, it uses the corresponding role (0-12) scopes
 */
export function isAuthAllowed(
	authScopes: ApiAuthScope[],
	requestedPermission: ApiAuthScope | ApiAuthScope[] | number | null = 3,
): boolean {
	if (!requestedPermission || requestedPermission === 'public') return true;
	if (Array.isArray(requestedPermission) && !requestedPermission.length) return true;
	const checkScopes: ApiAuthScope[] =
		typeof requestedPermission === 'number'
			? convertRoleToScopes(requestedPermission)
			: Array.isArray(requestedPermission)
			? requestedPermission
			: [requestedPermission];

	// Check if one of the user's current auth scopes matches the requested scope(s)
	return authScopes.some((authScope: any) => {
		return checkScopes.some((checkScope: any) => {
			const [authEntity, authOperation] = authScope.split(':');
			const [checkEntity, checkOperation] = checkScope.split(':');
			if (authEntity === 'superadmin') {
				return authOperation === 'write' || checkOperation === 'read';
			}
			if (authEntity !== checkEntity) return false;

			// Check if the requested operation is allowed given the auth scope
			if (checkOperation === 'admin') {
				return authOperation === 'admin';
			}
			if (checkOperation === 'write') {
				return ['admin', 'write', 'edit'].includes(authOperation);
			}
			if (checkOperation === 'edit') {
				return ['admin', 'write', 'edit'].includes(authOperation);
			}
			if (checkOperation === 'read') {
				return ['admin', 'write', 'edit', 'read'].includes(authOperation);
			}
			return false;
		});
	});
}

/** Decodes the given Firebase JWT and returns the decoded token (or throws error if invalid) */
export async function decodeFirebaseJWT(
	requestOrString: Request | string,
): Promise<DecodedIdToken> {
	let jwt: string | undefined;
	if (typeof requestOrString === 'string') {
		jwt = requestOrString;
	} else {
		jwt = requestOrString?.headers
			?.get('Authorization')
			?.match(/Bearer\s+([^\s;]+)/)?.[1];
		if (!jwt && requestOrString?.url) {
			const url = new URL(requestOrString.url);
			jwt = (
				url.searchParams?.get?.('auth') ||
				url.searchParams?.get?.('authorization') ||
				''
			).trim();
		}
	}
	if (!jwt) throw { status: 400, message: `Auth token not provided` };

	/** Determine the audience and keyID of the token */
	let audience: 'id' | 'pubsub' | 'session' = 'id';
	let keyID = '';
	try {
		const parts = jwt.split('.');
		const header = JSON.parse(atob(parts[0].replace(/_/g, '/').replace(/-/g, '+')));
		keyID = header?.kid || '';
		const body = JSON.parse(atob(parts[1].replace(/_/g, '/').replace(/-/g, '+')));
		// Check if the Firebase Project ID is correct
		const audiences = ['show-and-tour', 'show-and-tour-staging', 'show-and-tour-pubsub'];
		if (!audiences.includes(body?.aud)) {
			throw { status: 400, message: `Invalid auth token audience` };
		}
		if (body?.aud === 'show-and-tour-pubsub') {
			audience = 'pubsub';
		} else if (body?.iss?.startsWith?.('https://session.firebase.google.com')) {
			audience = 'session';
		}
	} catch (error) {
		throw { status: 400, message: `Invalid auth token format` };
	}

	const firebasePublicKey = await getGooglePublicKey(audience, keyID);
	const { body } = await decodeJWT(jwt, firebasePublicKey).catch(async () => {
		if (!jwt) throw { status: 400, message: `Auth token not provided` };
		return decodeJWT(jwt, await getGooglePublicKey(audience, keyID, true));
	});

	// Return the decoded JWT payload
	return { uid: body.sub, ...body } as DecodedIdToken;
}

// The cached Firebase public key for checking valid firebase JWTs
const _googlePublicKey: Record<string, CryptoKey> = {};

/**
 * Returns the public key for the right google service account (audience)
 * @param audience can be one of:
 *   'id' - the default audience for firebase auth tokens
 *   'pubsub' - the audience for google pubsub tokens
 *   'session' - the audience for firebase session tokens
 * @param keyID the key ID of the public key to get (if not provided, it will get the first key)
 * @param disableCache whether the cached version of the key should not be used @default false
 */
export async function getGooglePublicKey(
	audience: 'id' | 'pubsub' | 'session' = 'id',
	keyID: string = '',
	disableCache = false,
) {
	if (_googlePublicKey[audience] && !disableCache) return _googlePublicKey[audience];
	let publicKeyURL = `https://www.googleapis.com/robot/v1/metadata/jwk/securetoken@system.gserviceaccount.com`;
	if (audience === 'pubsub') {
		publicKeyURL = `https://www.googleapis.com/oauth2/v3/certs`;
	} else if (audience === 'session') {
		publicKeyURL = `https://identitytoolkit.googleapis.com/v1/sessionCookiePublicKeys`;
	}
	let response =
		disableCache || typeof caches === 'undefined'
			? null
			: ((await (caches as any).default.match(publicKeyURL)) as Response);
	let json: any = response ? await response.json().catch(() => null) : null;
	if (!json) {
		response = await fetch(publicKeyURL);
		if (response.ok) {
			json = await response.json();
			const cached = new Response(JSON.stringify(json), {
				headers: {
					'Content-Type': 'application/json; charset=UTF-8',
					'Cache-Control':
						response.headers.get('Cache-Control') ||
						'public, max-age=20524, s-maxage=20524',
				},
			});
			if (typeof caches !== 'undefined') {
				await (caches as any).default.put(publicKeyURL, cached);
			}
		}
	}
	const keys = json?.keys || [];
	const publicKey = keys.find((val: any) => val?.kid === keyID) || keys[0];
	if (!publicKey) {
		throw { status: 500, message: `Couldn't obtain Firebase public key` };
	}
	_googlePublicKey[audience] = await crypto.subtle.importKey(
		'jwk',
		publicKey,
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['verify'],
	);
	return _googlePublicKey[audience];
}

/**
 * Decodes the given JWT and returns the decoded token (or throws error if invalid)
 * If 'publicKey' is provided, the signature of the JWT will be checked. Otherwise, it will be assumed to be valid
 */
export async function decodeJWT(jwt: string, publicKey?: CryptoKey): Promise<DecodedJwt> {
	if (!jwt) throw { status: 400, message: `Auth token not provided` };

	let parts: string[], header: any, payload: any, signature: string;
	try {
		parts = jwt.split('.');
		header = JSON.parse(atob(parts[0].replace(/_/g, '/').replace(/-/g, '+')));
		payload = JSON.parse(atob(parts[1].replace(/_/g, '/').replace(/-/g, '+')));
		signature = atob(parts[2].replace(/_/g, '/').replace(/-/g, '+'));
	} catch (error) {
		throw { status: 400, message: `Invalid auth token format` };
	}

	// Check for a valid algorithm
	if (!header?.alg) throw { status: 401, message: `Invalid auth token. No algorithm` };

	// Check the expiration & issued date of the token
	const expiryDate = (payload?.exp || 0) * 1000;
	const issuedDate = (payload?.iat || 0) * 1000;
	const currentDate = Date.now();
	if (
		expiryDate <= currentDate - 1000 * 60 * 10 ||
		issuedDate > currentDate + 1000 * 60 * 10
	) {
		throw { status: 401, message: `Auth token expired` };
	}

	// Check if the signature matches the public key
	if (publicKey) {
		const signatureArray = new Uint8Array(
			Array.from(signature).map((c: any) => c.charCodeAt(0)),
		);
		const encoder = new TextEncoder();
		const data = encoder.encode([parts[0], parts[1]].join('.'));
		const hash = `SHA-${header.alg.match(/\d+/)?.[0] || 256}`;
		let algorithm = 'RSASSA-PKCS1-v1_5';
		if (header.alg.match(/^ES\d+$/)) algorithm = 'ECDSA';
		if (header.alg.match(/^HS\d+$/)) algorithm = 'HMAC';
		if (header.alg.match(/^PS\d+$/)) algorithm = 'RSASSA-PSS';
		const verified = await crypto.subtle.verify(
			{ hash, name: algorithm },
			publicKey,
			signatureArray,
			data,
		);
		if (!verified) {
			throw { status: 401, message: `Invalid auth token. Signature is invalid` };
		}
	}

	// Return the decoded JWT payload
	return { header: header, body: payload };
}

/** Creates a webcrypto key from the given PEM key string */
export async function createCryptoKeyFromPEM(pem: string): Promise<CryptoKey | null> {
	if (!pem) return null;
	try {
		const pemContents = pem
			.replace(/\n/g, '')
			.replace(/-----(BEGIN|END)(\sRSA)?\sPRIVATE\sKEY-----/g, '');
		const binaryDerString = atob(pemContents);
		const binaryDer = new ArrayBuffer(binaryDerString.length);
		const bufView = new Uint8Array(binaryDer);
		for (let i = 0, strLen = binaryDerString.length; i < strLen; i++) {
			bufView[i] = binaryDerString.charCodeAt(i);
		}
		const key = await crypto.subtle.importKey(
			'pkcs8',
			binaryDer,
			{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
			false,
			['sign'],
		);
		return key;
	} catch (error: any) {
		console.error(error?.message || 'Unknown Error');
		return null;
	}
}
