/**
 * The golden-vector generator's entry point.
 *
 * Skipped unless `DELIGHT_REGEN_GOLDEN=1`, so an ordinary test run can never
 * rewrite the frozen answers:
 *
 * ```sh
 * DELIGHT_REGEN_GOLDEN=1 pnpm --filter @delightstack/database exec vitest run \
 *   src/search/__tests__/golden/regenerate.test.ts
 * ```
 *
 * See `generate.ts` for what each suite covers. After regenerating, re-audit —
 * a golden vector is only worth what its last hand-audit was worth.
 */

import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildAllGoldenSuites, stringifyGoldenSuite } from './generate';

const SHOULD_REGENERATE =
	typeof process !== 'undefined' && process.env?.DELIGHT_REGEN_GOLDEN === '1';

describe.skipIf(!SHOULD_REGENERATE)('golden fixture regeneration', () => {
	it('writes every suite', { timeout: 300_000 }, () => {
		for (const { file, suite } of buildAllGoldenSuites()) {
			writeFileSync(
				new URL(`./${file}`, import.meta.url),
				stringifyGoldenSuite(suite),
				'utf8',
			);
			expect(suite.vectors.length + suite.error_vectors.length).toBeGreaterThan(0);
		}
	});
});
