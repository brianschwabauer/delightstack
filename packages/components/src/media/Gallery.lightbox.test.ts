// @vitest-environment happy-dom

/**
 * The lightbox is a modal, and a modal that the keyboard can walk out of is
 * not one. `Gallery` gets that from the `focusTrap` attachment, which for a
 * long time silently did nothing here: the trap is attached in the same flush
 * that creates the lightbox's controls, every one of those controls is a
 * delightstack `Button` (which renders `disabled tabindex="-1"` until its own
 * mount effect lands), so focus-trap saw a container with no tabbable node,
 * threw, and never activated. This is the test that would have caught it.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import Gallery from './Gallery.svelte';

// happy-dom has no Web Animations API, and the Carousel inside the lightbox
// drives its slide transitions through it. Nothing here is under test — the
// stubs only keep the component mountable.
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

const ITEMS = [
	{ src: 'https://example.com/a.jpg', alt: 'A' },
	{ src: 'https://example.com/b.jpg', alt: 'B' },
	{ src: 'https://example.com/c.jpg', alt: 'C' },
];

/** focus-trap defers both initial focus and return focus by a macrotask. */
const settle = async () => {
	flushSync();
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
};

let teardown: (() => void) | undefined;

afterEach(() => {
	teardown?.();
	teardown = undefined;
	document.body.innerHTML = '';
	document.body.style.overflow = '';
});

/** A lightbox gallery plus the caller-owned thumbnail that opens it. */
function setup() {
	const trigger = document.createElement('button');
	trigger.textContent = 'Open';
	document.body.appendChild(trigger);

	const target = document.createElement('div');
	document.body.appendChild(target);
	const gallery = mount(Gallery, {
		target,
		props: { items: ITEMS, display: 'lightbox' },
	});
	teardown = () => {
		unmount(gallery, { outro: false });
	};
	flushSync();

	return { gallery, trigger };
}

const lightbox = () => document.querySelector<HTMLElement>('.gallery.slider');

describe('Gallery lightbox focus trap', () => {
	it('moves focus into the lightbox when it opens', async () => {
		const { gallery, trigger } = setup();
		expect(lightbox()).toBe(null);

		trigger.focus();
		gallery.open(1, trigger);
		await settle();

		const modal = lightbox();
		expect(modal).not.toBe(null);
		// Focus is inside the modal — not left behind on the thumbnail, which
		// is what happens when the trap fails to activate.
		expect(modal!.contains(document.activeElement)).toBe(true);
		expect(document.activeElement).not.toBe(trigger);
		expect(document.activeElement).not.toBe(document.body);
	});

	it('closes on Escape and hands focus back to the thumbnail', async () => {
		const { gallery, trigger } = setup();

		trigger.focus();
		gallery.open(1, trigger);
		await settle();
		expect(document.body.style.overflow).toBe('hidden');

		document.activeElement!.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
		);
		await settle();

		// `onPostDeactivate` puts `slide` back to -1, which is what closes the
		// modal; the restored body scroll is that state made observable.
		expect(document.body.style.overflow).toBe('');
		expect(document.activeElement).toBe(trigger);
	});

	it('keeps Tab inside the lightbox once its controls have mounted', async () => {
		const { gallery, trigger } = setup();

		trigger.focus();
		gallery.open(1, trigger);
		await settle();

		const modal = lightbox()!;
		trigger.focus();
		await settle();

		// A focus trap pulls focus back the moment it lands outside.
		expect(modal.contains(document.activeElement)).toBe(true);
	});
});
