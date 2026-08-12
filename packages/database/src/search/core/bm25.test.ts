import { describe, expect, it } from 'vitest';
import { BM25_DEFAULTS, bm25Score, idf, ln } from './bm25';

describe('ln (deterministic fdlibm port)', () => {
	it('matches Math.log across a wide value sweep', () => {
		// The port must never be replaced by Math.log (engine-varying), but it must
		// agree with it: a 1-ulp idf difference reorders near-tied documents.
		let worst_relative_error = 0;
		for (let exponent = -300; exponent <= 300; exponent += 1) {
			for (const mantissa of [1, 1.25, 1.5, 1.7777, 2, 3.3, 5, 7.9, 9.999]) {
				const value = mantissa * 10 ** exponent;
				if (!Number.isFinite(value) || value === 0) continue;
				const actual = ln(value);
				const expected = Math.log(value);
				const error =
					actual === expected ? 0 : Math.abs(actual - expected) / Math.abs(expected || 1);
				if (error > worst_relative_error) worst_relative_error = error;
			}
		}
		expect(worst_relative_error).toBeLessThan(1e-15);
	});

	it('matches Math.log on the values BM25 actually feeds it', () => {
		for (let n = 1; n <= 200; n++) {
			for (let df = 1; df <= n; df++) {
				expect(ln(1 + (n - df + 0.5) / (df + 0.5))).toBe(
					Math.log(1 + (n - df + 0.5) / (df + 0.5)),
				);
			}
		}
	});

	it('reproduces exact known logarithms', () => {
		expect(ln(1)).toBe(0);
		expect(ln(Math.E)).toBe(1);
		expect(ln(2)).toBe(0.6931471805599453);
		expect(ln(10)).toBe(2.302585092994046);
		expect(ln(1.5)).toBe(0.4054651081081644);
	});

	it('handles subnormals, zero, negatives and infinities like Math.log', () => {
		expect(ln(5e-324)).toBe(Math.log(5e-324));
		expect(ln(1e-310)).toBe(Math.log(1e-310));
		expect(ln(0)).toBe(-Infinity);
		expect(ln(-0)).toBe(-Infinity);
		expect(ln(-1)).toBeNaN();
		expect(ln(Infinity)).toBe(Infinity);
		expect(ln(Number.NaN)).toBeNaN();
	});

	it('handles values just either side of 1, where the port switches branches', () => {
		for (const value of [
			1 - 1e-9,
			1 + 1e-9,
			1 - 1e-16,
			1 + 1e-16,
			0.9999999,
			1.0000001,
		]) {
			expect(ln(value)).toBe(Math.log(value));
		}
	});
});

describe('idf', () => {
	it('uses the per-FIELD document count, not the global one', () => {
		expect(idf(10, 1)).toBe(1.992430164690206);
		expect(idf(100, 50)).toBe(0.6931471805599453);
	});

	it('stays positive when every document contains the token', () => {
		expect(idf(1, 1)).toBeCloseTo(0.28768207245178085, 15);
	});

	it('falls as the token becomes more common', () => {
		expect(idf(100, 1)).toBeGreaterThan(idf(100, 10));
		expect(idf(100, 10)).toBeGreaterThan(idf(100, 90));
	});
});

describe('bm25Score', () => {
	it('uses BM25+ with d OUTSIDE the tf fraction (deliberate Orama deviation)', () => {
		const input = {
			tf: 2,
			field_length: 6,
			average_field_length: 4,
			field_doc_count: 20,
			doc_frequency: 3,
		};
		const { k1, b, d } = BM25_DEFAULTS;
		const expected =
			idf(input.field_doc_count, input.doc_frequency) *
			((input.tf * (k1 + 1)) /
				(input.tf +
					k1 * (1 - b + (b * input.field_length) / input.average_field_length)) +
				d);
		expect(bm25Score(input)).toBe(expected);

		// Orama's form divides d by the length normalization too — a different function.
		const orama_form =
			(idf(input.field_doc_count, input.doc_frequency) * (d + input.tf * (k1 + 1))) /
			(input.tf + k1 * (1 - b + (b * input.field_length) / input.average_field_length));
		expect(bm25Score(input)).not.toBe(orama_form);
	});

	it('reproduces frozen regression values', () => {
		expect(
			bm25Score({
				tf: 1,
				field_length: 4,
				average_field_length: 4,
				field_doc_count: 10,
				doc_frequency: 1,
			}),
		).toBe(2.988645247035309);
		expect(
			bm25Score({
				tf: 3,
				field_length: 10,
				average_field_length: 5,
				field_doc_count: 100,
				doc_frequency: 20,
			}),
		).toBe(2.8610715727209035);
		expect(
			bm25Score({
				tf: 1,
				field_length: 1,
				average_field_length: 2.5,
				field_doc_count: 3,
				doc_frequency: 3,
			}),
		).toBe(0.243735011838737);
	});

	it('rewards higher term frequency', () => {
		const base = {
			field_length: 10,
			average_field_length: 10,
			field_doc_count: 50,
			doc_frequency: 5,
		};
		expect(bm25Score({ ...base, tf: 3 })).toBeGreaterThan(bm25Score({ ...base, tf: 1 }));
	});

	it('penalizes longer fields (real tf, unlike Orama de-duplicated tokens)', () => {
		const base = {
			tf: 1,
			average_field_length: 10,
			field_doc_count: 50,
			doc_frequency: 5,
		};
		expect(bm25Score({ ...base, field_length: 5 })).toBeGreaterThan(
			bm25Score({ ...base, field_length: 40 }),
		);
	});

	it('never calls Math.log', () => {
		const original = Math.log;
		Math.log = () => {
			throw new Error('Math.log is not deterministic across JS engines');
		};
		try {
			expect(() =>
				bm25Score({
					tf: 1,
					field_length: 3,
					average_field_length: 3,
					field_doc_count: 5,
					doc_frequency: 2,
				}),
			).not.toThrow();
		} finally {
			Math.log = original;
		}
	});

	it('degrades gracefully when the field has no indexed content', () => {
		expect(
			bm25Score({
				tf: 0,
				field_length: 0,
				average_field_length: 0,
				field_doc_count: 0,
				doc_frequency: 0,
			}),
		).toBeCloseTo(idf(0, 0) * (0 + BM25_DEFAULTS.d), 15);
	});
});
