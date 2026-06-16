import { describe, expect, it } from 'vitest';
import { normalize, denormalize, type StageGeometry } from './coordinates';

const geo = (over: Partial<StageGeometry> = {}): StageGeometry => ({
	left: 0,
	top: 0,
	scroll_x: 0,
	scroll_y: 0,
	width: 1000,
	height: 800,
	...over,
});

describe('normalize', () => {
	it('maps a client point to [0,1] fractions of the stage', () => {
		expect(normalize(500, 400, geo())).toEqual({ x: 0.5, y: 0.5 });
	});

	it('accounts for the stage offset and scroll', () => {
		const g = geo({ left: 100, top: 50, scroll_x: 200, scroll_y: 100 });
		// content x = 500 - 100 + 200 = 600 → 600/1000 = 0.6
		expect(normalize(500, 400, g)).toEqual({ x: 0.6, y: (400 - 50 + 100) / 800 });
	});

	it('clamps out-of-bounds points into [0,1]', () => {
		expect(normalize(-50, 5000, geo())).toEqual({ x: 0, y: 1 });
	});

	it('returns 0 for a zero-sized stage instead of NaN', () => {
		expect(normalize(10, 10, geo({ width: 0, height: 0 }))).toEqual({ x: 0, y: 0 });
	});
});

describe('normalize <-> denormalize round-trip', () => {
	it('recovers the original client point on the same geometry', () => {
		const g = geo({ left: 30, top: 20, scroll_x: 15, scroll_y: 5 });
		const n = normalize(640, 360, g);
		const back = denormalize(n, g);
		expect(back.x).toBeCloseTo(640, 6);
		expect(back.y).toBeCloseTo(360, 6);
	});

	it('maps the same logical point across differently-sized stages', () => {
		const sender = geo({ width: 1000, height: 500 });
		const receiver = geo({ width: 2000, height: 1000 });
		const n = normalize(250, 250, sender); // { 0.25, 0.5 }
		const onReceiver = denormalize(n, receiver);
		expect(onReceiver).toEqual({ x: 500, y: 500 });
	});

	it('shifts by scroll delta between sender and receiver', () => {
		const sender = geo({ scroll_y: 0 });
		const receiver = geo({ scroll_y: 200 });
		const n = normalize(0, 400, sender); // y fraction 0.5
		const onReceiver = denormalize(n, receiver);
		// same content point, receiver scrolled down 200 → 200px higher on screen
		expect(onReceiver.y).toBeCloseTo(200, 6);
	});
});
