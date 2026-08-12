/**
 * TEMPORARY — Orama translation shim.
 *
 * The public query DSL now uses the package's own vocabulary (`fields`,
 * `distinct_on`, `vector.field`, `order[].field`, `contains_all`,
 * `contains_any`, `not_in`).
 * Orama still speaks the old spellings, so the two remaining Orama call sites
 * (`server/db.server.ts`, `client/database.worker.ts`) translate right before
 * calling `search()`.
 *
 * This file is deleted along with those call sites in Phases 3–4 of
 * `plans/database/Native Search Engine Plan.md`.
 */

/** New where-operator spelling → the Orama spelling */
const ORAMA_WHERE_OPERATORS: Record<string, string> = {
	contains_all: 'containsAll',
	contains_any: 'containsAny',
	not_in: 'nin',
};

/** Rewrites the renamed where operators back to Orama's spellings, recursively. */
export function toOramaWhere(where: unknown): unknown {
	if (Array.isArray(where)) return where.map(toOramaWhere);
	if (!where || typeof where !== 'object') return where;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
		out[ORAMA_WHERE_OPERATORS[key] ?? key] = toOramaWhere(value);
	}
	return out;
}

/** The renamed query keys, translated back to what Orama's `search()` expects. */
export function toOramaSearchParams(
	query: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = { ...query };

	if ('distinct_on' in out) {
		if (out.distinct_on !== undefined) out.distinctOn = out.distinct_on;
		delete out.distinct_on;
	}

	if ('fields' in out) {
		if (out.fields !== undefined) out.properties = out.fields;
		delete out.fields;
	}

	if (out.vector && typeof out.vector === 'object') {
		const vector = out.vector as { value?: number[]; field?: string; property?: string };
		out.vector = { value: vector.value, property: vector.field ?? vector.property };
	}

	if (out.where !== undefined) out.where = toOramaWhere(out.where);

	return out;
}
