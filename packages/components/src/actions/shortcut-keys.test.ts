import { describe, expect, it } from 'vitest';
import { shortcutKeyCap } from './shortcut-keys.js';

/** What each key prints on its cap, on one platform */
function caps(keys: string[], apple: boolean) {
	return keys.map((key) => shortcutKeyCap(key, apple).text);
}

describe('shortcutKeyCap on Apple platforms', () => {
	it('prints modifiers as glyphs', () => {
		expect(
			caps(['Shift', 'Mod', 'Cmd', 'Command', 'Meta', 'Ctrl', 'Control'], true),
		).toEqual(['⇧', '⌘', '⌘', '⌘', '⌘', '⌃', '⌃']);
		expect(caps(['Alt', 'Option', '⌥', '⇧', '⌘'], true)).toEqual([
			'⌥',
			'⌥',
			'⌥',
			'⇧',
			'⌘',
		]);
	});

	it('prints special keys as glyphs or short words', () => {
		expect(
			caps(
				['Enter', 'Return', 'Backspace', '⌫', 'Delete', 'Del', 'Tab', 'Escape', 'Esc'],
				true,
			),
		).toEqual(['↵', '↵', '⌫', '⌫', 'Del', 'Del', '⇥', 'Esc', 'Esc']);
		expect(
			caps(
				[
					'ArrowUp',
					'ArrowDown',
					'ArrowLeft',
					'ArrowRight',
					'Up',
					'Down',
					'Left',
					'Right',
				],
				true,
			),
		).toEqual(['↑', '↓', '←', '→', '↑', '↓', '←', '→']);
		expect(caps(['Space'], true)).toEqual(['Space']);
	});
});

describe('shortcutKeyCap elsewhere', () => {
	it('prints Ctrl and Alt as words and the rest as glyphs', () => {
		expect(
			caps(['Shift', 'Mod', 'Ctrl', 'Control', 'Alt', 'Option', '⌥'], false),
		).toEqual(['⇧', 'Ctrl', 'Ctrl', 'Ctrl', 'Alt', 'Alt', 'Alt']);
		expect(caps(['Cmd', 'Command', 'Meta', '⌘', '⇧'], false)).toEqual([
			'⌘',
			'⌘',
			'⌘',
			'⌘',
			'⇧',
		]);
	});

	it('prints special keys the same as on Apple', () => {
		expect(
			caps(
				[
					'Enter',
					'Return',
					'Backspace',
					'Delete',
					'Del',
					'Tab',
					'Escape',
					'Esc',
					'Space',
				],
				false,
			),
		).toEqual(['↵', '↵', '⌫', 'Del', 'Del', '⇥', 'Esc', 'Esc', 'Space']);
		expect(caps(['ArrowUp', 'Down', 'arrowleft', 'RIGHT'], false)).toEqual([
			'↑',
			'↓',
			'←',
			'→',
		]);
	});
});

describe('shortcutKeyCap on both platforms', () => {
	it('matches key names case-insensitively', () => {
		for (const apple of [true, false]) {
			expect(caps(['shift', 'SHIFT', 'mod', 'MOD', 'eNtEr', 'esc'], apple)).toEqual(
				caps(['Shift', 'Shift', 'Mod', 'Mod', 'Enter', 'Esc'], apple),
			);
		}
	});

	it('prints unknown keys as given, a single letter in upper case', () => {
		for (const apple of [true, false]) {
			expect(caps(['g', 'G', ']', '=', 'F2', 'PageUp', '1'], apple)).toEqual([
				'G',
				'G',
				']',
				'=',
				'F2',
				'PageUp',
				'1',
			]);
		}
	});

	it('names every glyph cap and no word or letter cap', () => {
		expect(shortcutKeyCap('Shift', false)).toEqual({ text: '⇧', name: 'Shift' });
		expect(shortcutKeyCap('Mod', true)).toEqual({ text: '⌘', name: 'Command' });
		expect(shortcutKeyCap('Ctrl', true)).toEqual({ text: '⌃', name: 'Control' });
		expect(shortcutKeyCap('Alt', true)).toEqual({ text: '⌥', name: 'Option' });
		expect(shortcutKeyCap('Enter', false)).toEqual({ text: '↵', name: 'Enter' });
		expect(shortcutKeyCap('Backspace', false)).toEqual({ text: '⌫', name: 'Backspace' });
		expect(shortcutKeyCap('Tab', false)).toEqual({ text: '⇥', name: 'Tab' });
		expect(shortcutKeyCap('ArrowUp', false)).toEqual({ text: '↑', name: 'Up Arrow' });
		// A glyph passed as given is named too
		expect(shortcutKeyCap('⌃', false)).toEqual({ text: '⌃', name: 'Control' });
		for (const key of ['Mod', 'Ctrl', 'Alt', 'Del', 'Esc', 'Space', 'G', 'F2']) {
			expect(shortcutKeyCap(key, false).name).toBeUndefined();
		}
	});
});
