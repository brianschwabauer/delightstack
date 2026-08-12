import { DelightError } from '@delightstack/utilities';
import { describe, expect, it } from 'vitest';
import {
	convertDistanceToMeters,
	DISTANCE_UNIT_TO_METERS,
	EARTH_RADIUS_METERS,
	evaluateGeoOperation,
	haversineDistance,
	isGeoPoint,
	isPointInPolygon,
} from './geo';
import type { GeoPoint } from './types';

const CENTER: GeoPoint = { lat: 0, lon: 0 };
/**
 * 0.01° of latitude north of the origin. The distance below is what Orama's own
 * `BKDTree.haversineDistance` expression tree produces (the verification
 * report's 1111.9492664453662 came from the probe script's independently
 * written haversine, which groups the `cos·cos·sin·sin` product differently and
 * lands ~2 ulp away).
 */
const NEAR: GeoPoint = { lat: 0.01, lon: 0 };
const BOUNDARY_METERS = 1111.9492664455875;

/** The box the verification report probed: corners (0,0) and (10,10). */
const BOX: GeoPoint[] = [
	{ lat: 0, lon: 0 },
	{ lat: 0, lon: 10 },
	{ lat: 10, lon: 10 },
	{ lat: 10, lon: 0 },
];

describe('convertDistanceToMeters', () => {
	it('uses Orama’s exact multipliers', () => {
		expect(DISTANCE_UNIT_TO_METERS).toEqual({
			cm: 0.01,
			m: 1,
			km: 1000,
			ft: 0.3048,
			yd: 0.9144,
			mi: 1609.344,
		});
		expect(convertDistanceToMeters(2, 'km')).toBe(2000);
		expect(convertDistanceToMeters(1, 'mi')).toBe(1609.344);
	});

	it('defaults to metres', () => {
		expect(convertDistanceToMeters(5)).toBe(5);
	});

	it('throws a 400 on an unknown unit', () => {
		expect(() => convertDistanceToMeters(1, 'nm')).toThrow(DelightError);
		try {
			convertDistanceToMeters(1, 'nm');
		} catch (error) {
			expect((error as DelightError).status).toBe(400);
		}
	});
});

