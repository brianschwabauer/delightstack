import { DelightError } from './error.helper';

/**
 * The base62 digits used by sort keys, in ascending ASCII order so that ordinary
 * string comparison and digit comparison agree.
 */
const SORT_KEY_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** The lowest digit ("zero") of the sort key alphabet */
const ZERO = SORT_KEY_DIGITS[0]!;

/** The highest digit of the sort key alphabet */
const NINE = SORT_KEY_DIGITS[SORT_KEY_DIGITS.length - 1]!;

/** The number of digits in the sort key alphabet */
const BASE = SORT_KEY_DIGITS.length;

/**
 * The smallest representable integer part ('A' followed by 26 zero digits).
 * A key equal to it exactly is reserved so that there is always room to insert
 * something before the current first item.
 */
const SMALLEST_INTEGER = `A${ZERO.repeat(26)}`;

function invalid(key: string): DelightError {
	return DelightError.badRequest(`Invalid sort key '${key}'`, {
		code: 'INVALID_SORT_KEY',
	});
}

/**
 * Returns how many characters the integer part of a key occupies, based on its
 * first character. 'a'..'z' are positive magnitudes (2..27 characters) and
 * 'Z'..'A' are negative magnitudes (2..27 characters), so longer positive
 * integers sort after shorter ones and longer negative integers sort before.
 */
function getIntegerLength(head: string, key: string): number {
	if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 97 + 2;
	if (head >= 'A' && head <= 'Z') return 90 - head.charCodeAt(0) + 2;
	throw invalid(key);
}

/** Returns the leading integer part of a key (everything before the fraction) */
function getIntegerPart(key: string): string {
	const length = getIntegerLength(key.charAt(0), key);
	if (length > key.length) throw invalid(key);
	return key.slice(0, length);
}

/** Throws if the given integer part is not a well-formed integer part */
function validateInteger(integer: string): void {
	if (integer.length !== getIntegerLength(integer.charAt(0), integer))
		throw invalid(integer);
}

/** Throws if the given string is not a well-formed sort key */
function validateSortKey(key: string): void {
	if (key === SMALLEST_INTEGER) throw invalid(key);
	const integer = getIntegerPart(key);
	const fraction = key.slice(integer.length);
	for (const char of fraction) {
		if (!SORT_KEY_DIGITS.includes(char)) throw invalid(key);
	}
	for (const char of integer.slice(1)) {
		if (!SORT_KEY_DIGITS.includes(char)) throw invalid(key);
	}
	// A trailing zero would make two different strings represent the same
	// fraction, which breaks plain string comparison ('a1V' vs 'a1V0').
	if (fraction.endsWith(ZERO)) throw invalid(key);
}

/** Returns the next integer part after the given one, or null if there is no room left */
function incrementInteger(integer: string): string | null {
	validateInteger(integer);
	const head = integer.charAt(0);
	const digits = integer.slice(1).split('');
	let carry = true;
	for (let i = digits.length - 1; carry && i >= 0; i--) {
		const next = SORT_KEY_DIGITS.indexOf(digits[i]!) + 1;
		if (next === BASE) {
			digits[i] = ZERO;
		} else {
			digits[i] = SORT_KEY_DIGITS[next]!;
			carry = false;
		}
	}
	if (!carry) return head + digits.join('');
	if (head === 'Z') return `a${ZERO}`;
	if (head === 'z') return null;
	const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
	// Crossing into a larger magnitude adds a digit; shrinking a negative
	// magnitude removes one.
	if (nextHead > 'a') digits.push(ZERO);
	else digits.pop();
	return nextHead + digits.join('');
}

/** Returns the previous integer part before the given one, or null if there is no room left */
function decrementInteger(integer: string): string | null {
	validateInteger(integer);
	const head = integer.charAt(0);
	const digits = integer.slice(1).split('');
	let borrow = true;
	for (let i = digits.length - 1; borrow && i >= 0; i--) {
		const next = SORT_KEY_DIGITS.indexOf(digits[i]!) - 1;
		if (next === -1) {
			digits[i] = NINE;
		} else {
			digits[i] = SORT_KEY_DIGITS[next]!;
			borrow = false;
		}
	}
	if (!borrow) return head + digits.join('');
	if (head === 'a') return `Z${NINE}`;
	if (head === 'A') return null;
	const nextHead = String.fromCharCode(head.charCodeAt(0) - 1);
	if (nextHead < 'Z') digits.push(NINE);
	else digits.pop();
	return nextHead + digits.join('');
}

