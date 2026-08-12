/**
 * Which distinct query tokens each document matched — the input to `threshold`
 * (plan §4.5).
 *
 * The obvious shape is `Map<doc_id, Set<token>>`, and it is the wrong one: a
 * head-term query over 100k documents matches tens of thousands of them, so
 * that shape allocates a `Set` per matched document and hands the garbage
 * collector the whole result set. Nothing ever reads *which* tokens a document
 * matched — only how many distinct ones — and a query token is identified by
 * its index in the (already de-duplicated, already sorted) token list, so up to
 * 32 tokens ride in a single number.
 *
 * Past 32 tokens the mask overflows and a `Set` of indices takes over. That is
 * a query pasting a paragraph into the search box; correctness matters there
 * and the allocation does not.
 *
 * This holds no order and promises none: every caller turns it into a set or
 * re-sorts with a total comparator.
 */

/** Distinct-token hits per document, accumulated during BM25 scoring. */
export class TokenHits {
	/** doc id → bitmask of matched token indices (the ≤32-token representation). */
	readonly #masks = new Map<string, number>();
	/** doc id → matched token indices, used only past 32 query tokens. */
	readonly #sets: Map<string, Set<number>> | undefined;

	/** @param token_count Number of distinct query tokens. */
	constructor(token_count: number) {
		this.#sets = token_count > 32 ? new Map() : undefined;
	}

	/** Record that `doc_id` matched the query token at `token_index`. */
	add(doc_id: string, token_index: number): void {
		const sets = this.#sets;
		if (sets === undefined) {
			this.#masks.set(doc_id, (this.#masks.get(doc_id) ?? 0) | (1 << token_index));
			return;
		}
		let indices = sets.get(doc_id);
		if (indices === undefined) {
			indices = new Set();
			sets.set(doc_id, indices);
		}
		indices.add(token_index);
	}

	/** How many distinct query tokens `doc_id` matched. */
	size(doc_id: string): number {
		const sets = this.#sets;
		if (sets !== undefined) return sets.get(doc_id)?.size ?? 0;
		let word = this.#masks.get(doc_id) ?? 0;
		// Population count (Hamming weight) of a 32-bit word.
		word = word - ((word >>> 1) & 0x55555555);
		word = (word & 0x33333333) + ((word >>> 2) & 0x33333333);
		word = (word + (word >>> 4)) & 0x0f0f0f0f;
		return (word * 0x01010101) >>> 24;
	}

	/** Every document that matched at least one query token, in no order. */
	ids(): string[] {
		return [...(this.#sets ?? this.#masks).keys()];
	}
}
