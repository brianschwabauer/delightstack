#!/usr/bin/env node
/**
 * Guard: every relative import specifier in a published `dist/` must be a complete ESM
 * specifier — one Node's loader can resolve on its own.
 *
 * Bundlers (Vite, esbuild, Rollup) happily resolve `from './foo'` and `from './foo/'` by
 * probing for extensions and `index` files. Node's ESM loader does not. A package whose
 * `dist` carries extensionless specifiers therefore works in every bundled context and
 * explodes the moment something imports it from a plain Node process — a SvelteKit SSR
 * render step, a Vitest file that did not inline the dependency, a one-off script.
 *
 * The fix lives in source: relative specifiers in `src/**` carry `.js` (or `.svelte`),
 * and directory imports name their `index.js` explicitly. This script is the ratchet that
 * keeps them there.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

/** Extensions a Node ESM loader (or Vite, for `.svelte`) resolves without probing. */
const COMPLETE_EXTENSIONS =
	/\.(js|mjs|cjs|svelte|css|json|svg|png|jpg|jpeg|webp|gif|wasm|txt|md|html)$/;

/** `from '…'`, bare `import '…'`, `import('…')`, `import('…').Type`, `require('…')`. */
const SPECIFIER_PATTERN =
	/(?:\bfrom\s*|\bimport\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;

function walkJS(dir, out = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) walkJS(path, out);
		else if (entry.name.endsWith('.js')) out.push(path);
	}
	return out;
}

const violations = [];
let files_checked = 0;
let dists_checked = 0;

for (const pkg of readdirSync(PACKAGES_DIR)) {
	const dist = join(PACKAGES_DIR, pkg, 'dist');
	if (!existsSync(dist)) continue;
	dists_checked++;
	for (const file of walkJS(dist)) {
		files_checked++;
		const source = readFileSync(file, 'utf8');
		for (const [, , specifier] of source.matchAll(SPECIFIER_PATTERN)) {
			if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
			if (COMPLETE_EXTENSIONS.test(specifier)) continue;
			violations.push({ file: relative(REPO_ROOT, file), specifier });
		}
	}
}

if (dists_checked === 0) {
	console.error(
		'check-dist-specifiers: no packages/*/dist found — run `pnpm build` first.',
	);
	process.exit(1);
}

if (violations.length > 0) {
	console.error(
		`check-dist-specifiers: ${violations.length} extensionless relative import(s) in built output.\n` +
			`Node's ESM loader cannot resolve these. Add the extension in the *source* file\n` +
			`(a '.ts' source imports its sibling as './sibling.js'; a directory as './dir/index.js').\n`,
	);
	for (const { file, specifier } of violations)
		console.error(`  ${file}: '${specifier}'`);
	process.exit(1);
}

console.log(
	`check-dist-specifiers: ${files_checked} built file(s) across ${dists_checked} package(s) — all relative imports complete.`,
);
