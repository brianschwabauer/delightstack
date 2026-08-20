import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The entry-point pins, guarded at the source level.
 *
 * `loro-crdt`'s export map sends the bare specifier to `./browser/index.js`
 * whenever the **`browser` export condition** is active — which is what a
 * bundler targeting Workers turns on, and that build throws at module scope in
 * workerd. `./bundler` and `./web` carry no `browser` condition at all, so a
 * subpath pin resolves the same way under every condition. That is what makes
 * the pins load-bearing.
 *
 * This cannot be caught by running in workerd. Resolution happens in the
 * bundler, before the runtime sees anything — `workerd.test.ts` loads the right
 * build no matter what this file's modules say, because the test pool resolves
 * through `import`. So the regression is guarded here, by reading the source.
 */
const SRC = new URL('..', import.meta.url).pathname;

function sourceFiles(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			found.push(...sourceFiles(path));
		} else if (/\.(ts|js)$/.test(entry) && !entry.endsWith('.d.ts')) {
			found.push(path);
		}
	}
	return found;
}

/**
 * Every `import`/`export … from 'loro-crdt'` statement, bare specifier only.
 *
 * Matched across the whole file rather than line by line, because these are
 * routinely written multi-line — `loro.server.ts` ends a fourteen-line
 * `export type { … }` on its own closing brace, which a line-based check reads
 * as an untyped import and flags.
 *
 * The body is `[^;]*?` rather than `[\s\S]*?` so a match cannot run past the
 * end of its own statement. With the latter, a value export ending in
 * `from 'loro-crdt/web';` swallows the following line's type-only import of the
 * bare specifier and reports the value export as the offender.
 */
const BARE_STATEMENT = /(?:^|\n)\s*(import|export)\s+(type\s+)?[^;]*?from\s+['"]loro-crdt['"]/g;

describe('loro-crdt entry points', () => {
	it('pins the bundler build on the server and the web build on the client', () => {
		expect(readFileSync(join(SRC, 'loro.server.ts'), 'utf8')).toContain("'loro-crdt/bundler'");
		expect(readFileSync(join(SRC, 'loro.client.ts'), 'utf8')).toContain("'loro-crdt/web'");
	});

	it('imports the bare specifier nowhere but in a type-only position', () => {
		const offenders: string[] = [];
		for (const file of sourceFiles(SRC)) {
			// This file names the specifier in its own prose and assertions.
			if (file.endsWith('loro_entry_points.test.ts')) continue;
			const source = readFileSync(file, 'utf8');
			for (const match of source.matchAll(BARE_STATEMENT)) {
				// A type-only import is erased before any bundler resolves it, so it
				// cannot pick the wrong build. Both entry points use one on purpose:
				// the subpath builds do not re-export every type.
				if (match[2]) continue;
				const line = source.slice(0, match.index).split('\n').length;
				offenders.push(`${file.replace(SRC, '')}:${line}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
