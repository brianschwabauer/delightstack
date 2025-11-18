import { dequal } from 'dequal/lite';
import type Selecto from 'selecto';
import { SvelteMap } from 'svelte/reactivity';
import { generateID } from '../helpers/id.helper.js';
import type { Attachment } from 'svelte/attachments';

export interface SelectionTarget {
	/** The type of item that is selected */
	type: 'media' | 'site' | 'project' | 'client' | 'mail' | 'invoice';
	/** The selection container (usually document.body) */
	container?: HTMLElement;
	/** The ID of the media that is selected */
	mediaID?: string;
	/** The ID of the site that this selection belongs to */
	siteID?: string;
	/** The ID of the project that this selection belongs to */
	projectID?: string;
	/** The ID of the client that this selection belongs to */
	clientID?: string;
	/** The ID of the mail that this selection belongs to */
	mailID?: string;
	/** The ID of the invoice that this selection belongs to */
	invoiceID?: string;
	/** The ID of the website section that this selection belongs to */
	sectionID?: string;
}

/**
 * Adds the ability to select children of the given element via a "drag" selection box
 * @example
 * ```svelte
 * <div {@attach selectable({ type: 'media', container: document.body })}></div>
 * ```
 */
export function selectable(
	options?: SelectionTarget & { enabledOn?: 'visible' | 'always' },
): Attachment<HTMLElement> {
	return (el: HTMLElement) => {
		if (!options) return;
		let manager = SelectionManager.from(options?.container || document.body);
		const opts = { ...options };
		delete opts.container;
		delete opts.enabledOn;

		const enabledOn = options?.enabledOn || 'visible';
		let intersectionObserver: IntersectionObserver | undefined = undefined;
		if (enabledOn === 'visible') {
			intersectionObserver = new IntersectionObserver((entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting) {
						manager.register(el, opts);
					} else if (!manager.isSelected(el)) {
						manager.unregister(el);
					}
				});
			});
			intersectionObserver.observe(el);
		} else {
			manager.register(el, opts);
		}
		return () => {
			manager.unregister(el);
			intersectionObserver?.disconnect();
		};
	};
}

export class SelectionManager {
	private selectionTargets = new SvelteMap<HTMLElement, SelectionTarget>();
	private selecto: Promise<Selecto | undefined> | undefined = undefined;
	private destroyed = false;
	#selection = $state.raw<SelectionTarget[]>([]);
	private id = generateID();

	/** The item that was last selected. Used to determine how multiple items should be selected after shift+clicking another item */
	#lastSelected: SelectionTarget | undefined = undefined;

	/** The current selection of items */
	get selection() {
		return this.#selection;
	}

	get lastSelected() {
		return this.#lastSelected;
	}

	/** The set of media ids of media items that are currently selected */
	get selectedMediaIDs() {
		return new Set<string>(
			this.#selection
				.filter((target) => target.type === 'media')
				.map((target) => target.mediaID)
				.filter(Boolean) as string[],
		);
	}

	/** The set of project ids of projects that are currently selected */
	get selectedProjectIDs() {
		return new Set<string>(
			this.#selection
				.filter((target) => target.type === 'project')
				.map((target) => target.projectID)
				.filter(Boolean) as string[],
		);
	}

	/** The set of client ids of clients that are currently selected */
	get selectedClientIDs() {
		return new Set<string>(
			this.#selection
				.filter((target) => target.type === 'client')
				.map((target) => target.clientID)
				.filter(Boolean) as string[],
		);
	}

	/** The set of site ids of sites that are currently selected */
	get selectedSiteIDs() {
		return new Set<string>(
			this.#selection
				.filter((target) => target.type === 'site')
				.map((target) => target.siteID)
				.filter(Boolean) as string[],
		);
	}

	/** The set of mail ids of mails that are currently selected */
	get selectedMailIDs() {
		return new Set<string>(
			this.#selection
				.filter((target) => target.type === 'mail')
				.map((target) => target.mailID)
				.filter(Boolean) as string[],
		);
	}

	/** The set of invoice ids of invoices that are currently selected */
	get selectedInvoiceIDs() {
		return new Set<string>(
			this.#selection
				.filter((target) => target.type === 'invoice')
				.map((target) => target.invoiceID)
				.filter(Boolean) as string[],
		);
	}

	constructor(protected container: HTMLElement) {}

	/** Registers an element that can be selected and attaches the appropriate metadata that can be retrieved later */
	register(element: HTMLElement, target: SelectionTarget) {
		const data = { ...target };
		delete data.container;
		this.selectionTargets.set(element, data);
		this.destroyed = false;
		this.init();
	}

