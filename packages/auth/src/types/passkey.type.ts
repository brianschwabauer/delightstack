import { z } from 'zod/v4';

/** A passkey (WebAuthn credential) registered to a user account */
export const Passkey = z.object({
	/** The credential ID (base64url) — unique identifier of the passkey */
	id: z.string(),
	/** The ID of the user_auth sign-in method backing this passkey */
	user_auth_id: z.string(),
	/** A user-provided label for the passkey (e.g. "MacBook Touch ID") */
	name: z.string().optional(),
	/** Whether the credential is synced across devices ('multiDevice') or bound to one ('singleDevice') */
	device_type: z.enum(['singleDevice', 'multiDevice']).optional(),
	/** Whether the credential is backed up (e.g. synced to iCloud Keychain / Google Password Manager) */
	backed_up: z.boolean(),
	/** The transports the authenticator supports (e.g. 'internal', 'hybrid', 'usb') */
	transports: z.array(z.string()).optional(),
	/** The epoch timestamp (in ms) when the passkey was last used to sign in */
	last_used_at: z.number().optional(),
	/** The epoch timestamp (in ms) when the passkey was created */
	created_at: z.number(),
	/** The epoch timestamp (in ms) when the passkey was last updated */
	updated_at: z.number(),
});
export type Passkey = z.infer<typeof Passkey>;

/**
 * The JSON-serialized WebAuthn registration response produced by the browser
 * (`navigator.credentials.create()` via `@simplewebauthn/browser`'s `startRegistration()`).
 * Validated loosely here — full cryptographic verification happens on the server.
 */
export const PasskeyRegistrationResponse = z.looseObject({
	id: z.string(),
	rawId: z.string(),
	type: z.literal('public-key'),
	response: z.looseObject({
		clientDataJSON: z.string(),
		attestationObject: z.string(),
		transports: z.array(z.string()).optional(),
	}),
	clientExtensionResults: z.looseObject({}),
	authenticatorAttachment: z.string().optional(),
});
export type PasskeyRegistrationResponse = z.infer<typeof PasskeyRegistrationResponse>;

/**
 * The JSON-serialized WebAuthn authentication response produced by the browser
 * (`navigator.credentials.get()` via `@simplewebauthn/browser`'s `startAuthentication()`).
 * Validated loosely here — full cryptographic verification happens on the server.
 */
export const PasskeyAuthenticationResponse = z.looseObject({
	id: z.string(),
	rawId: z.string(),
	type: z.literal('public-key'),
	response: z.looseObject({
		clientDataJSON: z.string(),
		authenticatorData: z.string(),
		signature: z.string(),
		userHandle: z.string().optional(),
	}),
	clientExtensionResults: z.looseObject({}),
	authenticatorAttachment: z.string().optional(),
});
export type PasskeyAuthenticationResponse = z.infer<typeof PasskeyAuthenticationResponse>;

/** The relying party info the server needs to generate & verify WebAuthn ceremonies */
export interface PasskeyRelyingParty {
	/** The relying party ID — the domain passkeys are bound to (e.g. 'example.com') */
	rp_id: string;
	/** The human-readable app name shown in the browser's passkey prompt */
	rp_name: string;
	/** The web origins allowed to complete WebAuthn ceremonies (e.g. 'https://example.com') */
	origins: string[];
}
