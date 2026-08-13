/**
 * Geo predicates: haversine radius + planar point-in-polygon.
 * See `plans/database/Native Search Engine Plan.md` §5.1 and
 * `plans/database/orama-verification-report.md` §8–§10.
 *
 * Everything here matches Orama 3.1.18 exactly (earth radius, unit multipliers,
 * boundary inclusivity, PNPOLY's half-open edges) — these were verified
 * empirically, and a different earth-radius constant alone would shift every
 * boundary by ~0.1%.
 *
 * Determinism caveat (radius only): haversine needs `sin`/`cos`/`atan2`, which
 * ECMAScript allows to vary by engine — unlike BM25's `ln` (which is ported
 * deterministically, since scores *order* results and near-ties are common), a
 * geo predicate is a boolean filter, so a cross-engine flip needs a document
 * within ~1 ulp of the radius boundary (sub-nanometer). Accepted and
 * documented; not worth ~300 lines of deterministic trig. Polygon carries no
 * such caveat — ray casting is comparisons, one multiply and one divide.
 *
 * Antimeridian- and pole-spanning shapes are out of scope: the planar math
 * spans the long way round, exactly as Orama's does.
 */

import { DelightError } from '@delightstack/utilities';
import type { GeoDistanceUnit, GeoOperation, GeoPoint } from './types';

/** Spherical earth radius in metres — Orama's `EARTH_RADIUS`, verified. */
export const EARTH_RADIUS_METERS = 6371e3;

/** Exact metre multipliers per accepted distance unit (Orama's table). */
export const DISTANCE_UNIT_TO_METERS: Record<GeoDistanceUnit, number> = {
	cm: 0.01,
	m: 1,
	km: 1000,
	ft: 0.3048,
	yd: 0.9144,
	mi: 1609.344,
};

/** Convert a distance to metres, defaulting to metres. Unknown unit → 400. */
export function convertDistanceToMeters(value: number, unit: string = 'm'): number {
	const multiplier = DISTANCE_UNIT_TO_METERS[unit as GeoDistanceUnit];
	if (multiplier === undefined) {
		throw DelightError.badRequest(
			`Invalid distance unit "${unit}". Valid units are: cm, m, km, mi, yd, ft.`,
			{ code: 'invalid_distance_unit' },
		);
	}
	return value * multiplier;
}

/** Degrees → radians, as one multiplication by a precomputed constant. */
const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * Great-circle distance in metres between two coordinates.
 *
 * Spherical haversine with `c = 2 * atan2(sqrt(a), sqrt(1 - a))`, ported
 * operand-for-operand from Orama's `BKDTree.haversineDistance`. Keep the
 * expression tree identical: floating-point multiplication is not
 * order-independent, and reordering the `cos * cos * sin * sin` product shifts
 * the result by ~1e-13 relative — enough to move a document across a radius
 * boundary computed with the other spelling.
 */
export function haversineDistance(from: GeoPoint, to: GeoPoint): number {
	const lat_from = from.lat * DEGREES_TO_RADIANS;
	const lat_to = to.lat * DEGREES_TO_RADIANS;
	const delta_lat = (to.lat - from.lat) * DEGREES_TO_RADIANS;
	const delta_lon = (to.lon - from.lon) * DEGREES_TO_RADIANS;
	const a =
		Math.sin(delta_lat / 2) * Math.sin(delta_lat / 2) +
		Math.cos(lat_from) *
			Math.cos(lat_to) *
			Math.sin(delta_lon / 2) *
			Math.sin(delta_lon / 2);
	// Near-antipodal pairs can accumulate to `a` a hair above 1, making
	// `sqrt(1 - a)` NaN and the distance NaN — which fails BOTH `inside: true`
	// and `inside: false`. Clamp to 1; for every `a <= 1` the clamp returns `a`
	// bit-identically, so in-range distances are untouched.
	const a_clamped = Math.min(1, a);
	const c = 2 * Math.atan2(Math.sqrt(a_clamped), Math.sqrt(1 - a_clamped));
	return EARTH_RADIUS_METERS * c;
}

/**
 * Planar even-odd ray casting (PNPOLY) over raw `lon`/`lat` as `x`/`y`.
 *
 * Ported verbatim from Orama, including the implicit ring closure (callers need
 * not repeat the first vertex) and the resulting half-open boundary: points on
 * the bottom and left edges and on the bottom-left vertex are INSIDE; points on
 * the top and right edges and on the top-right vertex are OUTSIDE.
 *
 * The operand order of `((xj - xi) * (y - yi)) / (yj - yi) + xi` is deliberate:
 * it is pure IEEE-754 arithmetic and therefore bit-reproducible across engines
 * only while the expression tree matches.
 */
