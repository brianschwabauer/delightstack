import { describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { Editor } from '../editor.svelte.js';
import { svelteNodeViews } from './svelte-node-view.svelte.js';
import { calloutBlock } from '../../blocks/callout.js';
import { defaultBlocks } from '../../blocks/index.js';
import type { JSONContent } from '../../types/index.js';

const CONTENT: JSONContent = {
	type: 'doc',
	content: [
		{ type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
		{
			type: 'callout',
			attrs: { variant: 'tip' },
			content: [{ type: 'paragraph', content: [{ type: 'text', text: 'inside' }] }],
		},
	],
};

function mountEditor(content: JSONContent = CONTENT): {
	editor: Editor;
	el: HTMLElement;
} {
	const editor = new Editor({ blocks: defaultBlocks(), content });
	editor.setNodeViews(svelteNodeViews(editor));
	const el = document.createElement('div');
	document.body.appendChild(el);
	editor.mount(el);
	flushSync();
	return { editor, el };
}

describe('SvelteNodeView bridge', () => {
	it('mounts a Svelte component with contentDOM claimed synchronously', () => {
		const { editor, el } = mountEditor();
		const aside = el.querySelector('div.callout');
		expect(aside).toBeTruthy();
		expect(aside?.classList.contains('tip')).toBe(true);
		// The editable content hole renders the inner paragraph
		const body = el.querySelector('[data-editor-content]');
		expect(body?.textContent).toBe('inside');
		editor.destroy();
		el.remove();
	});

	it('updates reactively on attr changes without re-mounting (and without loops)', () => {
		const { editor, el } = mountEditor();
		const before = el.querySelector('div.callout');
		// Find the callout position
		let calloutPos = -1;
		editor.state.doc.descendants((node, pos) => {
			if (node.type.name === 'callout') calloutPos = pos;
		});
		expect(calloutPos).toBeGreaterThan(-1);

		editor.updateNodeAttrs(calloutPos, { variant: 'warning' });
		flushSync();

		const after = el.querySelector('div.callout');
		expect(after).toBe(before); // same DOM node — not re-mounted
		expect(after?.classList.contains('warning')).toBe(true);
		expect(after?.classList.contains('tip')).toBe(false);
		editor.destroy();
		el.remove();
	});

	it('keeps editing the contentDOM working after attr updates', () => {
		const { editor, el } = mountEditor();
		let calloutPos = -1;
		editor.state.doc.descendants((node, pos) => {
			if (node.type.name === 'callout') calloutPos = pos;
		});
		editor.updateNodeAttrs(calloutPos, { variant: 'error' });
		flushSync();
		// Type into the callout paragraph via a transaction
		editor.dispatch(editor.state.tr.insertText('!', calloutPos + 2));
		flushSync();
		expect(el.querySelector('[data-editor-content]')?.textContent).toContain('!');
		editor.destroy();
		el.remove();
	});

	it('reflects selection through selectNode/deselectNode', () => {
		const { editor, el } = mountEditor();
		let calloutPos = -1;
		editor.state.doc.descendants((node, pos) => {
			if (node.type.name === 'callout') calloutPos = pos;
		});
		editor.selectNode(calloutPos);
		flushSync();
		expect(el.querySelector('.ds-block.selected')).toBeTruthy();
		editor.destroy();
		el.remove();
	});

	it('destroys cleanly', () => {
		const { editor, el } = mountEditor();
		editor.destroy();
		flushSync();
		el.remove();
		expect(document.querySelector('div.callout')).toBeNull();
	});
});

describe('callout spec', () => {
	it('registers its slash command', () => {
		const editor = new Editor({ blocks: [calloutBlock as never] });
		expect(editor.commands.get('callout')).toBeDefined();
		editor.destroy();
	});
});
