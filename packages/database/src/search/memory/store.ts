/**
 * The in-memory postings store backing the reference engine.
 *
 * It mirrors the *shape* of the two production stores (server DO-SQLite rows,
 * client IDB records) — postings, term dictionary, per-document field lengths,
 * per-field stats, vectors — without any storage access, so the reference
 * pipeline can be read as the specification it is. Clarity is deliberately
 * preferred over speed here: this store is the source of truth for golden
 * vectors, not a production driver.
 */

import { DelightError } from '@delightstack/utilities';
import { compareStrings, type PrimaryKeyType } from '../core/compare';
import { countTokenFrequencies, tokenizeValue } from '../core/tokenizer';
import type { SearchableType } from '../core/types';
import { getFieldValue, type WhereSchema } from '../core/where';
import { normalizeVector } from '../server/vector';

/** Configuration for a memory index. */
export interface MemoryIndexConfig {
	/** Flat map of dot-path → declared type. The closed set of legal paths. */
	schema: WhereSchema;
	/** The document's primary-key field @default 'id' */
	primary_key?: string;
	/** How primary keys compare in tie-breaks @default 'string' */
	primary_key_type?: PrimaryKeyType;
}

/** A document as held by the store. */
export interface StoredDocument {
	/** `String(primary key)` — the postings doc id */
	doc_id: string;
	/** The primary key in its declared type */
	primary_key: string | number;
	/** The indexed document */
	document: Record<string, unknown>;
	/** Token count per present text field */
	lengths: Map<string, number>;
	/** Unit-normalized vectors per present vector field */
	vectors: Map<string, Float32Array>;
}

/** Aggregate statistics for one field. */
export interface FieldStats {
	/** `N(field)` — documents containing the field */
	doc_count: number;
	/** Σ token counts, so `avgLen = total_len / doc_count` */
	total_len: number;
}

/** Whether a declared type participates in full-text term matching. */
export function isTextFieldType(type: SearchableType): boolean {
	return type === 'string' || type === 'string[]';
}

/** Whether a declared type is a vector field. */
export function isVectorFieldType(type: SearchableType): boolean {
	return typeof type === 'string' && type.startsWith('vector[');
}

/** The in-memory reference index. */
export class MemorySearchStore {
	readonly schema: WhereSchema;
	readonly primary_key: string;
	readonly primary_key_type: PrimaryKeyType;
	/** Searchable text fields, ascending — the deterministic accumulation order */
	readonly text_fields: string[];
	/** Vector fields, ascending */
	readonly vector_fields: string[];

	readonly #documents = new Map<string, StoredDocument>();
	/** field → token → doc_id → tf */
	readonly #postings = new Map<string, Map<string, Map<string, number>>>();
	readonly #field_stats = new Map<string, FieldStats>();

	constructor(config: MemoryIndexConfig) {
		this.schema = config.schema;
		this.primary_key = config.primary_key ?? 'id';
		this.primary_key_type = config.primary_key_type ?? 'string';
		this.text_fields = Object.keys(config.schema)
			.filter((field) => isTextFieldType(config.schema[field]))
			.sort(compareStrings);
		this.vector_fields = Object.keys(config.schema)
			.filter((field) => isVectorFieldType(config.schema[field]))
			.sort(compareStrings);
	}

	/** Number of indexed documents. */
	get size(): number {
		return this.#documents.size;
	}

