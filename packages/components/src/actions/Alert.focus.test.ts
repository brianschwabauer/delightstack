// @vitest-environment happy-dom

/**
 * An alert is a modal question: the keyboard has to be in it the moment it opens, on the
 * least destructive answer (the ARIA alertdialog pattern), and back on whatever opened it
 * once it is answered. `Modal` leaves focus where it was on open (`initial_focus` defaults
 * to `false`), so `Alert` names its Cancel button.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { alert } from './Alert.svelte';

/** focus-trap defers both initial focus and return focus by a macrotask; `alert()` opens on
 * the next animation frame */
const settle = async () => {
	flushSync();
	await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
	flushSync();
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
};

// happy-dom has no Web Animations API, which Svelte transitions drive. Nothing here is under
// test — the stubs only keep the modal mountable.
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

afterEach(() => {
	document.body.innerHTML = '';
	document.body.style.overflow = '';
});

const buttonNamed = (name: string) =>
	Array.from(document.querySelectorAll<HTMLButtonElement>('.alert button')).find(
		(button) => button.textContent?.trim() === name,
	);

describe('Alert focus', () => {
	it('focuses Cancel when it opens and returns focus to the opener when answered', async () => {
		const trigger = document.createElement('button');
		trigger.textContent = 'Delete list';
		document.body.appendChild(trigger);
		trigger.focus();

		const answer = alert({
			message: 'Delete this list?',
			continue_text: 'Delete',
			destructive: true,
		});
		await settle();
		await settle();

		const cancel = buttonNamed('Cancel');
		expect(cancel).toBeDefined();
		expect(document.activeElement).toBe(cancel);

		cancel!.click();
		expect(await answer).toBe(false);
		await settle();
		expect(document.activeElement).toBe(trigger);
	});
});
