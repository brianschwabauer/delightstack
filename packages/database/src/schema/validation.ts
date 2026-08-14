import { DelightError } from '@delightstack/utilities';
import type {
	DatabaseField,
	EnumField,
	NumberField,
	StringField,
	StringFieldFormat,
	VectorField,
} from './field-types';

/* -------------------------------------------------------------------------- */
/* String format validation                                                   */
/*                                                                            */
/* The regexes intentionally track zod v4's semantics for the same formats so */
/* that data accepted before the in-house validator continues to be accepted. */
/* -------------------------------------------------------------------------- */

const EMAIL_REGEX =
	/^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;
const UUID_REGEX =
	/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
const ISO_DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const ISO_TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?$/;
const ISO_DATETIME_REGEX =
	/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):?[0-5]\d)$/;
const IPV4_REGEX =
	/^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6_REGEX =
	/^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d)|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d))$/;
const BASE64_REGEX = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
const COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** The regex used by `.color()` (also exposed as the field's html `pattern`) */
export { COLOR_REGEX };

/** Validates a string against a declared format. Returns an error message, or undefined when valid. */
function checkStringFormat(format: StringFieldFormat, value: string): string | undefined {
	switch (format) {
		case 'email':
			return EMAIL_REGEX.test(value) ? undefined : 'Invalid email address';
		case 'url': {
			try {
				new URL(value);
				return undefined;
			} catch {
				return 'Invalid URL';
			}
		}
		case 'uuid':
			return UUID_REGEX.test(value) ? undefined : 'Invalid UUID';
		case 'datetime':
			return ISO_DATETIME_REGEX.test(value) ? undefined : 'Invalid ISO datetime';
		case 'date':
			return ISO_DATE_REGEX.test(value) ? undefined : 'Invalid ISO date';
		case 'time':
			return ISO_TIME_REGEX.test(value) ? undefined : 'Invalid ISO time';
		case 'ipv4':
			return IPV4_REGEX.test(value) ? undefined : 'Invalid IPv4 address';
		case 'ipv6':
			return IPV6_REGEX.test(value) ? undefined : 'Invalid IPv6 address';
		case 'base64':
			return BASE64_REGEX.test(value) ? undefined : 'Invalid base64 string';
		case 'color':
			return COLOR_REGEX.test(value) ? undefined : 'Invalid color';
		// Display-only formats — no validation
		case 'password':
		case 'phone':
			return undefined;
	}
}

/**
 * Float-tolerant remainder check for `.step()`, tracking zod v4's multipleOf.
 * Both operands are scaled to integers using their decimal precision before the
 * modulo, so `.step(0.01)` accepts 19.99 (where `19.99 % 0.01` !== 0 in floats).
 */
function floatSafeRemainder(value: number, step: number): number {
	const value_decimals = (value.toString().split('.')[1] || '').length;
	const step_decimals = (step.toString().split('.')[1] || '').length;
	const decimals = value_decimals > step_decimals ? value_decimals : step_decimals;
	const value_int = Number.parseInt(value.toFixed(decimals).replace('.', ''), 10);
	const step_int = Number.parseInt(step.toFixed(decimals).replace('.', ''), 10);
	return (value_int % step_int) / 10 ** decimals;
}

/** Applies a string field's declared transforms (in declaration order) to the value */
function applyStringTransforms(field: StringField, value: string): string {
	let result = value;
	for (const transform of field.transforms ?? []) {
		switch (transform.type) {
			case 'trim':
				result = result.trim();
				break;
			case 'lowercase':
				result = result.toLowerCase();
				break;
			case 'uppercase':
				result = result.toUpperCase();
				break;
			case 'normalize':
				result = result.normalize(transform.form);
				break;
		}
	}
	return result;
}

/** The result of a non-throwing validation via `FieldValidator.safeParse()` */
export type SafeParseResult =
	| { success: true; data: unknown }
	| { success: false; error: string };

/**
 * The in-house validator stored at `field.schema` for scalar-ish fields
 * (string, number, boolean, enum, geopoint, vector).
 *
 * It reads its constraints (min/max/format/options/…) live from the field
 * definition it was constructed with, so builder methods only need to mutate
 * the field — the validator picks the changes up automatically.
 */
export class FieldValidator {
	#field: DatabaseField;

	constructor(field: DatabaseField) {
		this.#field = field;
	}

	/** Resolves the field's `.default()` value (calling it when it is a function) */
	resolveDefault(): unknown {
		const field = this.#field as DatabaseField & { default_value?: unknown };
		if (!('has_default' in field) || !field.has_default) return undefined;
		const def = field.default_value;
		return typeof def === 'function' ? def() : def;
	}

	/**
	 * Validates & parses the given value, returning a result instead of throwing.
	 *
	 * Pipeline order:
	 *   1. undefined → default (short-circuits like zod v4: the default value is
	 *      returned as-is, without transforms or validation) or optional passthrough
	 *   2. Date coercion — a Date becomes epoch ms for number fields, or ISO text
	 *      for `.date()`/`.time()`/`.datetime()` string fields
	 *   3. transforms (string fields only), in declaration order — so
	 *      `.trim().min(1)` rejects a whitespace-only string
	 *   4. built-in validators (min/max/format/gt/lt/step/…)
	 *   5. custom `.check()` functions
	 * The transformed value is what gets returned (and persisted).
	 */
	safeParse(value: unknown): SafeParseResult {
		const field = this.#field;

		// undefined resolves to the default (when declared), or passes when optional
		if (value === undefined) {
			if ('has_default' in field && field.has_default) {
				return { success: true, data: this.resolveDefault() };
			}
			if ('optional' in field && field.optional) {
				return { success: true, data: undefined };
			}
			return { success: false, error: 'Required' };
		}
		if (value === null) {
			if ('optional' in field && field.optional) {
				return { success: true, data: null };
			}
			return { success: false, error: `Invalid input: expected ${field.type}` };
		}

		// Coercion stage — a Date instance is converted to the field's declared
		// representation: epoch ms for number fields, ISO text (matching the
		// declared `.date()`/`.time()`/`.datetime()` format) for string fields.
		// Unformatted string fields (and every other type) stay strict.
		if (value instanceof Date) {
			if (Number.isNaN(value.getTime())) {
				return { success: false, error: 'Invalid date' };
			}
			if (field.type === 'number') {
				value = value.getTime();
			} else if (field.type === 'string') {
				const format = (field as StringField).format;
				if (format === 'date' || format === 'time' || format === 'datetime') {
					const iso = value.toISOString();
					value =
						format === 'date'
							? iso.slice(0, 10)
							: format === 'time'
								? iso.slice(11, 19)
								: iso;
				}
			}
		}

		// Transform stage — mutates the value before any validation runs
		if (field.type === 'string' && typeof value === 'string') {
			value = applyStringTransforms(field as StringField, value);
		}

		const error = this.#checkValue(field, value);
		if (error) return { success: false, error };

		// Run the custom `.check()` validators after the built-in checks
		if ('checks' in field && field.checks) {
			for (const check of field.checks) {
				const message = check(value);
				if (typeof message === 'string' && message) {
					return { success: false, error: message };
				}
			}
		}
		return { success: true, data: value };
	}

	/**
	 * Validates & parses the given value.
	 * @throws a DelightError (status 400) with a human-readable message when invalid
	 */
	parse(value: unknown): unknown {
		const result = this.safeParse(value);
		if (!result.success) {
			throw new DelightError({ message: result.error, status: 400 });
		}
		return result.data;
	}

	/** Runs the built-in per-type validation. Returns an error message, or undefined when valid. */
	#checkValue(field: DatabaseField, value: unknown): string | undefined {
		switch (field.type) {
			case 'string': {
				const string_field = field as StringField;
				if (typeof value !== 'string') {
					return `Invalid input: expected string, received ${typeof value}`;
				}
				if (
					typeof string_field.minlength === 'number' &&
					value.length < string_field.minlength
				) {
					return `Must be at least ${string_field.minlength} character${string_field.minlength === 1 ? '' : 's'}`;
				}
				if (
					typeof string_field.maxlength === 'number' &&
					value.length > string_field.maxlength
				) {
					return `Must be at most ${string_field.maxlength} character${string_field.maxlength === 1 ? '' : 's'}`;
				}
				for (const pattern of string_field.patterns ?? []) {
					if (!pattern.test(value)) return 'Invalid format';
				}
				if (
					typeof string_field.starts_with === 'string' &&
					!value.startsWith(string_field.starts_with)
				) {
					return `Must start with "${string_field.starts_with}"`;
				}
				if (
					typeof string_field.ends_with === 'string' &&
					!value.endsWith(string_field.ends_with)
				) {
					return `Must end with "${string_field.ends_with}"`;
				}
				if (
					typeof string_field.includes === 'string' &&
					!value.includes(string_field.includes)
				) {
					return `Must include "${string_field.includes}"`;
				}
				if (string_field.format) {
					return checkStringFormat(string_field.format, value);
				}
				return undefined;
			}
			case 'number': {
				const number_field = field as NumberField;
				if (typeof value !== 'number' || !Number.isFinite(value)) {
					return `Invalid input: expected number, received ${typeof value === 'number' ? String(value) : typeof value}`;
				}
				if (number_field.integer && !Number.isInteger(value)) {
					return 'Must be an integer';
				}
				if (typeof number_field.min === 'number' && value < number_field.min) {
					return `Must be at least ${number_field.min}`;
				}
				if (typeof number_field.max === 'number' && value > number_field.max) {
					return `Must be at most ${number_field.max}`;
				}
				if (
					typeof number_field.exclusive_min === 'number' &&
					value <= number_field.exclusive_min
				) {
					return `Must be greater than ${number_field.exclusive_min}`;
				}
				if (
					typeof number_field.exclusive_max === 'number' &&
					value >= number_field.exclusive_max
				) {
					return `Must be less than ${number_field.exclusive_max}`;
				}
				if (
					typeof number_field.step === 'number' &&
					number_field.step > 0 &&
					floatSafeRemainder(value, number_field.step) !== 0
				) {
					return `Must be a multiple of ${number_field.step}`;
				}
				return undefined;
			}
			case 'boolean': {
				if (typeof value !== 'boolean') {
					return `Invalid input: expected boolean, received ${typeof value}`;
				}
				return undefined;
			}
			case 'enum': {
				const enum_field = field as EnumField;
				if (typeof value !== 'string' || !enum_field.options.includes(value)) {
					return `Must be one of the allowed options: ${enum_field.options.join(', ')}`;
				}
				return undefined;
			}
			case 'geopoint': {
				const point = value as { lat?: unknown; lon?: unknown };
				if (
					typeof value !== 'object' ||
					typeof point.lat !== 'number' ||
					typeof point.lon !== 'number' ||
					Number.isNaN(point.lat) ||
					Number.isNaN(point.lon)
				) {
					return `Must be a geopoint with valid 'lat' and 'lon' numbers`;
				}
				if (point.lat < -90 || point.lat > 90) return 'lat must be between -90 and 90';
				if (point.lon < -180 || point.lon > 180) {
					return 'lon must be between -180 and 180';
				}
				return undefined;
			}
			case 'vector': {
				const vector_field = field as VectorField;
				if (!Array.isArray(value)) return 'Invalid input: expected an array of numbers';
				if (vector_field.dimensions > 0 && value.length !== vector_field.dimensions) {
					return `Must be an array of numbers with length ${vector_field.dimensions}`;
				}
				if (value.some((item) => typeof item !== 'number' || Number.isNaN(item))) {
					return 'Must contain only valid numbers';
				}
				return undefined;
			}
			default:
				return undefined;
		}
	}
}
