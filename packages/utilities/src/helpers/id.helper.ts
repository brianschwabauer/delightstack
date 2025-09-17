interface GenerateIdOptions {
	/** The length of the ID @default 20 */
	length?: number;

	/** The string of characters to choose from when creating the ID */
	chars?: string;

	/** Whether the ID should exclude vowel characters @default false */
	excludeVowels?: boolean;

	/** Whether the ID should exclude ambigious characters (like 1/l) @default false */
	excludeAmbigiousChars?: boolean;
}

/** Returns a unique ID based on the given options for database operations */
export function generateID(options?: GenerateIdOptions): string {
	let id = '';
	const length = options?.length || 20;
	let chars =
		options?.chars || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	if (options?.excludeVowels) chars = chars.replace(/[AEIOUaeiou]/g, '');
	if (options?.excludeAmbigiousChars) chars = chars.replace(/[l01]/g, '');
	for (let i = 0; i < length; i++) {
		id += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return id;
}

/**
 * The amount of IDs that have been created in this requested - used to increment the newly generated IDs.
 * This is needed because of how CloudFlare handles Date.now()
 * All Date.now() calls are exactly the same for the same request
 */
let idCounter = 0;

/** Generates a random ID for firebase RTDB based on the timestamp */
export function generateTimestampID(): string {
	// The characters that the native RTDB uses for IDs
	// Modeled after base64 web-safe chars, but ordered by ASCII.
	// const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

	// The 62 bit characters to use so we don't have to use symbols
	const PUSH_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

	let now = Date.now() + idCounter;
	const timeStampChars = new Array(8);
	const numChars = PUSH_CHARS.length;
	for (let i = 7; i >= 0; i--) {
		timeStampChars[i] = PUSH_CHARS.charAt(now % numChars);
		// NOTE: Can't use << here because javascript will convert to int and lose the upper bits.
		now = Math.floor(now / numChars);
	}
	let id = timeStampChars.join('');
	for (let i = 0; i < 12; i++) {
		id += PUSH_CHARS.charAt(Math.floor(Math.random() * numChars));
	}
	idCounter++;
	return id;
}