	/** Removes an element from the list of elements that can be selected by this selection manager */
	unregister(element: HTMLElement) {
		this.markNotSelected(element);
		this.selectionTargets.delete(element);
		if (!this.selectionTargets.size) this.destroy();
	}

	/** Checks if the given element (or selection target) is currently selected */
	isSelected(target: HTMLElement | SelectionTarget) {
		const selectionTarget =
			target instanceof HTMLElement ? this.selectionTargets.get(target) : target;
		return (
			selectionTarget &&
			this.#selection.some((t) => SelectionManager.isTargetEqual(t, selectionTarget))
		);
	}

	/** Returns whether the two selection targets are equal */
	static isTargetEqual(a?: SelectionTarget, b?: SelectionTarget) {
		if (!a || !b) return false;
		const aSanitized = { ...a };
		const bSanitized = { ...b };
		delete aSanitized.container;
		delete bSanitized.container;
		return dequal(aSanitized, bSanitized);
	}

	/** Toggles the selection of the given element (or selection target) */
	toggleSelected(target: HTMLElement | SelectionTarget) {
		const selectionTarget =
			target instanceof HTMLElement ? this.selectionTargets.get(target) : target;
		if (!selectionTarget) return;
		if (this.isSelected(selectionTarget)) {
			this.markNotSelected(selectionTarget);
		} else {
			this.markSelected(selectionTarget);
		}
	}

	/** Marks the given element (or selection target) as currently selected */
	markSelected(target: HTMLElement | SelectionTarget) {
		const selectionTarget =
			target instanceof HTMLElement ? this.selectionTargets.get(target) : target;
		if (!selectionTarget || this.isSelected(selectionTarget)) return;
		this.#selection = [...this.#selection, selectionTarget];
		this.syncSelection();
		this.#lastSelected = selectionTarget;
	}

