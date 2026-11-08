import type { JsonValue, McpSchema, McpToolInput } from './types.js';

/**
 * A hand-written validator for the {@link McpSchema} subset, plus the compiler
 * that turns a tool's `input` map into the JSON Schema `tools/list` publishes.
 *
 * Hand-written rather than borrowed: the subset is eight keywords wide, and a
 * schema library would be the package's only runtime dependency for the sake
 * of the ninety percent of JSON Schema this deliberately does not accept.
 *
 * Validation is *not* coercion. `"3"` is not a number and `"true"` is not a
 * boolean, because a model that sends the wrong type has made a mistake worth
 * telling it about — silently coercing teaches it the mistake works.
 */

// ---------------------------------------------------------------------------
// Compiling to JSON Schema
// ---------------------------------------------------------------------------

/** The JSON Schema shape MCP publishes. Wire keys, so camelCase where the spec is. */
export interface JsonSchemaObject {
	type: 'object';
	properties: Record<string, Record<string, unknown>>;
	required?: string[];
	additionalProperties: boolean;
	[key: string]: unknown;
}

function compileSchema(schema: McpSchema): Record<string, unknown> {
	const out: Record<string, unknown> = { type: schema.type };
	if (schema.description) out.description = schema.description;
	if (schema.default !== undefined) out.default = schema.default;

	switch (schema.type) {
		case 'string': {
			if (schema.enum) out.enum = [...schema.enum];
			if (schema.min_length !== undefined) out.minLength = schema.min_length;
			if (schema.max_length !== undefined) out.maxLength = schema.max_length;
			if (schema.format) out.format = schema.format;
			break;
		}
		case 'number':
		case 'integer': {
			if (schema.enum) out.enum = [...schema.enum];
			if (schema.minimum !== undefined) out.minimum = schema.minimum;
			if (schema.maximum !== undefined) out.maximum = schema.maximum;
			break;
		}
		case 'array': {
			out.items = compileSchema(schema.items);
			if (schema.min_items !== undefined) out.minItems = schema.min_items;
			if (schema.max_items !== undefined) out.maxItems = schema.max_items;
			break;
		}
		case 'object': {
			out.properties = compileProperties(schema.properties);
			const required = requiredKeys(schema.properties);
			if (required.length) out.required = required;
			out.additionalProperties = schema.additional === true;
			break;
		}
		case 'boolean':
			break;
	}
	return out;
}

function compileProperties(
	properties: Record<string, McpSchema>,
): Record<string, Record<string, unknown>> {
	const out: Record<string, Record<string, unknown>> = {};
	for (const [key, value] of Object.entries(properties)) out[key] = compileSchema(value);
	return out;
}

function requiredKeys(properties: Record<string, McpSchema>): string[] {
	return Object.entries(properties)
		.filter(([, value]) => value.optional !== true)
		.map(([key]) => key);
}

/** Compiles a tool's `input` map into the `inputSchema` `tools/list` publishes. */
export function compileInputSchema(input: McpToolInput): JsonSchemaObject {
	const required = requiredKeys(input);
	const schema: JsonSchemaObject = {
		type: 'object',
		properties: compileProperties(input),
		additionalProperties: false,
	};
	if (required.length) schema.required = required;
	return schema;
}

// ---------------------------------------------------------------------------
// Validating
// ---------------------------------------------------------------------------

export interface SchemaViolation {
	/** Dotted path from the arguments root — `edits.0.find`, `''` for the root. */
	path: string;
	message: string;
}

export interface ValidationResult {
	valid: boolean;
	violations: SchemaViolation[];
}

function typeName(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	return typeof value;
}

function join(path: string, key: string | number): string {
	return path ? `${path}.${key}` : String(key);
}

