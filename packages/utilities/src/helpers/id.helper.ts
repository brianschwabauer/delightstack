import { DelightError } from './error.helper';

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

/** The number of leading characters of a timestamp ID that encode the timestamp */
const TIMESTAMP_ID_PREFIX_LENGTH = 8;

/** The shortest timestamp ID that still has enough random suffix to be useful */
const MIN_TIMESTAMP_ID_LENGTH = 10;

export interface GenerateTimestampIdOptions {
	/**
	 * The total length of the ID. The first 8 characters are always the base62
	 * timestamp; the remainder is random. Must be an integer of at least 10.
	 * @default 20
	 */
	length?: number;
}

/**
 * Generates a random ID based on the current timestamp.
 * It only uses alphanumeric characters and is 20 characters long by default.
 * It provides roughly the same collision resistance as a UUID, but is
 * lexicographically sortable, shorter, and more URL-safe.
 * Modeled after Firebase push IDs.
 *
 * The first 8 characters are the base62 encoded timestamp, so IDs generated at
 * different times sort chronologically regardless of the length used. Shorter
 * IDs trade collision resistance for size — 20 characters (12 random) is the
 * default, and anything below 10 is rejected.
 */
export function generateTimestampID(options?: GenerateTimestampIdOptions): string {
	// The 62 bit characters to use so we don't have to use symbols
	const PUSH_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

	const length = options?.length ?? 20;
	if (!Number.isInteger(length)) {
		throw DelightError.badRequest(
			`Invalid timestamp ID length '${length}' - it must be an integer`,
			{ code: 'INVALID_ID_LENGTH' },
		);
	}
	if (length < MIN_TIMESTAMP_ID_LENGTH) {
		throw DelightError.badRequest(
			`Invalid timestamp ID length '${length}' - it must be at least ${MIN_TIMESTAMP_ID_LENGTH}`,
			{ code: 'INVALID_ID_LENGTH' },
		);
	}

	let now = Date.now();
	if (now === idTimestamp) {
		idCounter++;
		now += idCounter;
	} else {
		idCounter = 0;
		idTimestamp = now;
	}
	const timeStampChars = Array.from({ length: TIMESTAMP_ID_PREFIX_LENGTH });
	const numChars = PUSH_CHARS.length;
	for (let i = TIMESTAMP_ID_PREFIX_LENGTH - 1; i >= 0; i--) {
		timeStampChars[i] = PUSH_CHARS.charAt(now % numChars);
		// NOTE: Can't use << here because javascript will convert to int and lose the upper bits.
		now = Math.floor(now / numChars);
	}
	let id = timeStampChars.join('');
	for (let i = 0; i < length - TIMESTAMP_ID_PREFIX_LENGTH; i++) {
		id += PUSH_CHARS.charAt(Math.floor(Math.random() * numChars));
	}
	return id;
}