	/** Marks the given element (or selection target) as currently not selected */
	markNotSelected(target: HTMLElement | SelectionTarget) {
		const selectionTarget =
			target instanceof HTMLElement ? this.selectionTargets.get(target) : target;
		if (selectionTarget) delete selectionTarget.container;
		this.#selection = this.#selection.filter(
			(t) => !SelectionManager.isTargetEqual(t, selectionTarget),
		);
		this.syncSelection();
		this.#lastSelected = this.#selection[this.#selection.length - 1];
	}

	/** Sets the current selection to the given targets. Overrides the current selection */
	setSelection(targets: (HTMLElement | SelectionTarget)[]) {
		this.#selection = targets
			.map((target) => {
				if (target instanceof HTMLElement) return this.selectionTargets.get(target);
				const data = { ...target };
				delete data.container;
				return data;
			})
			.filter(Boolean) as SelectionTarget[];
		this.syncSelection();
		this.#lastSelected = this.#selection[this.#selection.length - 1];
	}

	/** Clears the current selection */
	clearSelection() {
		this.#selection = [];
		this.syncSelection();
		this.#lastSelected = undefined;
	}

	/** Selects all items that are currently registered with this selection manager */
	selectAll() {
		this.#selection = [...this.selectionTargets.values()];
		this.syncSelection();
		this.#lastSelected = this.#selection[this.#selection.length - 1];
	}

	/** Returns the selection of items that match the given selection target */
	getSelection(matches?: Partial<SelectionTarget>) {
		if (!matches) return this.#selection;
		return this.#selection.filter((target) => {
			for (const key in matches) {
				if (
					target[key as keyof SelectionTarget] !== matches[key as keyof SelectionTarget]
				) {
					return false;
				}
			}
			return true;
		});
	}

	/** Destroys the selection manager and removes all event listeners */
	async destroy(permanent = false) {
		this.destroyed = true;
		this.#selection = [];
		if (permanent) SelectionManager.activeManagers.delete(this.container);
		const selecto = this.selecto;
		this.selecto = undefined;
		document.getElementById(this.id)?.remove();
		(await selecto)?.destroy();
	}

	/** Updates the selecto's selection to match the current selection (that was updated elsewhere) */
	private async syncSelection() {
		this.selectionTargets.forEach((target, el) => {
			if (this.#selection.some((t) => SelectionManager.isTargetEqual(t, target))) {
				el.classList.add('selected');
			} else {
				el.classList.remove('selected');
			}
		});
		const selecto = await this.selecto;
		if (!selecto) return;
		selecto.setSelectedTargets(
			this.#selection
				.map((target) => {
					const el = [...this.selectionTargets].find(([_, t]) =>
						SelectionManager.isTargetEqual(t, target),
					);
					return el ? el[0] : null;
				})
				.filter(Boolean) as HTMLElement[],
		);
	}

	/** A list of selection managers that are actively listening for selections */
	private static activeManagers = new Map<HTMLElement, SelectionManager>();

	/** Gets the SelectionManager instance of the given container element (or creates a new one if necessary) */
	static from(container: HTMLElement) {
		let manager = this.activeManagers.get(container);
		if (!manager) {
			manager = new SelectionManager(container);
			this.activeManagers.set(container, manager);
		}
		return manager;
	}

	/** Initializes the selecto class if necessary */
	private init() {
		if (this.selecto || this.destroyed) return;
		this.selecto = (async () => {
			const Selecto = await import('selecto').then((m) => m.default);
			if (this.destroyed) return;
			let portalContainer = document.getElementById(this.id) as HTMLElement;
			if (!portalContainer) {
				portalContainer = document.createElement('div');
				portalContainer.id = this.id;
				document.body.appendChild(portalContainer);
			}
			const selecto = new Selecto({
				selectableTargets: [() => Array.from(this.selectionTargets.keys())],
				container: document.body,
				selectByClick: false,
				selectFromInside: false,
				toggleContinueSelect: [['meta'], ['ctrl'], ['shift']],
				toggleContinueSelectWithoutDeselect: [['shift']],
				preventClickEventOnDrag: false,
				preventClickEventOnDragStart: false,
				preventDefault: false,
				checkInput: true,
				preventDragFromInside: true,
				hitRate: '10px',
				portalContainer,
				scrollOptions: {
					container: this.container,
					threshold: 0,
					throttleTime: 60,
				},
				dragCondition: (e) => {
					if (!e.isMouseEvent) return false;
					const event = e.currentTarget.getCurrentEvent();
					let target = event.inputEvent?.target as HTMLElement;
					let modalEl = null;

					// Don't drag if the alt key is down.
					// This is here to allow the ALT+X sveltekit tools shortcut to work
					if (e.inputEvent?.altKey) return false;

					// Don't allow selection if the target is an input, button, or link
					while (target) {
						if (
							target.tagName === 'A' ||
							target.tagName === 'BUTTON' ||
							target.tagName === 'INPUT' ||
							target.tagName === 'TEXTAREA' ||
							target.tagName === 'LABEL' ||
							target.tagName === 'VIDEO' ||
							target.role === 'button' ||
							target.role === 'switch' ||
							target.classList.contains('select') ||
							target.classList.contains('toggle') ||
							target.classList.contains('fieldset') ||
							target.classList.contains('video') ||
							target.classList.contains('vds-video-layout') ||
							target.classList.contains('no-select') ||
							target.classList.contains('input')
						) {
							return false;
						}
						if (
							target.classList.contains('modal') ||
							target.classList.contains('portal')
						) {
							modalEl = target;
						}
						target = target.parentElement as HTMLElement;
					}

					// If the selection starts in a modal, we need to make sure the container element is
					// in the same modal component before allowing the selection
					if (modalEl) {
						target = this.container as HTMLElement;
						while (target) {
							if (target === modalEl) return true;
							target = target.parentElement as HTMLElement;
						}
						return false;
					}
					return true;
				},
			});
			selecto.on('dragStart', () => {
				this.container.style.pointerEvents = 'none';
				this.container.style.userSelect = 'none';
			});
			selecto.on('dragEnd', () => {
				this.container.style.removeProperty('pointer-events');
				this.container.style.removeProperty('user-select');
			});
			selecto.on('scroll', ({ direction }) => {
				const scrollElement =
					this.container === document.body || this.container === document.documentElement
						? window
						: this.container;
				scrollElement.scrollBy({
					behavior: 'smooth',
					left: direction[0] * 50,
					top: direction[1] * 50,
				});
			});
			selecto.on('select', (e) => {
				e.added.forEach((el) => {
					if (!el) return;
					const target = this.selectionTargets.get(el as HTMLElement);
					if (target) el.classList.add('selected');
					if (target && !this.isSelected(target)) this.#selection.push(target);
				});
				e.removed.forEach((el) => {
					if (!el) return;
					const target = this.selectionTargets.get(el as HTMLElement);
					if (target) el.classList.remove('selected');
					if (target) {
						this.#selection = this.#selection.filter(
							(t) => !SelectionManager.isTargetEqual(t, target),
						);
					}
				});
				this.#selection = this.#selection.filter((target) => {
					const wasRemoved = e.removed.some((el) => {
						const t = this.selectionTargets.get(el as HTMLElement);
						return t && SelectionManager.isTargetEqual(t, target);
					});
					return !wasRemoved;
				});
				this.#lastSelected = this.#selection[this.#selection.length - 1];
			});
			return selecto;
		})();
	}
}