/**
 * Returns a fraction strictly between the two given fractions, where each
 * fraction is a string of base62 digits after an implied radix point.
 * `before` may be '' (meaning 0) and `after` may be null (meaning 1).
 * The result never ends in a zero digit.
 */
function midpoint(before: string, after: string | null): string {
	if (after !== null && before >= after) throw invalid(after);
	if (before.endsWith(ZERO) || after?.endsWith(ZERO)) throw invalid(after ?? before);
	if (after !== null) {
		// Copy the shared prefix through untouched and recurse on the remainder.
		let shared = 0;
		while ((before[shared] ?? ZERO) === after[shared]) shared++;
		if (shared > 0) {
			return after.slice(0, shared) + midpoint(before.slice(shared), after.slice(shared));
		}
	}
	// The first digits now differ (or `before` has run out entirely).
	const digitBefore = before ? SORT_KEY_DIGITS.indexOf(before.charAt(0)) : 0;
	const digitAfter = after !== null ? SORT_KEY_DIGITS.indexOf(after.charAt(0)) : BASE;
	if (digitAfter - digitBefore > 1) {
		// There is a whole digit of room, so a single digit is enough.
		return SORT_KEY_DIGITS[Math.round(0.5 * (digitBefore + digitAfter))]!;
	}
	// The first digits are consecutive, so we have to go a digit deeper.
	if (after !== null && after.length > 1) return after.slice(0, 1);
	return SORT_KEY_DIGITS[digitBefore]! + midpoint(before.slice(1), null);
}

/**
 * Generates a sort key that orders strictly between the two given keys, for
 * fractional indexing — reordering a list by writing one row instead of
 * renumbering every row after it.
 *
 * Keys are plain strings compared with ordinary string comparison (`<`, `>`,
 * SQL `ORDER BY`), so they can be stored in a plain text column and sorted by
 * the database.
 *
 * ```ts
 * generateSortKey();               // 'a0'   — the first key in an empty list
 * generateSortKey('a0');           // 'a1'   — append after the last key
 * generateSortKey(null, 'a0');     // 'Zz'   — prepend before the first key
 * generateSortKey('a0', 'a1');     // 'a0V'  — insert between two keys
 * ```
 *
 * @param before The key of the item the new one goes after, or null/undefined for the start of the list
 * @param after The key of the item the new one goes before, or null/undefined for the end of the list
 */
export function generateSortKey(before?: string | null, after?: string | null): string {
	const a = before ?? null;
	const b = after ?? null;
	if (a !== null) validateSortKey(a);
	if (b !== null) validateSortKey(b);
	if (a !== null && b !== null && a >= b) {
		throw DelightError.badRequest(
			`Cannot generate a sort key between '${a}' and '${b}' - the first key must sort before the second`,
			{ code: 'INVALID_SORT_KEY_RANGE' },
		);
	}

	if (a === null) {
		if (b === null) return `a${ZERO}`;
		const integerB = getIntegerPart(b);
		const fractionB = b.slice(integerB.length);
		if (integerB === SMALLEST_INTEGER) return integerB + midpoint('', fractionB);
		// `b` has a fraction, so its bare integer part already sorts before it.
		if (integerB < b) return integerB;
		const decremented = decrementInteger(integerB);
		if (decremented === null) {
			throw DelightError.badRequest(`Cannot generate a sort key before '${b}'`, {
				code: 'SORT_KEY_EXHAUSTED',
			});
		}
		return decremented;
	}

	const integerA = getIntegerPart(a);
	const fractionA = a.slice(integerA.length);

	if (b === null) {
		const incremented = incrementInteger(integerA);
		return incremented === null ? integerA + midpoint(fractionA, null) : incremented;
	}

	const integerB = getIntegerPart(b);
	const fractionB = b.slice(integerB.length);
	if (integerA === integerB) return integerA + midpoint(fractionA, fractionB);
	const incremented = incrementInteger(integerA);
	if (incremented === null) {
		throw DelightError.badRequest(`Cannot generate a sort key after '${a}'`, {
			code: 'SORT_KEY_EXHAUSTED',
		});
	}
	if (incremented < b) return incremented;
	return integerA + midpoint(fractionA, null);
}
