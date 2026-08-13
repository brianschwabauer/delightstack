import { DelightError } from '@delightstack/utilities';
import { embed } from '$lib/search-lab/embedding';
import type { RequestHandler } from './$types';

/** The tables the lab is allowed to query. */
const ENTITIES = ['place', 'organization'] as const;
type LabEntity = (typeof ENTITIES)[number];

interface QueryBody {
	entity?: string;
	/** The raw search DSL, passed through to `db.list` untouched. */
	query?: Record<string, unknown>;
	/**
	 * Free text to embed server-side. Vectors never reach the browser, so the
	 * lab sends the sentence and the server turns it into the query vector with
	 * the same function that produced the stored embeddings.
	 */
	embed_text?: string;
	/** Which vector field to compare against. */
	embed_field?: string;
	/** Inclusive minimum cosine similarity. The engine defaults this to 0.8. */
	similarity?: number;
}

function isLabEntity(value: unknown): value is LabEntity {
	return typeof value === 'string' && (ENTITIES as readonly string[]).includes(value);
}

/**
 * Run one search against the durable object and hand back the *whole* result —
 * hits, count, cursor, elapsed, and facet counts.
 *
 * The lab talks to this instead of `/api/place` so that facets and vector
 * queries survive the round trip: the client worker's result shape carries hits
 * and counts only, and embeddings are deliberately server-side.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		if (!locals.session) throw DelightError.unauthorized('Sign in to use the Search Lab');
		const db = locals.db;
		if (!db) throw DelightError.badRequest('No organization selected');

		const body = (await request.json()) as QueryBody;
		if (!isLabEntity(body.entity)) {
			throw DelightError.badRequest(`Unknown entity: ${String(body.entity)}`);
		}

		const query: Record<string, unknown> = { ...body.query };

		if (body.embed_text && body.embed_text.trim()) {
			query.vector = {
				value: embed(body.embed_text),
				field: body.embed_field ?? 'embedding',
				...(typeof body.similarity === 'number' ? { similarity: body.similarity } : {}),
			};
		}

		const started = Date.now();
		const result = await db.list(body.entity, query);
		const round_trip_ms = Date.now() - started;

		// Echo the query back with the vector collapsed to its shape — the lab
		// renders this so the DSL that actually ran is always on screen, and a
		// 64-float array would drown everything else out.
		const echo: Record<string, unknown> = { ...query };
		const vector = query.vector as { value?: number[]; field?: string } | undefined;
		if (vector?.value) {
			echo.vector = {
				...vector,
				value: `[${vector.value.length} dims: ${vector.value
					.slice(0, 3)
					.map((n) => n.toFixed(3))
					.join(', ')}, …]`,
			};
		}

		return Response.json({ result, echo, round_trip_ms });
	} catch (error) {
		return DelightError.from(error).toResponse();
	}
};
