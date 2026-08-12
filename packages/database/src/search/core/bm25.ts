/**
 * BM25+ scoring math.
 * See `plans/database/Native Search Engine Plan.md` §4.4 and
 * `plans/database/orama-verification-report.md` finding B.
 *
 * ```
 * score = idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * len / avgLen)) + d)
 * idf   = ln(1 + (N - df + 0.5) / (df + 0.5))
 * ```
 *
 * Three deliberate deviations from Orama 3.1.18, all verified against the
 * installed package:
 * - Orama computes `(idf * (d + tf * (k + 1))) / (tf + k * (...))` — the `d`
 *   lower bound sits INSIDE the fraction and is therefore length-normalized
 *   away. That is not BM25+. We add `d` outside the fraction (true BM25+).
 * - Orama's `N` is the GLOBAL document count; ours is the number of documents
 *   containing that field.
 * - Orama's `avgFieldLength` is an incremental running average divided by the
 *   global document count, which is simply wrong for sparsely populated fields;
 *   ours is the true per-field mean.
 *
 * **`Math.log` is never called here.** BM25's `ln` is the scoring pipeline's
 * only transcendental, and ECMAScript permits implementation-varying results:
 * the client driver runs under JSC and SpiderMonkey while the server runs under
 * V8, and a 1-ulp `idf` difference can reorder near-tied documents. `ln` below
 * is a port of fdlibm's `__ieee754_log`, which is pure IEEE-754 arithmetic and
 * therefore bit-identical on every engine.
 */

/** BM25 tuning parameters. */
export interface Bm25Params {
	/** Term-frequency saturation */
	k1: number;
	/** Length-normalization strength */
	b: number;
	/** BM25+ lower bound, added outside the tf fraction */
	d: number;
}

/** Orama's defaults, kept so ranking stays familiar. */
export const BM25_DEFAULTS: Bm25Params = { k1: 1.2, b: 0.75, d: 0.5 };

/* -------------------------------------------------------------------------- */
/* Deterministic natural logarithm (fdlibm __ieee754_log)                      */
/* -------------------------------------------------------------------------- */

const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const TWO54 = 1.8014398509481984e16;
const LG1 = 6.66666666666673513e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;

const WORD_BUFFER = new ArrayBuffer(8);
const WORD_F64 = new Float64Array(WORD_BUFFER);
const WORD_I32 = new Int32Array(WORD_BUFFER);
const WORD_U32 = new Uint32Array(WORD_BUFFER);
WORD_F64[0] = 1;
/** Index of the high word of a double in the typed-array views on this engine. */
const HI = WORD_I32[1] === 0x3ff00000 ? 1 : 0;
/** Index of the low word of a double. */
const LO = 1 - HI;

/**
 * Natural logarithm, deterministic across JS engines.
 *
 * A direct port of fdlibm's `__ieee754_log` (Sun Microsystems, 1993): argument
 * reduction to `x = 2^k * (1 + f)` followed by a degree-14 minimax polynomial
 * in `s = f / (2 + f)`. Every operation is `+ − × ÷` on doubles, which
 * ECMAScript specifies exactly, so the result is bit-identical on V8, JSC and
 * SpiderMonkey. **Do not replace with `Math.log`** — see the module docblock.
 */
export function ln(value: number): number {
	let x = value;
	WORD_F64[0] = x;
	let hx = WORD_I32[HI];
	const lx = WORD_I32[LO];
	let k = 0;

	if (hx < 0x00100000) {
		// x < 2**-1022: zero, negative, or subnormal
		if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
		if (hx < 0) return NaN;
		k -= 54;
		x *= TWO54;
		WORD_F64[0] = x;
		hx = WORD_I32[HI];
	}
	if (hx >= 0x7ff00000) return x + x; // +Infinity or NaN

	k += (hx >> 20) - 1023;
	hx &= 0x000fffff;
	const i = (hx + 0x95f64) & 0x100000;
	// Normalize x or x/2 into [sqrt(2)/2, sqrt(2)) by rewriting only the exponent.
	WORD_U32[HI] = (hx | (i ^ 0x3ff00000)) >>> 0;
	x = WORD_F64[0];
	k += i >> 20;

	const f = x - 1;
	const dk = k;
	if ((0x000fffff & (2 + hx)) < 3) {
		// |f| < 2**-20
		if (f === 0) {
			if (k === 0) return 0;
			return dk * LN2_HI + dk * LN2_LO;
		}
		// fdlibm spells this 0.33333333333333333; that literal and this one round
		// to the same double, and this one does not trip the precision lint.
		const r = f * f * (0.5 - 0.3333333333333333 * f);
		if (k === 0) return f - r;
		return dk * LN2_HI - (r - dk * LN2_LO - f);
	}

	const s = f / (2 + f);
	const z = s * s;
	const w = z * z;
	const t1 = w * (LG2 + w * (LG4 + w * LG6));
	const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
	const r = t2 + t1;
	if (((hx - 0x6147a) | (0x6b851 - hx)) > 0) {
		const hfsq = 0.5 * f * f;
		if (k === 0) return f - (hfsq - s * (hfsq + r));
		return dk * LN2_HI - (hfsq - (s * (hfsq + r) + dk * LN2_LO) - f);
	}
	if (k === 0) return f - s * (f - r);
	return dk * LN2_HI - (s * (f - r) - dk * LN2_LO - f);
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Inverse document frequency for a token within one field.
 *
 * @param field_doc_count Documents containing the field (`N(field)`), not the
 *   global document count.
 * @param doc_frequency Documents containing the token in that field (`df`).
 */
export function idf(field_doc_count: number, doc_frequency: number): number {
	return ln(1 + (field_doc_count - doc_frequency + 0.5) / (doc_frequency + 0.5));
}

/** Everything one `(document, token, field)` triple needs to be scored. */
export interface Bm25Input {
	/** Term frequency of the token in this document's field */
	tf: number;
	/** Token count of this document's field */
	field_length: number;
	/** Mean token count of the field across documents containing it */
	average_field_length: number;
	/** Documents containing the field (`N(field)`) */
	field_doc_count: number;
	/** Documents containing the token in the field (`df`) */
	doc_frequency: number;
}

/**
 * BM25+ score for one `(document, token, field)` triple.
 *
 * A document's total score is the sum of this over every
 * (field × query token × matched index token), each field's contribution
 * multiplied by `boost[field]`.
 */
export function bm25Score(input: Bm25Input, params: Bm25Params = BM25_DEFAULTS): number {
	const { tf, field_length, average_field_length, field_doc_count, doc_frequency } =
		input;
	const { k1, b, d } = params;
	// A zero average only happens when the field has no indexed content, in which
	// case field_length is zero too; fall back to no length normalization.
	const length_ratio = average_field_length > 0 ? field_length / average_field_length : 0;
	const denominator = tf + k1 * (1 - b + b * length_ratio);
	if (denominator === 0) return 0;
	return idf(field_doc_count, doc_frequency) * ((tf * (k1 + 1)) / denominator + d);
}