	/**
	 * Index (or re-index) one document.
	 *
	 * Vector values are L2-normalized here — a zero vector is rejected with a
	 * 400, matching the production write path (§4.9).
	 */
	insert(document: Record<string, unknown>): void {
		const primary_key = document[this.primary_key];
		if (typeof primary_key !== 'string' && typeof primary_key !== 'number') {
			throw DelightError.badRequest(
				`Document is missing its primary key "${this.primary_key}".`,
				{ code: 'invalid_document' },
			);
		}
		const doc_id = String(primary_key);
		this.remove(doc_id);

		const lengths = new Map<string, number>();
		for (const field of this.text_fields) {
			const value = getFieldValue(document, field);
			if (value === null || value === undefined) continue;
			const tokens = tokenizeValue(value);
			lengths.set(field, tokens.length);
			const frequencies = countTokenFrequencies(tokens);
			let field_postings = this.#postings.get(field);
			if (!field_postings) {
				field_postings = new Map();
				this.#postings.set(field, field_postings);
			}
			for (const [token, tf] of frequencies) {
				let token_postings = field_postings.get(token);
				if (!token_postings) {
					token_postings = new Map();
					field_postings.set(token, token_postings);
				}
				token_postings.set(doc_id, tf);
			}
			const stats = this.#field_stats.get(field) ?? { doc_count: 0, total_len: 0 };
			stats.doc_count += 1;
			stats.total_len += tokens.length;
			this.#field_stats.set(field, stats);
		}

		const vectors = new Map<string, Float32Array>();
		for (const field of this.vector_fields) {
			const value = getFieldValue(document, field);
			if (value === null || value === undefined) continue;
			if (!Array.isArray(value) && !(value instanceof Float32Array)) {
				throw DelightError.badRequest(
					`Vector field "${field}" must be an array of numbers.`,
					{
						code: 'invalid_vector',
					},
				);
			}
			vectors.set(field, normalizeVector(value as number[]));
		}

		this.#documents.set(doc_id, { doc_id, primary_key, document, lengths, vectors });
	}

	/** Index many documents. */
	insertMany(documents: readonly Record<string, unknown>[]): void {
		for (const document of documents) this.insert(document);
	}

	/** Remove a document and every posting, stat and vector it contributed. */
	remove(id: string | number): boolean {
		const doc_id = String(id);
		const stored = this.#documents.get(doc_id);
		if (!stored) return false;
		for (const [field, length] of stored.lengths) {
			const field_postings = this.#postings.get(field);
			if (field_postings) {
				for (const [token, token_postings] of field_postings) {
					if (token_postings.delete(doc_id) && token_postings.size === 0) {
						field_postings.delete(token);
					}
				}
				if (field_postings.size === 0) this.#postings.delete(field);
			}
			const stats = this.#field_stats.get(field);
			if (stats) {
				stats.doc_count -= 1;
				stats.total_len -= length;
				if (stats.doc_count <= 0) this.#field_stats.delete(field);
				else this.#field_stats.set(field, stats);
			}
		}
		this.#documents.delete(doc_id);
		return true;
	}

	/** Documents in ascending `doc_id` order — the canonical accumulation order. */
	documents(): StoredDocument[] {
		return [...this.#documents.values()].sort((a, b) =>
			compareStrings(a.doc_id, b.doc_id),
		);
	}

	/** One document by its `String(primary key)`. */
	getDocument(doc_id: string): StoredDocument | undefined {
		return this.#documents.get(doc_id);
	}

	/**
	 * Stats for a field, zeroed when the field has no indexed content. Returned
	 * as a copy — callers must never observe later mutations through it.
	 */
	getFieldStats(field: string): FieldStats {
		const stats = this.#field_stats.get(field);
		return stats
			? { doc_count: stats.doc_count, total_len: stats.total_len }
			: {
					doc_count: 0,
					total_len: 0,
				};
	}

	/** The field's term dictionary, ascending by code point. */
	getDictionary(field: string): string[] {
		const field_postings = this.#postings.get(field);
		if (!field_postings) return [];
		return [...field_postings.keys()].sort(compareStrings);
	}

	/** Postings for one `(field, token)` as `doc_id → tf`, ascending by doc id. */
	getPostings(field: string, token: string): [string, number][] {
		const token_postings = this.#postings.get(field)?.get(token);
		if (!token_postings) return [];
		return [...token_postings.entries()].sort((a, b) => compareStrings(a[0], b[0]));
	}

	/** Documents containing the token in the field (`df`). */
	getDocFrequency(field: string, token: string): number {
		return this.#postings.get(field)?.get(token)?.size ?? 0;
	}
}
