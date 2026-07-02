import { describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { TextSelection } from 'prosemirror-state';
import { Editor } from './editor.svelte.js';
import type { JSONContent } from '../types/index.js';

function textDoc(...paragraphs: string[]): JSONContent {
	return {
		type: 'doc',
		content: paragraphs.map((text) => ({
			type: 'paragraph',
			content: text ? [{ type: 'text', text }] : [],
		})),
	};
}

describe('Editor', () => {
	it('creates an empty doc by default and reports is_empty', () => {
		const editor = new Editor();
		expect(editor.is_empty).toBe(true);
		expect(editor.doc.type).toBe('doc');
		editor.destroy();
	});

	it('applies transactions through the dispatch funnel and updates reactive state', () => {
		const editor = new Editor({ content: textDoc('hello') });
		expect(editor.is_empty).toBe(false);
		const events: string[] = [];
		editor.on('update', () => events.push('update'));

		const { state } = editor;
		editor.dispatch(state.tr.insertText(' world', state.doc.content.size - 1));
		flushSync();
		expect(editor.getText()).toBe('hello world');
		expect(events).toEqual(['update']);
		editor.destroy();
	});

	it('supports dispatch wrappers (collab seam)', () => {
		const editor = new Editor({ content: textDoc('a') });
		const seen: boolean[] = [];
		const unwrap = editor.wrapDispatch((tr, next) => {
			seen.push(tr.docChanged);
			next(tr);
		});
		editor.dispatch(editor.state.tr.insertText('b', 2));
		expect(seen).toEqual([true]);
		expect(editor.getText()).toBe('ab');
		unwrap();
		editor.dispatch(editor.state.tr.insertText('c', 3));
		expect(seen).toEqual([true]);
		editor.destroy();
	});

	it('tracks undo/redo depth', () => {
		const editor = new Editor({ content: textDoc('x') });
		expect(editor.can_undo).toBe(false);
		editor.dispatch(editor.state.tr.insertText('y', 2));
		flushSync();
		expect(editor.can_undo).toBe(true);
		expect(editor.can_redo).toBe(false);
		editor.undo();
		flushSync();
		expect(editor.getText()).toBe('x');
		expect(editor.can_redo).toBe(true);
		editor.destroy();
	});

	it('toggles marks and reports active_marks', () => {
		const editor = new Editor({ content: textDoc('bold me') });
		editor.dispatch(
			editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 5)),
		);
		editor.toggleMark('bold');
		flushSync();
		expect(editor.active_marks.bold).toBe(true);
		expect(editor.doc.content?.[0].content?.[0].marks?.[0].type).toBe('bold');
		editor.destroy();
	});

	it('sets and toggles block types', () => {
		const editor = new Editor({ content: textDoc('title') });
		editor.setBlock('heading', { level: 2 });
		flushSync();
		expect(editor.active_block?.name).toBe('heading');
		expect(editor.active_block?.attrs.level).toBe(2);
		// Toggling the same type returns to paragraph
		editor.setBlock('heading', { level: 2 });
		flushSync();
		expect(editor.active_block?.name).toBe('paragraph');
		editor.destroy();
	});

	it('inserts blocks', () => {
		const editor = new Editor({ content: textDoc('a') });
		editor.insertBlock('horizontal_rule');
		const types = editor.doc.content?.map((node) => node.type);
		expect(types).toContain('horizontal_rule');
		editor.destroy();
	});

	it('assigns unique block ids via appendTransaction', () => {
		const editor = new Editor({ content: textDoc('one', 'two') });
		editor.dispatch(editor.state.tr.insertText('!', 4));
		const ids = editor.doc.content?.map((node) => node.attrs?.block_id);
		expect(ids).toHaveLength(2);
		expect(ids?.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
		expect(new Set(ids).size).toBe(2);
		editor.destroy();
	});

	it('block id assignment does not pollute undo history', () => {
		const editor = new Editor({ content: textDoc('a') });
		editor.dispatch(editor.state.tr.insertText('b', 2));
		editor.undo();
		flushSync();
		expect(editor.getText()).toBe('a');
		expect(editor.can_undo).toBe(false);
		editor.destroy();
	});

	it('getJSON strips uploading nodes by default', () => {
		const editor = new Editor({
			blocks: [
				{
					name: 'stub_media',
					schema: {
						group: 'block',
						atom: true,
						attrs: { uploading: { default: false }, upload_id: { default: null } },
					},
				},
			],
			content: {
				type: 'doc',
				content: [
					{ type: 'paragraph', content: [{ type: 'text', text: 'keep' }] },
					{ type: 'stub_media', attrs: { uploading: true, upload_id: 'u1' } },
				],
			},
		});
		expect(editor.getJSON().content?.map((node) => node.type)).toEqual(['paragraph']);
		expect(editor.getJSON({ strip_uploading: false }).content).toHaveLength(2);
		editor.destroy();
	});

	it('setContent replaces the doc without history by default', () => {
		const editor = new Editor({ content: textDoc('old') });
		editor.setContent(textDoc('new'));
		flushSync();
		expect(editor.getText()).toBe('new');
		expect(editor.can_undo).toBe(false);
		editor.destroy();
	});

	it('registers block commands into the registry', () => {
		const editor = new Editor({
			blocks: [
				{
					name: 'thing',
					schema: { group: 'block', atom: true },
					commands: [
						{
							name: 'thing',
							label: 'Thing',
							run: (e) => e.insertBlock('thing'),
						},
					],
				},
			],
		});
		expect(editor.commands.get('thing')).toBeDefined();
		expect(editor.run('thing')).toBe(true);
		expect(editor.doc.content?.some((node) => node.type === 'thing')).toBe(true);
		editor.destroy();
	});

	it('throws DelightError on invalid content', () => {
		expect(
			() => new Editor({ content: { type: 'doc', content: [{ type: 'nope' }] } }),
		).toThrow(/Invalid editor content/);
	});
});
