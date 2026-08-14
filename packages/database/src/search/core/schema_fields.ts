/**
 * Field-type predicates and field-list resolution, shared by all three drivers.
 *
 * The searched/vector field lists are derived from the declared schema once,
 * ascending by the core comparator — that order IS the deterministic BM25
 * accumulation order (§3), so it must come from exactly one place.
 */

import { compareStrings } from './compare';
import type { SearchableType } from './types';
import type { WhereSchema } from './where';

/** Whether a declared type participates in full-text term matching. */
export function isTextFieldType(type: SearchableType): boolean {
	return type === 'string' || type === 'string[]';
}

/** Whether a declared type is a vector field. */
export function isVectorFieldType(type: SearchableType): boolean {
	return typeof type === 'string' && type.startsWith('vector[');
}

/** The schema's text fields, ascending by the core comparator. */
export function resolveTextFields(schema: WhereSchema): string[] {
	return Object.keys(schema)
		.filter((field) => isTextFieldType(schema[field]))
		.sort(compareStrings);
}

/** The schema's vector fields, ascending by the core comparator. */
export function resolveVectorFields(schema: WhereSchema): string[] {
	return Object.keys(schema)
		.filter((field) => isVectorFieldType(schema[field]))
		.sort(compareStrings);
}
