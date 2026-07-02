import { Plugin } from 'prosemirror-state';
import { dropPoint } from 'prosemirror-transform';
import type { EditorView } from 'prosemirror-view';

/**
 * Drop position indicator, replacing `prosemirror-dropcursor`. The upstream
 * plugin destroys and recreates its element on every position change, so the
 * line teleports between candidate gaps. This one keeps a single persistent
 * element and lets CSS transition it — the indicator glides between gaps and
 * fades in/out instead of blinking.
 *
 * Styling comes from the `class` option (the editor passes `ds-dropcursor`);
 * the element also carries `data-visible` and the same
 * `prosemirror-dropcursor-block/-inline` classes as upstream.
 *
 * Nodes may keep using the `disableDropCursor` spec property.
 */

export interface DropIndicatorOptions {
	/** Line thickness in px. Default 2 */
	width?: number;
	class?: string;
}

const views = new WeakMap<EditorView, DropIndicatorView>();

/**
 * Programmatic control for non-native drag paths (touch reorder): show the
 * indicator at a document position, or hide it with `null`.
 */
export function setDropIndicator(view: EditorView, pos: number | null): void {
	views.get(view)?.setCursor(pos);
}

export function dropIndicator(options: DropIndicatorOptions = {}): Plugin {
	return new Plugin({
		view(editorView) {
			const view = new DropIndicatorView(editorView, options);
			views.set(editorView, view);
			return view;
		},
	});
}

class DropIndicatorView {
	private cursorPos: number | null = null;
	private element: HTMLElement | null = null;
	private timeout: ReturnType<typeof setTimeout> | undefined;
	private hideTimeout: ReturnType<typeof setTimeout> | undefined;
	private readonly width: number;
	private readonly className: string | undefined;
	private readonly handlers: { name: string; handler: (event: Event) => void }[];

	constructor(
		private readonly view: EditorView,
		options: DropIndicatorOptions,
	) {
		this.width = options.width ?? 2;
		this.className = options.class;
		this.handlers = (['dragover', 'dragend', 'drop', 'dragleave'] as const).map(
			(name) => {
				const handler = (event: Event) => {
					this[name](event as DragEvent);
				};
				view.dom.addEventListener(name, handler);
				return { name, handler };
			},
		);
	}

	destroy() {
		this.handlers.forEach(({ name, handler }) =>
			this.view.dom.removeEventListener(name, handler),
		);
		clearTimeout(this.timeout);
		clearTimeout(this.hideTimeout);
		this.element?.remove();
		this.element = null;
		views.delete(this.view);
	}

	update(view: EditorView, prevState: { doc: unknown }) {
		if (this.cursorPos != null && prevState.doc !== view.state.doc) {
			if (this.cursorPos > view.state.doc.content.size) this.setCursor(null);
			else this.updateOverlay(false);
		}
	}

	setCursor(pos: number | null) {
		if (pos === this.cursorPos) return;
		const appearing = this.cursorPos == null && pos != null;
		this.cursorPos = pos;
		if (pos == null) {
			this.hide();
		} else {
			this.updateOverlay(appearing);
		}
	}

	private hide() {
		clearTimeout(this.hideTimeout);
		const element = this.element;
		if (!element) return;
		element.dataset.visible = 'false';
		element.style.opacity = '0';
		// Keep the node for reuse; just make sure a stale line can't linger
		this.hideTimeout = setTimeout(() => {
			if (this.cursorPos == null) element.style.display = 'none';
		}, 200);
	}

	private ensureElement(): HTMLElement {
		if (this.element) return this.element;
		const parent = this.view.dom.offsetParent ?? document.body;
		const element = parent.appendChild(document.createElement('div'));
		if (this.className) element.className = this.className;
		element.style.cssText =
			'position: absolute; z-index: 50; pointer-events: none; opacity: 0;';
		// Position glides, visibility fades — layout properties on a tiny
		// absolutely-positioned overlay are cheap to transition
		element.style.transition =
			'top 90ms cubic-bezier(0.33, 1, 0.68, 1), left 90ms cubic-bezier(0.33, 1, 0.68, 1), width 90ms cubic-bezier(0.33, 1, 0.68, 1), height 90ms cubic-bezier(0.33, 1, 0.68, 1), opacity 120ms ease';
		this.element = element;
		return element;
	}

