import type { Attachment } from 'svelte/attachments';
import type { PresenceClient } from '../core';
import { getPresence } from './context';

export interface FieldPresenceOptions {
	/** Human-readable label for the field. Defaults to aria-label/placeholder/name/id. */
	label?: string;
	/** Draw a colored ring around the element when a peer is focused there. @default true */
	ring?: boolean;
	/** Show a small name badge at the element's top-right. @default true */
	badge?: boolean;
	/** The presence client. Defaults to the one provided via `setPresence`. */
	client?: PresenceClient;
}

/**
 * Report the local user's focus on a field/cell and surface other users' focus
 * as a colored ring + name badge — a soft-lock "Bob is editing this" heads-up.
 *
 * `anchor` is a stable id shared across clients (e.g. the field name, a cell id).
 *
 * @example
 * ```svelte
 * <input name="email" {@attach fieldPresence('user.email')} />
 * ```
 */
export function fieldPresence(
	anchor: string,
	options: FieldPresenceOptions = {},
): Attachment<HTMLElement> {
	const presence = options.client ?? getPresence();
	const ring = options.ring ?? true;
	const badge = options.badge ?? true;

	return (node) => {
		if (typeof window === 'undefined') return;
		const label = options.label ?? deriveLabel(node);

		// --- local focus reporting (focusin/out bubble from descendants too) ---
		const onFocus = () => presence.setFocus({ anchor, label });
		const onBlur = () => presence.setFocus(null);
		node.addEventListener('focusin', onFocus);
		node.addEventListener('focusout', onBlur);

		// --- remote rendering ---
		let original_box_shadow = '';
		let box_shadow_set = false;
		let badge_el: HTMLElement | null = null;
		let reposition_raf = 0;

		const positionBadge = () => {
			if (!badge_el) return;
			const rect = node.getBoundingClientRect();
			badge_el.style.left = `${rect.right}px`;
			badge_el.style.top = `${rect.top}px`;
		};
		const scheduleReposition = () => {
			if (reposition_raf) return;
			reposition_raf = requestAnimationFrame(() => {
				reposition_raf = 0;
				positionBadge();
			});
		};

		const clearRemote = () => {
			if (box_shadow_set) {
				node.style.boxShadow = original_box_shadow;
				box_shadow_set = false;
			}
			badge_el?.remove();
			badge_el = null;
		};

		const render = () => {
			const me = presence.user?.id;
			const peers = presence.peers.filter(
				(p) => p.state.focus?.anchor === anchor && p.user.id !== me,
			);
			if (peers.length === 0) {
				clearRemote();
				return;
			}
			const peer = peers[0];
			const color = peer.user.color;

			if (ring) {
				if (!box_shadow_set) {
					original_box_shadow = node.style.boxShadow;
					box_shadow_set = true;
				}
				node.style.boxShadow = `0 0 0 2px ${color}`;
			}

			if (badge) {
				if (!badge_el) {
					badge_el = document.createElement('div');
					badge_el.setAttribute('aria-hidden', 'true');
					Object.assign(badge_el.style, {
						position: 'fixed',
						zIndex: '2147483200',
						transform: 'translate(-100%, -100%)',
						padding: '0.05rem 0.4rem',
						font: 'inherit',
						fontSize: '0.7rem',
						fontWeight: '600',
						lineHeight: '1.4',
						color: '#fff',
						borderRadius: '0.4rem',
						whiteSpace: 'nowrap',
						pointerEvents: 'none',
						boxShadow: '0 1px 4px rgb(0 0 0 / 0.2)',
					} satisfies Partial<CSSStyleDeclaration>);
					document.body.appendChild(badge_el);
				}
				badge_el.style.background = color;
				badge_el.textContent =
					peers.length > 1 ? `${peer.user.name} +${peers.length - 1}` : peer.user.name;
				positionBadge();
			}
		};

		const unsub = presence.onChange(render);
		window.addEventListener('scroll', scheduleReposition, {
			passive: true,
			capture: true,
		});
		window.addEventListener('resize', scheduleReposition);
		render();

		return () => {
			node.removeEventListener('focusin', onFocus);
			node.removeEventListener('focusout', onBlur);
			window.removeEventListener('scroll', scheduleReposition, {
				capture: true,
			} as EventListenerOptions);
			window.removeEventListener('resize', scheduleReposition);
			unsub();
			if (reposition_raf) cancelAnimationFrame(reposition_raf);
			clearRemote();
		};
	};
}

function deriveLabel(node: HTMLElement): string | undefined {
	return (
		node.getAttribute('aria-label') ||
		(node as HTMLInputElement).placeholder ||
		node.getAttribute('name') ||
		node.id ||
		undefined
	);
}
