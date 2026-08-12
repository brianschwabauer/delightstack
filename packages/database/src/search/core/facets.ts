/**
 * Facet counting over a matched set.
 * See `plans/database/Native Search Engine Plan.md` §4.8.
 *
 * Facets are always counted in `core/` — never compiled to SQL `GROUP BY` —
 * because every user-visible count must come from one shared implementation
 * (§3's consistency contract).
 *
 * Value ordering is count descending, then value ascending through the core
 * comparator; `sort: 'asc'` flips only the count half of that.
 *
 * Note on the returned `values` object: JS orders integer-like own keys
 * numerically before string keys regardless of insertion order, so a string
 * facet over purely numeric-looking values loses the count ordering. That is a
 * property of the JS object shape the result type has always used, and it is
 * identical on both drivers.
 */

import { DelightError } from '@delightstack/utilities';
import { compareStrings, compareValues } from './compare';
import type {
	FacetDefinition,
	FacetResult,
	NumberFacetDefinition,
	StringFacetDefinition,
} from './types';
import { getFieldValue, isArrayFieldType, type WhereSchema } from './where';

/** Orama's default cap on returned string-facet values. */
export const DEFAULT_STRING_FACET_LIMIT = 10;

/** Count facets for every requested field over the full matched set. */
export function computeFacets(
	docs: readonly Record<string, unknown>[],
	facets: Record<string, FacetDefinition> | undefined,
	schema: WhereSchema,
): FacetResult | undefined {
	if (!facets) return undefined;
	const result: FacetResult = {};
	for (const field of Object.keys(facets).sort()) {
		const definition = facets[field];
		const type = schema[field];
		if (type === undefined) {
			throw DelightError.badRequest(`Unknown facet field "${field}".`, {
				code: 'unknown_facet_field',
			});
		}
		if (type === 'geopoint' || (typeof type === 'string' && type.startsWith('vector['))) {
			throw DelightError.badRequest(`Field "${field}" cannot be faceted.`, {
				code: 'invalid_facet_field',
			});
		}
		const is_array = isArrayFieldType(type);
		if (type === 'number' || type === 'number[]') {
			result[field] = countNumberFacet(
				docs,
				field,
				definition as NumberFacetDefinition,
				is_array,
			);
		} else if (type === 'boolean' || type === 'boolean[]') {
			result[field] = countBooleanFacet(docs, field, is_array);
		} else {
			result[field] = countStringFacet(
				docs,
				field,
				definition as StringFacetDefinition,
				is_array,
			);
		}
	}
	return result;
}

/** Collect a field's contributing values from one document. */
function valuesOf(
	doc: Record<string, unknown>,
	field: string,
	is_array: boolean,
): readonly unknown[] {
	const value = getFieldValue(doc, field);
	if (value === null || value === undefined) return [];
	if (is_array || Array.isArray(value)) {
		return (value as unknown[]).filter(
			(element) => element !== null && element !== undefined,
		);
	}
	return [value];
}

/**
 * String/enum facet: one count per distinct value.
 *
 * `count` is the number of distinct values *before* `offset`/`limit` are
 * applied, so a paginating consumer can tell how many buckets exist.
 */
function countStringFacet(
	docs: readonly Record<string, unknown>[],
	field: string,
	definition: StringFacetDefinition | undefined,
	is_array: boolean,
): { count: number; values: Record<string, number> } {
	const counts = new Map<string, number>();
	for (const doc of docs) {
		for (const value of valuesOf(doc, field, is_array)) {
			const key = String(value);
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	const descending = (definition?.sort ?? 'desc').toLowerCase() !== 'asc';
	const entries = [...counts.entries()].sort((a, b) => {
		if (a[1] !== b[1]) return descending ? b[1] - a[1] : a[1] - b[1];
		return compareStrings(a[0], b[0]);
	});
	const offset = definition?.offset ?? 0;
	const limit = definition?.limit ?? DEFAULT_STRING_FACET_LIMIT;
	const values: Record<string, number> = {};
	for (const [key, count] of entries.slice(offset, offset + limit)) values[key] = count;
	return { count: entries.length, values };
}

/** Number facet: one count per configured, inclusive range. */
function countNumberFacet(
	docs: readonly Record<string, unknown>[],
	field: string,
	definition: NumberFacetDefinition | undefined,
	is_array: boolean,
): { count: number; values: Record<string, number> } {
	const ranges = definition?.ranges;
	if (!Array.isArray(ranges) || ranges.length === 0) {
		throw DelightError.badRequest(`Number facet "${field}" needs at least one range.`, {
			code: 'invalid_facet_definition',
		});
	}
	const values: Record<string, number> = {};
	for (const range of ranges) values[`${range.from}-${range.to}`] = 0;
	for (const doc of docs) {
		for (const value of valuesOf(doc, field, is_array)) {
			if (typeof value !== 'number') continue;
			for (const range of ranges) {
				if (
					compareValues(value, range.from) >= 0 &&
					compareValues(value, range.to) <= 0
				) {
					values[`${range.from}-${range.to}`] += 1;
				}
			}
		}
	}
	return { count: ranges.length, values };
}

/** Boolean facet: both buckets are always reported, so `count` is always 2. */
function countBooleanFacet(
	docs: readonly Record<string, unknown>[],
	field: string,
	is_array: boolean,
): { count: number; values: Record<string, number> } {
	let true_count = 0;
	let false_count = 0;
	for (const doc of docs) {
		for (const value of valuesOf(doc, field, is_array)) {
			if (value === true) true_count += 1;
			else if (value === false) false_count += 1;
		}
	}
	return { count: 2, values: { true: true_count, false: false_count } };
}
