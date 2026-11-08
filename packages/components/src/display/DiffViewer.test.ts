/**
 * The one thing about `DiffViewer` that the pure model cannot answer: which way
 * a move's arrows point. The model gives each end the other's *line number*,
 * and the two numbers count in two different documents — so the component reads
 * the direction off the two rows' positions instead, and this is where that is
 * checked.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import DiffViewer from './DiffViewer.svelte';
import type { DiffHunk } from './diff-model.js';

const markers = (html: string) =>
	[...html.matchAll(/<span class="[^"]*marker[^"]*"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);

describe('DiffViewer move markers', () => {
	it('points each arrow at the other end when the block moved down', () => {
		const hunks: DiffHunk[] = [
			{ kind: 'equal', before: 'top', after: 'top' },
			{ kind: 'moved', before: 'A', before_index: 1, after_index: 2, stub: true },
			{ kind: 'equal', before: 'x', after: 'x' },
			{ kind: 'moved', before: 'A', after: 'A', before_index: 1, after_index: 2 },
		];
		expect(markers(render(DiffViewer, { props: { hunks } }).body)).toEqual([
			'⇅ Moved to line 3 ↓',
			'⇅ Moved from line 2 ↑',
		]);
	});

	it('still points at the other end when a big deletion inverts the numbers', () => {
		const hunks: DiffHunk[] = [];
		for (let i = 1; i <= 50; i++) hunks.push({ kind: 'delete', before: `d${i}` });
		hunks.push({ kind: 'moved', before: 'A', before_index: 50, after_index: 1, stub: true });
		hunks.push({ kind: 'equal', before: 'X', after: 'X' });
		hunks.push({ kind: 'moved', before: 'A', after: 'A', before_index: 50, after_index: 1 });
		// The stub is at old line 51 and the span at new line 2, so the numbers
		// say "up" while the span is two rows further down the page.
		const html = render(DiffViewer, { props: { hunks, context_lines: Infinity } }).body;
		expect(markers(html)).toEqual([
			'⇅ Moved to line 2 ↓',
			'⇅ Moved from line 51 ↑',
		]);
	});
});
