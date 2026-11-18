/**
 * What a shortcut's key prints on its keycap, for `Shortcut` (the keycaps that
 * `ContextMenu` and `CommandPalette` draw).
 *
 * Pure: the platform comes in as an argument, so it can be tested on both.
 */

/** One key as its cap shows it */
export interface ShortcutKeyCap {
	/** What is printed on the cap: a glyph (⇧), a short word (Ctrl) or the key as given */
	text: string;
	/** The key's spelled-out name when the cap shows a glyph (⇧ → "Shift"), for a tooltip
	 * and assistive tech; undefined when the text already says it */
	name: string | undefined;
}

/** Key names (lower case) → what the cap prints on Apple platforms and elsewhere */
const KEYS: Record<string, { apple: string; other: string }> = {
	shift: { apple: '⇧', other: '⇧' },
	'⇧': { apple: '⇧', other: '⇧' },
	mod: { apple: '⌘', other: 'Ctrl' },
	cmd: { apple: '⌘', other: '⌘' },
	command: { apple: '⌘', other: '⌘' },
	meta: { apple: '⌘', other: '⌘' },
	'⌘': { apple: '⌘', other: '⌘' },
	ctrl: { apple: '⌃', other: 'Ctrl' },
	control: { apple: '⌃', other: 'Ctrl' },
	alt: { apple: '⌥', other: 'Alt' },
	option: { apple: '⌥', other: 'Alt' },
	'⌥': { apple: '⌥', other: 'Alt' },
	enter: { apple: '↵', other: '↵' },
	return: { apple: '↵', other: '↵' },
	backspace: { apple: '⌫', other: '⌫' },
	'⌫': { apple: '⌫', other: '⌫' },
	delete: { apple: 'Del', other: 'Del' },
	del: { apple: 'Del', other: 'Del' },
	tab: { apple: '⇥', other: '⇥' },
	escape: { apple: 'Esc', other: 'Esc' },
	esc: { apple: 'Esc', other: 'Esc' },
	arrowup: { apple: '↑', other: '↑' },
	up: { apple: '↑', other: '↑' },
	arrowdown: { apple: '↓', other: '↓' },
	down: { apple: '↓', other: '↓' },
	arrowleft: { apple: '←', other: '←' },
	left: { apple: '←', other: '←' },
	arrowright: { apple: '→', other: '→' },
	right: { apple: '→', other: '→' },
	space: { apple: 'Space', other: 'Space' },
};

/** Glyphs → the name a tooltip and assistive tech read instead */
const GLYPH_NAMES: Record<string, string> = {
	'⇧': 'Shift',
	'⌘': 'Command',
	'⌃': 'Control',
	'⌥': 'Option',
	'↵': 'Enter',
	'⌫': 'Backspace',
	'⇥': 'Tab',
	'↑': 'Up Arrow',
	'↓': 'Down Arrow',
	'←': 'Left Arrow',
	'→': 'Right Arrow',
};

/**
 * What one shortcut key prints on its cap. Key names match case-insensitively; `Mod`
 * is the platform's main modifier (⌘ on Apple, Ctrl elsewhere). A key the table doesn't
 * know is printed as given, a single letter in upper case.
 * @example shortcutKeyCap('Shift', false) // { text: '⇧', name: 'Shift' }
 * @example shortcutKeyCap('Mod', false) // { text: 'Ctrl', name: undefined }
 */
export function shortcutKeyCap(key: string, apple: boolean): ShortcutKeyCap {
	const known = KEYS[key.toLowerCase()];
	const text = known
		? apple
			? known.apple
			: known.other
		: [...key].length === 1
			? key.toUpperCase()
			: key;
	return { text, name: GLYPH_NAMES[text] };
}
