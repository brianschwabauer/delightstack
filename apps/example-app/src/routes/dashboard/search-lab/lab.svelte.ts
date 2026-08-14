import { DelightError } from '@delightstack/utilities';

/* -------------------------------------------------------------------------- */
/* Result shapes                                                               */
/* -------------------------------------------------------------------------- */

/** One hit as the lab renders it. Documents are sparse unless `sparse: false`. */
export interface LabHit {
	id: string;
	score: number;
	document: Record<string, unknown>;
}

/** Facet counts, keyed by field then by value. */
export type LabFacets = Record<string, { count: number; values: Record<string, number> }>;

export interface LabResult {
	count: number;
	hits: LabHit[];
	elapsed?: { raw: number; formatted: string };
	cursor?: string;
	facets?: LabFacets;
}

/** Everything the runner needs beyond the DSL itself. */
export interface LabRunOptions {
	/** Free text embedded server-side into `vector.value`. */
	embed_text?: string;
	/** Which vector field the embedding is compared against. */
	embed_field?: string;
	/** Inclusive minimum cosine similarity. */
	similarity?: number;
}

/* -------------------------------------------------------------------------- */
/* Runner                                                                      */
/* -------------------------------------------------------------------------- */

/** How long the runner waits for typing to settle before firing a query. */
const DEBOUNCE_MS = 180;

/**
 * Runs one search at a time against `/api/search-lab/query`.
 *
 * Every panel that wants the *full* DSL response — facets, cursors, vector
 * scores — goes through here rather than through the reactive client. The
 * client worker's result shape carries hits and counts only, and embeddings
 * deliberately never reach the browser, so this is the honest surface for
 * exercising the query language. The Routing panel is the exception: it drives
 * `db.watch()` so the client engine gets its turn.
 */
export class LabRunner {
	readonly entity: 'place' | 'organization';

	#result = $state<LabResult | null>(null);
	#echo = $state<Record<string, unknown> | null>(null);
	#error = $state<string | null>(null);
	#loading = $state(false);
	#round_trip_ms = $state(0);

	/** Monotonic sequence so a slow response can never overwrite a fast one. */
	#sequence = 0;
	#timer: ReturnType<typeof setTimeout> | null = null;

	constructor(entity: 'place' | 'organization' = 'place') {
		this.entity = entity;
	}

	/** The last successful result, or `null` before the first one lands. */
	get result(): LabResult | null {
		return this.#result;
	}

	/** The query the server actually ran, with any vector collapsed for display. */
	get echo(): Record<string, unknown> | null {
		return this.#echo;
	}

	/** A friendly message from the last failure, or `null`. */
	get error(): string | null {
		return this.#error;
	}

	/** Whether a query is in flight. Previous results stay on screen. */
	get loading(): boolean {
		return this.#loading;
	}

	/** Wall-clock time for the whole round trip, including the DO hop. */
	get round_trip_ms(): number {
		return this.#round_trip_ms;
	}

	/** Convenience — the engine's own timing for the last search. */
	get elapsed(): string {
		return this.#result?.elapsed?.formatted ?? '—';
	}

	/** Debounced run. Safe to call from an `$effect` on every keystroke. */
	schedule(query: Record<string, unknown>, options: LabRunOptions = {}): void {
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			this.#timer = null;
			void this.run(query, options);
		}, DEBOUNCE_MS);
	}

	/** Run immediately. Resolves once this call's result has been applied. */
	async run(query: Record<string, unknown>, options: LabRunOptions = {}): Promise<void> {
		const sequence = ++this.#sequence;
		this.#loading = true;
		try {
			const response = await fetch('/api/search-lab/query', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ entity: this.entity, query, ...options }),
			});
			const body = (await response.json()) as {
				result?: LabResult;
				echo?: Record<string, unknown>;
				round_trip_ms?: number;
				message?: string;
			};
			if (sequence !== this.#sequence) return;
			if (!response.ok) {
				this.#error = body.message ?? 'The search could not be run.';
				return;
			}
			this.#error = null;
			this.#result = body.result ?? null;
			this.#echo = body.echo ?? null;
			this.#round_trip_ms = body.round_trip_ms ?? 0;
		} catch (error) {
			if (sequence !== this.#sequence) return;
			this.#error = DelightError.from(error).message;
		} finally {
			if (sequence === this.#sequence) this.#loading = false;
		}
	}
}

/* -------------------------------------------------------------------------- */
/* Formatting helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Strip keys whose value is undefined, an empty string, or an empty container. */
export function pruneQuery(query: Record<string, unknown>): Record<string, unknown> {
	const pruned: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(query)) {
		if (value === undefined || value === null || value === '') continue;
		if (Array.isArray(value) && value.length === 0) continue;
		if (
			typeof value === 'object' &&
			!Array.isArray(value) &&
			Object.keys(value as object).length === 0
		) {
			continue;
		}
		pruned[key] = value;
	}
	return pruned;
}

/** Pretty-print a query for the on-screen DSL preview. */
export function formatQuery(query: unknown): string {
	return JSON.stringify(query ?? {}, null, 2);
}

/** Read a possibly-missing string off a sparse search document. */
export function text(document: Record<string, unknown>, key: string): string {
	const value = document[key];
	if (value === undefined || value === null) return '';
	return String(value);
}

/** Read a possibly-missing number off a sparse search document. */
export function num(document: Record<string, unknown>, key: string): number | null {
	const value = document[key];
	return typeof value === 'number' ? value : null;
}

/** Read the nested address off a sparse search document. */
export function address(document: Record<string, unknown>): {
	city: string;
	country: string;
} {
	const value = document.address as { city?: string; country?: string } | undefined;
	return { city: value?.city ?? '', country: value?.country ?? '' };
}

/** Read the geopoint off a sparse search document. */
export function point(
	document: Record<string, unknown>,
): { lat: number; lon: number } | null {
	const value = document.location as { lat?: number; lon?: number } | undefined;
	if (typeof value?.lat !== 'number' || typeof value?.lon !== 'number') return null;
	return { lat: value.lat, lon: value.lon };
}

/* -------------------------------------------------------------------------- */
/* Geo helpers                                                                 */
/* -------------------------------------------------------------------------- */

const EARTH_RADIUS_M = 6371008.8;

/** Metres per unit, matching the engine's `GeoDistanceUnit`. */
export const DISTANCE_UNITS = {
	cm: 0.01,
	m: 1,
	km: 1000,
	ft: 0.3048,
	yd: 0.9144,
	mi: 1609.344,
} as const;

export type DistanceUnit = keyof typeof DISTANCE_UNITS;

/** Great-circle distance in metres. Display only — the engine does its own. */
export function haversine(
	a: { lat: number; lon: number },
	b: { lat: number; lon: number },
): number {
	const to_rad = Math.PI / 180;
	const lat_1 = a.lat * to_rad;
	const lat_2 = b.lat * to_rad;
	const delta_lat = (b.lat - a.lat) * to_rad;
	const delta_lon = (b.lon - a.lon) * to_rad;
	const h =
		Math.sin(delta_lat / 2) ** 2 +
		Math.cos(lat_1) * Math.cos(lat_2) * Math.sin(delta_lon / 2) ** 2;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Format a metre distance in the unit the user picked. */
export function formatDistance(metres: number, unit: DistanceUnit): string {
	const value = metres / DISTANCE_UNITS[unit];
	const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
	return `${value.toFixed(decimals)} ${unit}`;
}