describe('haversineDistance', () => {
	it('uses the 6371e3 m earth radius', () => {
		expect(EARTH_RADIUS_METERS).toBe(6371e3);
	});

	it('reproduces the verified boundary distance', () => {
		expect(haversineDistance(CENTER, NEAR)).toBe(BOUNDARY_METERS);
	});

	it('is zero for identical points and symmetric otherwise', () => {
		expect(haversineDistance(CENTER, CENTER)).toBe(0);
		expect(haversineDistance(CENTER, NEAR)).toBeCloseTo(
			haversineDistance(NEAR, CENTER),
			9,
		);
	});

	it('measures antipodal points as half the circumference', () => {
		expect(haversineDistance({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(
			Math.PI * EARTH_RADIUS_METERS,
			6,
		);
	});
});

describe('radius operator', () => {
	it('includes the boundary for inside: true and excludes it for inside: false', () => {
		const operation = { radius: { coordinates: CENTER, value: BOUNDARY_METERS } };
		expect(evaluateGeoOperation(NEAR, operation)).toBe(true);
		expect(
			evaluateGeoOperation(NEAR, {
				radius: { coordinates: CENTER, value: BOUNDARY_METERS, inside: false },
			}),
		).toBe(false);
	});

	it('is an exact complement for present points', () => {
		const far: GeoPoint = { lat: 1, lon: 1 };
		expect(
			evaluateGeoOperation(far, { radius: { coordinates: CENTER, value: 2000 } }),
		).toBe(false);
		expect(
			evaluateGeoOperation(far, {
				radius: { coordinates: CENTER, value: 2000, inside: false },
			}),
		).toBe(true);
	});

	it('honours the unit multiplier', () => {
		expect(
			evaluateGeoOperation(NEAR, {
				radius: { coordinates: CENTER, value: 2, unit: 'km' },
			}),
		).toBe(true);
		expect(
			evaluateGeoOperation(NEAR, {
				radius: { coordinates: CENTER, value: 1, unit: 'cm' },
			}),
		).toBe(false);
	});

	it('accepts and ignores highPrecision', () => {
		const inside = evaluateGeoOperation(NEAR, {
			radius: { coordinates: CENTER, value: 2000, highPrecision: true },
		});
		expect(inside).toBe(true);
	});

	it('throws a 400 on a malformed operand', () => {
		expect(() =>
			evaluateGeoOperation(NEAR, {
				radius: { coordinates: CENTER, value: 'far' as unknown as number },
			}),
		).toThrow(DelightError);
	});
});

describe('isPointInPolygon (PNPOLY, half-open)', () => {
	it('accepts a clearly interior point', () => {
		expect(isPointInPolygon({ lat: 5, lon: 5 }, BOX)).toBe(true);
	});

	it('rejects a clearly exterior point', () => {
		expect(isPointInPolygon({ lat: 50, lon: 50 }, BOX)).toBe(false);
	});

	it('treats the bottom and left edges and the bottom-left vertex as INSIDE', () => {
		expect(isPointInPolygon({ lat: 0, lon: 5 }, BOX)).toBe(true); // bottom edge
		expect(isPointInPolygon({ lat: 5, lon: 0 }, BOX)).toBe(true); // left edge
		expect(isPointInPolygon({ lat: 0, lon: 0 }, BOX)).toBe(true); // bottom-left vertex
	});

	it('treats the top and right edges and the top-right vertex as OUTSIDE', () => {
		expect(isPointInPolygon({ lat: 10, lon: 5 }, BOX)).toBe(false); // top edge
		expect(isPointInPolygon({ lat: 5, lon: 10 }, BOX)).toBe(false); // right edge
		expect(isPointInPolygon({ lat: 10, lon: 10 }, BOX)).toBe(false); // top-right vertex
	});

	it('closes the ring implicitly (no repeated first vertex needed)', () => {
		const closed = [...BOX, { lat: 0, lon: 0 }];
		expect(isPointInPolygon({ lat: 5, lon: 5 }, closed)).toBe(true);
		expect(isPointInPolygon({ lat: 50, lon: 50 }, closed)).toBe(false);
	});

	it('handles a concave polygon', () => {
		const arrow: GeoPoint[] = [
			{ lat: 0, lon: 0 },
			{ lat: 0, lon: 10 },
			{ lat: 5, lon: 5 },
			{ lat: 10, lon: 10 },
			{ lat: 10, lon: 0 },
		];
		expect(isPointInPolygon({ lat: 5, lon: 2 }, arrow)).toBe(true);
		expect(isPointInPolygon({ lat: 5, lon: 8 }, arrow)).toBe(false);
	});

	it('spans the LONG way across the antimeridian (documented, unsupported)', () => {
		const spanning: GeoPoint[] = [
			{ lat: -1, lon: 179 },
			{ lat: 1, lon: 179 },
			{ lat: 1, lon: -179 },
			{ lat: -1, lon: -179 },
		];
		expect(isPointInPolygon({ lat: 0, lon: 0 }, spanning)).toBe(true);
		expect(isPointInPolygon({ lat: 0, lon: 179.5 }, spanning)).toBe(false);
	});
});

describe('polygon operator', () => {
	it('complements exactly with inside: false', () => {
		const point = { lat: 5, lon: 5 };
		expect(evaluateGeoOperation(point, { polygon: { coordinates: BOX } })).toBe(true);
		expect(
			evaluateGeoOperation(point, { polygon: { coordinates: BOX, inside: false } }),
		).toBe(false);
	});

	it('matches nothing for a degenerate ring instead of throwing', () => {
		// A ring with fewer than three vertices encloses nothing. PNPOLY returns
		// false for every point, which is the frozen answer (Orama agrees) — a
		// degenerate shape is not a query-shape error.
		for (const vertices of [[], BOX.slice(0, 1), BOX.slice(0, 2)]) {
			expect(
				evaluateGeoOperation({ lat: 1, lon: 1 }, { polygon: { coordinates: vertices } }),
			).toBe(false);
		}
	});

	it('still throws a 400 when a vertex is not a {lat, lon} pair', () => {
		expect(() =>
			evaluateGeoOperation(
				{ lat: 1, lon: 1 },
				{ polygon: { coordinates: [...BOX.slice(0, 2), { lat: 1 }] as never } },
			),
		).toThrow(DelightError);
	});
});

describe('missing geopoints', () => {
	it('fails BOTH inside: true and inside: false', () => {
		for (const value of [
			null,
			undefined,
			{},
			{ lat: 1 },
			'nope',
			{ lat: 1, lon: Number.NaN },
		]) {
			expect(
				evaluateGeoOperation(value, { radius: { coordinates: CENTER, value: 1e9 } }),
			).toBe(false);
			expect(
				evaluateGeoOperation(value, {
					radius: { coordinates: CENTER, value: 1e9, inside: false },
				}),
			).toBe(false);
			expect(evaluateGeoOperation(value, { polygon: { coordinates: BOX } })).toBe(false);
			expect(
				evaluateGeoOperation(value, { polygon: { coordinates: BOX, inside: false } }),
			).toBe(false);
		}
	});
});

describe('isGeoPoint', () => {
	it('requires finite numeric lat and lon', () => {
		expect(isGeoPoint({ lat: 0, lon: 0 })).toBe(true);
		expect(isGeoPoint({ lat: '0', lon: 0 })).toBe(false);
		expect(isGeoPoint({ lat: Infinity, lon: 0 })).toBe(false);
		expect(isGeoPoint(null)).toBe(false);
	});
});
