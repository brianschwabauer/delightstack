import { describe, expect, it } from 'vitest';
import {
	applyDefaults,
	compileInputSchema,
	formatViolations,
	validateInput,
} from './schema.js';
import type { McpToolInput } from './types.js';

const SEARCH_INPUT: McpToolInput = {
	query: { type: 'string', description: 'What to look for', min_length: 1 },
	limit: { type: 'integer', optional: true, minimum: 1, maximum: 100, default: 20 },
	mode: {
		type: 'string',
		optional: true,
		enum: ['lexical', 'semantic', 'hybrid'],
	},
	tags: { type: 'array', optional: true, items: { type: 'string' } },
};

describe('compileInputSchema', () => {
	it('produces an object schema with the non-optional keys required', () => {
		const schema = compileInputSchema(SEARCH_INPUT);
		expect(schema.type).toBe('object');
		expect(schema.required).toEqual(['query']);
		expect(schema.additionalProperties).toBe(false);
	});

	it('renames the snake_case constraints to their JSON Schema keywords', () => {
		const schema = compileInputSchema(SEARCH_INPUT);
		expect(schema.properties.query).toMatchObject({
			type: 'string',
			minLength: 1,
			description: 'What to look for',
		});
		expect(schema.properties.limit).toMatchObject({
			type: 'integer',
			minimum: 1,
			maximum: 100,
			default: 20,
		});
	});

	it('compiles arrays and enums', () => {
		const schema = compileInputSchema(SEARCH_INPUT);
		expect(schema.properties.tags).toMatchObject({
			type: 'array',
			items: { type: 'string' },
		});
		expect(schema.properties.mode.enum).toEqual(['lexical', 'semantic', 'hybrid']);
	});

	it('omits `required` entirely when every argument is optional', () => {
		const schema = compileInputSchema({ id: { type: 'string', optional: true } });
		expect(schema.required).toBeUndefined();
	});

	it('compiles nested objects, with their own required list', () => {
		const schema = compileInputSchema({
			edit: {
				type: 'object',
				properties: {
					find: { type: 'string' },
					occurrence: { type: 'string', optional: true },
				},
			},
		});
		expect(schema.properties.edit).toMatchObject({
			type: 'object',
			required: ['find'],
			additionalProperties: false,
		});
	});
});

describe('validateInput', () => {
	it('accepts a call with only the required arguments', () => {
		expect(validateInput({ query: 'lighthouse' }, SEARCH_INPUT).valid).toBe(true);
	});

	it('accepts every optional argument at once', () => {
		const result = validateInput(
			{ query: 'lighthouse', limit: 5, mode: 'hybrid', tags: ['fiction'] },
			SEARCH_INPUT,
		);
		expect(result.valid).toBe(true);
	});

	it('names the missing required argument', () => {
		const result = validateInput({ limit: 5 }, SEARCH_INPUT);
		expect(result.valid).toBe(false);
		expect(result.violations).toContainEqual({ path: 'query', message: 'is required' });
	});

	it('refuses an unknown argument rather than ignoring it', () => {
		const result = validateInput({ query: 'x', limt: 5 }, SEARCH_INPUT);
		expect(result.valid).toBe(false);
		expect(formatViolations(result.violations)).toContain('limt');
	});

	it('does not coerce a numeric string into a number', () => {
		const result = validateInput({ query: 'x', limit: '5' }, SEARCH_INPUT);
		expect(result.valid).toBe(false);
		expect(result.violations[0].message).toContain('expected a integer');
	});

	it('rejects a non-integer number for an integer', () => {
		expect(validateInput({ query: 'x', limit: 1.5 }, SEARCH_INPUT).valid).toBe(false);
	});

	it('enforces minimum and maximum', () => {
		expect(validateInput({ query: 'x', limit: 0 }, SEARCH_INPUT).valid).toBe(false);
		expect(validateInput({ query: 'x', limit: 101 }, SEARCH_INPUT).valid).toBe(false);
		expect(validateInput({ query: 'x', limit: 100 }, SEARCH_INPUT).valid).toBe(true);
	});

	it('enforces min_length', () => {
		expect(validateInput({ query: '' }, SEARCH_INPUT).valid).toBe(false);
	});

	it('enforces an enum, and lists the choices', () => {
		const result = validateInput({ query: 'x', mode: 'fuzzy' }, SEARCH_INPUT);
		expect(result.valid).toBe(false);
		expect(result.violations[0].message).toContain('semantic');
	});

	it('treats null as absent, for an optional and for a required argument', () => {
		expect(validateInput({ query: 'x', limit: null }, SEARCH_INPUT).valid).toBe(true);
		const result = validateInput({ query: null }, SEARCH_INPUT);
		expect(result.violations).toContainEqual({ path: 'query', message: 'is required' });
	});

	it('rejects a scalar where an array belongs', () => {
		const result = validateInput({ query: 'x', tags: 'fiction' }, SEARCH_INPUT);
		expect(result.valid).toBe(false);
		expect(result.violations[0].message).toContain('expected an array');
	});

	it('validates array items and reports the index', () => {
		const result = validateInput({ query: 'x', tags: ['ok', 7] }, SEARCH_INPUT);
		expect(result.valid).toBe(false);
		expect(result.violations[0].path).toBe('tags.1');
	});

	it('reports a deep path through an array of objects', () => {
		const input: McpToolInput = {
			edits: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						find: { type: 'string' },
						replace: { type: 'string' },
					},
				},
			},
		};
		const result = validateInput(
			{ edits: [{ find: 'a', replace: 'b' }, { find: 'c' }] },
			input,
		);
		expect(result.valid).toBe(false);
		expect(result.violations).toContainEqual({
			path: 'edits.1.replace',
			message: 'is required',
		});
	});

	it('rejects an array where an object belongs', () => {
		const result = validateInput([], SEARCH_INPUT);
		expect(result.valid).toBe(false);
	});

	it('treats missing arguments as an empty object', () => {
		expect(validateInput(undefined, {}).valid).toBe(true);
		expect(validateInput(undefined, SEARCH_INPUT).valid).toBe(false);
	});

	it('rejects a boolean given as a string', () => {
		const input: McpToolInput = { dry_run: { type: 'boolean' } };
		expect(validateInput({ dry_run: 'true' }, input).valid).toBe(false);
		expect(validateInput({ dry_run: true }, input).valid).toBe(true);
	});

	it('collects every violation rather than stopping at the first', () => {
		const result = validateInput({ limit: 'x', mode: 'nope' }, SEARCH_INPUT);
		expect(result.violations.length).toBe(3);
	});

	it('allows extra keys on an object that opts in', () => {
		const input: McpToolInput = {
			frontmatter: { type: 'object', properties: {}, additional: true },
		};
		expect(validateInput({ frontmatter: { anything: 1 } }, input).valid).toBe(true);
	});
});

describe('applyDefaults', () => {
	it('fills an absent optional argument that declares a default', () => {
		expect(applyDefaults({ query: 'x' }, SEARCH_INPUT)).toEqual({
			query: 'x',
			limit: 20,
		});
	});

	it('leaves a supplied value alone, including a falsy one', () => {
		const input: McpToolInput = {
			flag: { type: 'boolean', optional: true, default: true },
		};
		expect(applyDefaults({ flag: false }, input)).toEqual({ flag: false });
	});
});