function validateValue(
	value: unknown,
	schema: McpSchema,
	path: string,
	violations: SchemaViolation[],
): void {
	switch (schema.type) {
		case 'string': {
			if (typeof value !== 'string') {
				violations.push({ path, message: `expected a string, got ${typeName(value)}` });
				return;
			}
			if (schema.enum && !schema.enum.includes(value)) {
				violations.push({
					path,
					message: `expected one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`,
				});
			}
			if (schema.min_length !== undefined && value.length < schema.min_length) {
				violations.push({
					path,
					message: `expected at least ${schema.min_length} character(s)`,
				});
			}
			if (schema.max_length !== undefined && value.length > schema.max_length) {
				violations.push({
					path,
					message: `expected at most ${schema.max_length} character(s)`,
				});
			}
			return;
		}
		case 'number':
		case 'integer': {
			// `NaN` and the infinities are `typeof 'number'` but cannot survive a
			// JSON round trip, so they can only arrive from an in-process caller.
			if (typeof value !== 'number' || !Number.isFinite(value)) {
				violations.push({
					path,
					message: `expected a ${schema.type}, got ${typeName(value)}`,
				});
				return;
			}
			if (schema.type === 'integer' && !Number.isInteger(value)) {
				violations.push({ path, message: 'expected an integer' });
			}
			if (schema.enum && !schema.enum.includes(value)) {
				violations.push({ path, message: `expected one of ${schema.enum.join(', ')}` });
			}
			if (schema.minimum !== undefined && value < schema.minimum) {
				violations.push({ path, message: `expected >= ${schema.minimum}` });
			}
			if (schema.maximum !== undefined && value > schema.maximum) {
				violations.push({ path, message: `expected <= ${schema.maximum}` });
			}
			return;
		}
		case 'boolean': {
			if (typeof value !== 'boolean') {
				violations.push({ path, message: `expected a boolean, got ${typeName(value)}` });
			}
			return;
		}
		case 'array': {
			if (!Array.isArray(value)) {
				violations.push({ path, message: `expected an array, got ${typeName(value)}` });
				return;
			}
			if (schema.min_items !== undefined && value.length < schema.min_items) {
				violations.push({
					path,
					message: `expected at least ${schema.min_items} item(s)`,
				});
			}
			if (schema.max_items !== undefined && value.length > schema.max_items) {
				violations.push({
					path,
					message: `expected at most ${schema.max_items} item(s)`,
				});
			}
			value.forEach((item, index) =>
				validateValue(item, schema.items, join(path, index), violations),
			);
			return;
		}
		case 'object': {
			validateObject(
				value,
				schema.properties,
				schema.additional === true,
				path,
				violations,
			);
			return;
		}
	}
}

function validateObject(
	value: unknown,
	properties: Record<string, McpSchema>,
	additional: boolean,
	path: string,
	violations: SchemaViolation[],
): void {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		violations.push({ path, message: `expected an object, got ${typeName(value)}` });
		return;
	}
	const record = value as Record<string, unknown>;
	for (const [key, property] of Object.entries(properties)) {
		const present = Object.hasOwn(record, key) ? record[key] : undefined;
		if (present === undefined || present === null) {
			// `null` is treated as absent. Models emit it for "no value" far more
			// often than they omit the key, and rejecting it teaches nothing.
			if (property.optional !== true) {
				violations.push({ path: join(path, key), message: 'is required' });
			}
			continue;
		}
		validateValue(present, property, join(path, key), violations);
	}
	if (!additional) {
		for (const key of Object.keys(record)) {
			// `hasOwn`, never `in`: `in` walks the prototype chain, so `toString`,
			// `constructor` and `__proto__` all read as declared properties and slip
			// past `additionalProperties: false`.
			if (Object.hasOwn(properties, key)) continue;
			violations.push({ path: join(path, key), message: 'is not a known argument' });
		}
	}
}

/** Validates a tool call's arguments against the tool's `input` map. */
export function validateInput(args: unknown, input: McpToolInput): ValidationResult {
	const violations: SchemaViolation[] = [];
	validateObject(args ?? {}, input, false, '', violations);
	return { valid: violations.length === 0, violations };
}

/** Renders violations as one line an agent can act on. */
export function formatViolations(violations: SchemaViolation[]): string {
	return violations
		.map((v) => (v.path ? `${v.path}: ${v.message}` : v.message))
		.join('; ');
}

/**
 * Applies declared defaults to absent optional arguments.
 *
 * Kept separate from validation, and run after it, so that a default can never
 * paper over an argument that failed to validate.
 */
export function applyDefaults(
	args: Record<string, unknown>,
	input: McpToolInput,
): Record<string, unknown> {
	const out: Record<string, unknown> = { ...args };
	for (const [key, schema] of Object.entries(input)) {
		// `null` counts as absent here for the same reason it does in the
		// validator: a model that sent `null` meant "no value", and the two steps
		// disagreeing would hand a tool a `null` where it declared a default.
		if ((out[key] === undefined || out[key] === null) && schema.default !== undefined) {
			out[key] = schema.default as JsonValue;
		}
	}
	return out;
}