export function isPointInPolygon(point: GeoPoint, polygon: readonly GeoPoint[]): boolean {
	const x = point.lon;
	const y = point.lat;
	let is_inside = false;
	const length = polygon.length;
	for (let i = 0, j = length - 1; i < length; j = i++) {
		const xi = polygon[i].lon;
		const yi = polygon[i].lat;
		const xj = polygon[j].lon;
		const yj = polygon[j].lat;
		const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
		if (intersect) is_inside = !is_inside;
	}
	return is_inside;
}

/** Whether a value is a usable geopoint. */
export function isGeoPoint(value: unknown): value is GeoPoint {
	if (!value || typeof value !== 'object') return false;
	const point = value as { lat?: unknown; lon?: unknown };
	return (
		typeof point.lat === 'number' &&
		typeof point.lon === 'number' &&
		Number.isFinite(point.lat) &&
		Number.isFinite(point.lon)
	);
}

/**
 * Validate a raw `radius`/`polygon` operand shape at normalize time.
 *
 * Called once per query from `where.ts`'s operator validation — NOT per
 * document, where the `isGeoPoint(value)` bail in {@link evaluateGeoOperation}
 * would let a malformed operand over an empty or absent-field corpus return an
 * empty result instead of throwing.
 *
 * @throws DelightError 400 on a malformed operand or unknown distance unit.
 */
export function validateGeoOperand(
	operator: 'radius' | 'polygon',
	operand: unknown,
): void {
	const shape = (
		operand && typeof operand === 'object' && !Array.isArray(operand) ? operand : {}
	) as {
		coordinates?: unknown;
		value?: unknown;
		unit?: unknown;
	};
	if (operator === 'radius') {
		if (!isGeoPoint(shape.coordinates) || typeof shape.value !== 'number') {
			throw DelightError.badRequest(
				'A radius filter needs `coordinates` and a numeric `value`.',
				{ code: 'invalid_geo_filter' },
			);
		}
		// Throws `invalid_distance_unit` on an unknown unit.
		convertDistanceToMeters(shape.value, (shape.unit as string | undefined) ?? 'm');
		return;
	}
	if (!Array.isArray(shape.coordinates) || !shape.coordinates.every(isGeoPoint)) {
		throw DelightError.badRequest('A polygon filter needs `{lat, lon}` coordinates.', {
			code: 'invalid_geo_filter',
		});
	}
}

/**
 * Evaluate a `{radius}` or `{polygon}` operation against a field value.
 *
 * A missing, null or malformed geopoint fails BOTH `inside: true` and
 * `inside: false` — the §5 null rule applies to geo like every other leaf
 * predicate (and this is Orama's behavior too: unindexed documents are absent
 * from the BKD tree and therefore from both the result and its complement).
 * `not: { field: { radius } }` still admits them, because `not` complements
 * over the corpus.
 *
 * `highPrecision` is accepted and ignored — we are always haversine.
 */
export function evaluateGeoOperation(value: unknown, operation: GeoOperation): boolean {
	if (!isGeoPoint(value)) return false;
	if ('radius' in operation) {
		const { coordinates, value: distance, unit, inside } = operation.radius;
		if (!isGeoPoint(coordinates) || typeof distance !== 'number') {
			throw DelightError.badRequest(
				'A radius filter needs `coordinates` and a numeric `value`.',
				{
					code: 'invalid_geo_filter',
				},
			);
		}
		const radius_meters = convertDistanceToMeters(distance, unit ?? 'm');
		const is_within = haversineDistance(coordinates, value) <= radius_meters;
		return inside === false ? !is_within : is_within;
	}
	const { coordinates, inside } = operation.polygon;
	if (!Array.isArray(coordinates) || !coordinates.every(isGeoPoint)) {
		throw DelightError.badRequest('A polygon filter needs `{lat, lon}` coordinates.', {
			code: 'invalid_geo_filter',
		});
	}
	// A degenerate ring (fewer than three vertices) encloses nothing: the PNPOLY
	// loop below returns false for every point, which is the frozen answer — and
	// Orama 3.1.16 agrees, returning the empty set rather than throwing. A ring
	// is a shape, not a query-shape error, so it must not become a 400.
	const is_within = isPointInPolygon(value, coordinates);
	return inside === false ? !is_within : is_within;
}