	private updateOverlay(appearing: boolean) {
		if (this.cursorPos == null) return;
		const view = this.view;
		const $pos = view.state.doc.resolve(this.cursorPos);
		const isBlock = !$pos.parent.inlineContent;
		const editorDOM = view.dom as HTMLElement;
		const editorRect = editorDOM.getBoundingClientRect();
		const scaleX = editorRect.width / editorDOM.offsetWidth;
		const scaleY = editorRect.height / editorDOM.offsetHeight;
		let rect: { left: number; right: number; top: number; bottom: number } | undefined;

		if (isBlock) {
			const before = $pos.nodeBefore;
			const after = $pos.nodeAfter;
			if (before || after) {
				const node = view.nodeDOM(
					this.cursorPos - (before ? before.nodeSize : 0),
				) as HTMLElement | null;
				if (node?.getBoundingClientRect) {
					const nodeRect = node.getBoundingClientRect();
					let top = before ? nodeRect.bottom : nodeRect.top;
					if (before && after) {
						const nextDOM = view.nodeDOM(this.cursorPos) as HTMLElement | null;
						if (nextDOM?.getBoundingClientRect) {
							top = (top + nextDOM.getBoundingClientRect().top) / 2;
						}
					}
					const half = (this.width / 2) * scaleY;
					rect = {
						left: nodeRect.left,
						right: nodeRect.right,
						top: top - half,
						bottom: top + half,
					};
				}
			}
		}
		if (!rect) {
			const coords = view.coordsAtPos(this.cursorPos);
			const half = (this.width / 2) * scaleX;
			rect = {
				left: coords.left - half,
				right: coords.left + half,
				top: coords.top,
				bottom: coords.bottom,
			};
		}

		const element = this.ensureElement();
		clearTimeout(this.hideTimeout);
		element.classList.toggle('prosemirror-dropcursor-block', isBlock);
		element.classList.toggle('prosemirror-dropcursor-inline', !isBlock);

		const parent = editorDOM.offsetParent as HTMLElement | null;
		let parentLeft: number;
		let parentTop: number;
		if (
			!parent ||
			(parent === document.body && getComputedStyle(parent).position === 'static')
		) {
			parentLeft = -pageXOffset;
			parentTop = -pageYOffset;
		} else {
			const parentRect = parent.getBoundingClientRect();
			const parentScaleX = parentRect.width / parent.offsetWidth;
			const parentScaleY = parentRect.height / parent.offsetHeight;
			parentLeft = parentRect.left - parent.scrollLeft * parentScaleX;
			parentTop = parentRect.top - parent.scrollTop * parentScaleY;
		}

		// A freshly appearing indicator must not glide in from its previous
		// location — snap to place, then re-enable transitions for the fade
		if (appearing || element.style.display === 'none') {
			const transition = element.style.transition;
			element.style.transition = 'none';
			element.style.display = '';
			this.applyRect(element, rect, parentLeft, parentTop, scaleX, scaleY);
			void element.offsetWidth; // flush so the snap isn't animated
			element.style.transition = transition;
		} else {
			this.applyRect(element, rect, parentLeft, parentTop, scaleX, scaleY);
		}
		element.dataset.visible = 'true';
		element.style.opacity = '1';
	}

	private applyRect(
		element: HTMLElement,
		rect: { left: number; right: number; top: number; bottom: number },
		parentLeft: number,
		parentTop: number,
		scaleX: number,
		scaleY: number,
	) {
		element.style.left = `${(rect.left - parentLeft) / scaleX}px`;
		element.style.top = `${(rect.top - parentTop) / scaleY}px`;
		element.style.width = `${(rect.right - rect.left) / scaleX}px`;
		element.style.height = `${(rect.bottom - rect.top) / scaleY}px`;
	}

	private scheduleRemoval(timeout: number) {
		clearTimeout(this.timeout);
		this.timeout = setTimeout(() => this.setCursor(null), timeout);
	}

	private dragover(event: DragEvent) {
		const view = this.view;
		if (!view.editable) return;
		const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
		const node = pos && pos.inside >= 0 && view.state.doc.nodeAt(pos.inside);
		const disable = node && node.type.spec.disableDropCursor;
		const disabled = typeof disable === 'function' ? disable(view, pos, event) : disable;
		if (pos && !disabled) {
			let target = pos.pos;
			if (view.dragging?.slice) {
				const point = dropPoint(view.state.doc, target, view.dragging.slice);
				if (point != null) target = point;
			}
			this.setCursor(target);
			this.scheduleRemoval(5000);
		}
	}

	private dragend(_event: DragEvent) {
		this.scheduleRemoval(20);
	}

	private drop(_event: DragEvent) {
		this.scheduleRemoval(20);
	}

	private dragleave(event: DragEvent) {
		if (
			!(event.relatedTarget instanceof Node) ||
			!this.view.dom.contains(event.relatedTarget)
		) {
			this.setCursor(null);
		}
	}
}
