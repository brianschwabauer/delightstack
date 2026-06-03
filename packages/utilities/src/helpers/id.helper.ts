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
 * The amount of IDs that have been created in this request at this same timestamp.
 * This is needed because of how CloudFlare handles Date.now()
 * All Date.now() calls are exactly the same for the same request
 * So if we create multiple IDs in the same request, the timestamp part would be the same (which would break sort order)
 */
let idCounter = 0;
let idTimestamp = 0;

/**
 * Generates a random ID based on the current timestamp.
 * It only uses alphanumeric characters and is 20 characters long.
 * It provides roughly the same collision resistance as a UUID, but is
 * lexicographically sortable, shorter, and more URL-safe.
 * Modeled after Firebase push IDs.
 */
export function generateTimestampID(): string {
	// The 62 bit characters to use so we don't have to use symbols
	const PUSH_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

	let now = Date.now();
	if (now === idTimestamp) {
		idCounter++;
		now += idCounter;
	} else {
		idCounter = 0;
		idTimestamp = now;
	}
	const timeStampChars = Array.from({ length: 8 });
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
	return id;
}
