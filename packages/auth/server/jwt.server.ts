import { SessionToken } from '../types';
import { apiError, generateID } from '@delightstack/utilities';

/**
 * Generates & signs a jwt with the given claims
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
export async function generateJwt<Type = SessionToken['typ']>(
	secret: string, // jwt key secret in hex format
	claims: Partial<SessionToken> & { [additionalClaims: string]: any },
) {
	const iat = claims.iat || Math.floor(new Date().getTime() / 1000);
	const kid = Array.from(
		new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(secret))),
	)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
		.slice(0, 10);

	const header = {
		alg: 'HS256',
		typ: 'JWT',
		kid, // Calculated by taking the first 10 characters of the SHA-1 hash of the JWT_KEY_SECRET
	};
	const payload = {
		...claims,
		iss: claims.iss,
		jti: claims.jti || generateID(),
		typ: claims.typ || 'auth',
		iat,
		exp: claims.exp || iat + 3600,
	} as SessionToken<Type>;

	// Import the key from the env variable
	const key = await getSecretKey(secret);

	// Encode the header & payload in JWT format to create the JWT signature
	const encoded = [header, payload]
		.map((val) => JSON.stringify(val))
		.map((val) => btoa(val))
		.map((val) => val.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+/g, ''))
		.join('.');

	// Converted the header/payload into a buffer
	const binstr = encodeURIComponent(encoded).replace(/%([0-9A-F]{2})/g, (match, p1) => {
		return String.fromCharCode(parseInt(p1, 16));
	});
	const buffer = new TextEncoder().encode(binstr);

	// Sign the header/payload buffer with the created web crypto key
	const signature = await crypto.subtle
		.sign({ name: 'HMAC' }, key, buffer)
		.catch((error: any) => {
			console.error(error);
			throw apiError({ status: 500, message: `Error signing JWT` });
		});

	// Format the signature in the JWT signature format (encoded base64 with period separators)
	let encodedSignature = '';
	new Uint8Array(signature).forEach((code) => {
		encodedSignature += String.fromCharCode(code);
	});
	encodedSignature = btoa(encodedSignature)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+/g, '');
	const token = `${encoded}.${encodedSignature}`;
	return { jwt: token, decoded_jwt: payload, jwt_id: payload.jti };
}

/** Verifies the validity of the given session JWT. @throws if invalid. @returns the decoded jwt */
export async function decodeJwt<Type = SessionToken['typ']>(
	secret: string,
	jwt: string,
): Promise<SessionToken<Type>> {
	if (!jwt) throw apiError({ status: 400, message: `JWT not provided` });

	let parts: string[], header: any, payload: any, signature: string;
	try {
		parts = jwt.split('.');
		header = JSON.parse(atob(parts[0].replace(/_/g, '/').replace(/-/g, '+')));
		payload = JSON.parse(atob(parts[1].replace(/_/g, '/').replace(/-/g, '+')));
		signature = atob(parts[2].replace(/_/g, '/').replace(/-/g, '+'));
	} catch (error) {
		console.error(error);
		throw apiError({ status: 400, message: `Invalid auth token format` });
	}

	// Check for a valid algorithm
	if (!header?.alg) {
		throw apiError({ status: 401, message: `Invalid auth token. No algorithm` });
	}

	// Check the expiration & issued date of the token
	const expiryDate = (payload?.exp || 0) * 1000;
	const issuedDate = (payload?.iat || 0) * 1000;
	const currentDate = Date.now();
	if (
		expiryDate <= currentDate - 1000 * 60 * 10 ||
		issuedDate > currentDate + 1000 * 60 * 10
	) {
		throw apiError({
			status: 401,
			message: `Auth token expired`,
			detail: 'auth/expired',
		});
	}

	// Check if the key id matches the key in the env variable
	const key_id = Array.from(
		new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(secret))),
	)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
		.slice(0, 10);
	if (header.kid !== key_id) {
		throw apiError({
			status: 401,
			message: `Invalid auth token. Key ID does not match`,
		});
	}

	// Check if the signature matches the private key
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
	if (header.alg.match(/^RS\d+$/)) algorithm = 'HMAC';

	// Import the key from the env variable
	const key = await getSecretKey(secret);
	const verified = await crypto.subtle
		.verify({ hash, name: algorithm }, key, signatureArray, data)
		.catch((error: any) => {
			console.error(error);
			throw apiError({ status: 500, message: `Error verifying jwt signature` });
		});
	if (!verified) {
		throw apiError({
			status: 401,
			message: `Invalid auth token. Signature is invalid`,
		});
	}

	// Return the decoded JWT payload
	return payload;
}

/** Extracts the refresh token id from the raw jwt without validating the jwt's signature & expiry */
export function extractJwtRefreshToken(jwt: string) {
	let jti: string | undefined;
	try {
		const parts = jwt.split('.');
		const payload = JSON.parse(atob(parts[1].replace(/_/g, '/').replace(/-/g, '+')));
		jti = payload?.jti;
	} catch (error) {
		console.error(error);
		throw apiError({ status: 400, message: `Invalid auth token format` });
	}
	if (!jti) throw apiError({ status: 400, message: `Invalid auth token format` });
	return jti;
}

/** Creates the crypto key from the hex-encoded secret for HMAC-SHA256 operations */
export async function getSecretKey(secret: string) {
	// Convert the hex key to a Uint8Array for use in the web crypto API
	let keyBytes = new Uint8Array(secret.length / 2);
	for (let i = 0; i < secret.length; i += 2) {
		keyBytes[i / 2] = parseInt(secret.substr(i, 2), 16);
	}

	// Import the key from the env variable
	try {
		const key = await crypto.subtle.importKey(
			'raw',
			keyBytes,
			{ name: 'HMAC', hash: { name: 'SHA-256' } },
			false,
			['sign', 'verify'],
		);
		return key;
	} catch (error) {
		console.error(error);
		throw apiError({ status: 500, message: `Error importing private key` });
	}
}
