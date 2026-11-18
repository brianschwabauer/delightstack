// @vitest-environment happy-dom

/**
 * ContextMenu's own rows: a shortcut shows one keycap per key, printed the way the
 * platform writes it (⇧ ⌘ G on Apple, ⇧ Ctrl G elsewhere), and once any row has an icon,
 * rows without one keep an empty icon column so the labels line up. Layout itself is
 * checked in a browser; this covers the markup that drives it. The key table itself is
 * tested in shortcut-keys.test.ts.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Component } from 'svelte';
import type { ContextMenuOptions } from './ContextMenu.svelte';

// happy-dom has no Web Animations API, which the Popover's transitions drive
beforeAll(() => {
	const proto = window.Element.prototype as unknown as Record<string, unknown>;
	if (typeof proto.getAnimations !== 'function') proto.getAnimations = () => [];
	if (typeof proto.animate !== 'function') {
		proto.animate = () => ({
			cancel() {},
			commitStyles() {},
			finish() {},
			pause() {},
			play() {},
			currentTime: 0,
			playState: 'finished',
			finished: Promise.resolve(),
			onfinish: null,
		});
	}
});

const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
	vi.resetModules();
});

/** Load ContextMenu as it would on `platform` (the platform is read once, at import, so
 * each call re-imports it, with the Svelte runtime it mounts on) */
async function openMenu(options: ContextMenuOptions, platform = 'Linux x86_64') {
	vi.stubGlobal('navigator', { ...navigator, platform });
	const { flushSync, mount, unmount } = await import('svelte');
	const module = await import('./ContextMenu.svelte');
	const menu = mount(module.default, { target: document.body });
	flushSync();
	const target = document.createElement('div');
	document.body.append(target);
	const detach = module.contextMenu(options)(target);
	cleanups.push(() => {
		if (typeof detach === 'function') detach();
		unmount(menu);
	});
	target.dispatchEvent(
		new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }),
	);
	await Promise.resolve();
	flushSync();
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
	return Array.from(document.querySelectorAll<HTMLElement>('.list-item'));
}

const Icon = (() => {}) as unknown as Component<Record<string, unknown>>;

/** Each row's keycaps: what is printed on the cap, and the name a glyph cap carries */
function capsOf(rows: HTMLElement[]) {
	return rows.map((row) =>
		Array.from(row.querySelectorAll('.shortcut kbd')).map((kbd) => {
			const glyph = kbd.querySelector('[aria-hidden="true"]');
			return glyph
				? `${glyph.textContent?.trim()}|${kbd.getAttribute('title')}`
				: kbd.textContent?.trim();
		}),
	);
}

describe('ContextMenu shortcut keys', () => {
	const actions = [
		{ label: 'Ungroup', shortcut: ['Shift', 'Mod', 'G'] },
		{ label: 'Go to line', shortcut: ['ctrl', 'alt', 'g'] },
		{ label: 'Delete', shortcut: ['Delete'] },
	];

	it('draws one cap per key, with no "+" between them, off Apple platforms', async () => {
		const rows = await openMenu({ actions });
		expect(capsOf(rows)).toEqual([
			['⇧|Shift', 'Ctrl', 'G'],
			['Ctrl', 'Alt', 'G'],
			['Del'],
		]);
		expect(rows[0]?.querySelector('.shortcut')?.textContent).not.toContain('+');
	});

	it('prints Apple glyphs on Apple platforms', async () => {
		const rows = await openMenu({ actions }, 'MacIntel');
		expect(capsOf(rows)).toEqual([
			['⇧|Shift', '⌘|Command', 'G'],
			['⌃|Control', '⌥|Option', 'G'],
			['Del'],
		]);
	});

	it('hides a glyph from assistive tech and gives them its name', async () => {
		const rows = await openMenu({
			actions: [{ label: 'Ungroup', shortcut: ['Shift', 'G'] }],
		});
		const shift = rows[0]?.querySelector('.shortcut kbd');
		expect(shift?.querySelector('[aria-hidden="true"]')?.textContent).toBe('⇧');
		expect(shift?.querySelector('.name')?.textContent).toBe('Shift');
	});

	it("keeps a danger row's caps out of the error color", async () => {
		const rows = await openMenu({
			actions: [{ label: 'Delete', shortcut: ['Delete'], danger: true }],
		});
		expect(rows[0]?.querySelector('.label')?.classList.contains('danger')).toBe(true);
		expect(rows[0]?.querySelector('.shortcut .danger, .shortcut.danger')).toBeNull();
	});
});

describe('ContextMenu icon column', () => {
	it('gives rows without an icon an empty icon column when another row has one', async () => {
		const rows = await openMenu({
			actions: [{ label: 'Cut', icon: Icon }, { label: 'Repeat in a grid…' }],
		});
		const placeholder = rows[1]?.querySelector('.icon');
		expect(placeholder).not.toBeNull();
		expect(placeholder?.childElementCount).toBe(0);
		expect(placeholder?.getAttribute('aria-hidden')).toBe('true');
	});

	it('reserves no icon column when no row has an icon', async () => {
		const rows = await openMenu({ actions: [{ label: 'Cut' }, { label: 'Copy' }] });
		expect(rows).toHaveLength(2);
		expect(document.querySelector('.list-item .icon')).toBeNull();
	});
});
