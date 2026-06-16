import type { Attachment } from 'svelte/attachments';
import { normalizeCursor } from '../core/coordinates';
import type { PresenceClient } from '../core';
import { getPresence } from './context';

export interface TrackCursorOptions {
	/**
	 * Enable Figma-style cursor chat: pressing `/` opens an inline input whose
	 * text rides along your cursor for other users. @default false
	 */
	chat?: boolean;
	/** Key that opens cursor chat. @default '/' */
	chat_key?: string;
	/** The presence client. Defaults to the one provided via `setPresence`. */
	client?: PresenceClient;
}

/** How long a committed cursor-chat message stays visible after sending (ms). */
const MESSAGE_LINGER_MS = 4000;

/**
 * Track the local pointer over a stage element and publish it as the local
 * cursor. Attach to the element you mark with `data-presence-stage` (or any
 * element — it falls back to the document root).
 *
 * @example
 * ```svelte
 * <main data-presence-stage {@attach trackCursor({ chat: true })}>…</main>
 * ```
 */
export function trackCursor(options: TrackCursorOptions = {}): Attachment<HTMLElement> {
	const presence = options.client ?? getPresence();
	const chat_enabled = options.chat ?? false;
	const chat_key = options.chat_key ?? '/';

	return (node) => {
		if (typeof window === 'undefined') return;

		let raf = 0;
		let last: { x: number; y: number; target: EventTarget | null } | null = null;
		let input: HTMLInputElement | null = null;
		let message_timer: ReturnType<typeof setTimeout> | undefined;

		const flush = () => {
			raf = 0;
			if (!last) return;
			presence.setCursor(normalizeCursor(last.x, last.y, last.target));
		};

		const onMove = (event: PointerEvent) => {
			last = { x: event.clientX, y: event.clientY, target: event.target };
			if (!raf) raf = requestAnimationFrame(flush);
		};

		const onLeave = () => presence.setCursor(null);

		node.addEventListener('pointermove', onMove, { passive: true });
		node.addEventListener('pointerleave', onLeave);

		const closeChat = (commit: boolean) => {
			const value = input?.value.trim();
			input?.remove();
			input = null;
			if (commit && value) {
				presence.setMessage(value);
				clearTimeout(message_timer);
				message_timer = setTimeout(() => presence.setMessage(null), MESSAGE_LINGER_MS);
			} else {
				presence.setMessage(null);
			}
		};

		const openChat = (x: number, y: number) => {
			if (input) return;
			input = document.createElement('input');
			input.type = 'text';
			input.placeholder = 'Say something…';
			input.maxLength = 120;
			input.setAttribute('aria-label', 'Cursor chat message');
			input.autocomplete = 'off';
			const color = presence.user?.color ?? 'var(--color-accent, #6366f1)';
			Object.assign(input.style, {
				position: 'fixed',
				left: `${x + 16}px`,
				top: `${y + 8}px`,
				zIndex: '2147483600',
				padding: '0.25rem 0.6rem',
				font: 'inherit',
				fontSize: '0.875rem',
				color: 'var(--color-text, #111)',
				background: 'var(--color-bg, #fff)',
				border: `2px solid ${color}`,
				borderRadius: '0.75rem',
				boxShadow: '0 4px 16px rgb(0 0 0 / 0.15)',
				outline: 'none',
				minWidth: '12rem',
			} satisfies Partial<CSSStyleDeclaration>);
			input.addEventListener('input', () => presence.setMessage(input?.value || null));
			input.addEventListener('keydown', (event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					closeChat(true);
				} else if (event.key === 'Escape') {
					event.preventDefault();
					closeChat(false);
				}
				event.stopPropagation();
			});
			input.addEventListener('blur', () => closeChat(true));
			document.body.appendChild(input);
			input.focus();
		};

		const onKey = (event: KeyboardEvent) => {
			if (input || event.key !== chat_key || isEditable(event.target)) return;
			event.preventDefault();
			openChat(last?.x ?? window.innerWidth / 2, last?.y ?? window.innerHeight / 2);
		};

		if (chat_enabled) window.addEventListener('keydown', onKey);

		return () => {
			node.removeEventListener('pointermove', onMove);
			node.removeEventListener('pointerleave', onLeave);
			if (chat_enabled) window.removeEventListener('keydown', onKey);
			if (raf) cancelAnimationFrame(raf);
			clearTimeout(message_timer);
			input?.remove();
			input = null;
			presence.setCursor(null);
			presence.setMessage(null);
		};
	};
}

function isEditable(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	if (!el || !el.tagName) return false;
	return (
		el.tagName === 'INPUT' ||
		el.tagName === 'TEXTAREA' ||
		el.tagName === 'SELECT' ||
		el.isContentEditable
	);
}
