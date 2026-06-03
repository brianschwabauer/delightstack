import type {
	DraggableOptions,
	Sortable,
	SortableSortEvent,
	SortableSortedEvent,
	SortableStartEvent,
	SortableStopEvent,
	DragStartEvent,
	DragStopEvent,
} from '@shopify/draggable';
import type { Attachment } from 'svelte/attachments';

type SortableOptions = DraggableOptions & {
	onSort?: (event: SortableSortEvent) => void;
	onSorted?: (event: SortableSortedEvent) => void;
	onSortStart?: (event: SortableStartEvent) => void;
	onSortStop?: (event: SortableStopEvent) => void;
	onDragStart?: (event: DragStartEvent) => void;
	onDragStop?: (event: DragStopEvent) => void;
};

/**
 * Adds drag/drop sorting to the element's children
 * @example
 * ```svelte
 * <div {@attach sortable({ onSort: () => {} })}></div>
 * ```
 */
export function sortable(options?: SortableOptions): Attachment<HTMLElement> {
	return (el: HTMLElement) => {
		let destroyed = false;
		let sortable: Sortable | undefined = undefined;

		(async () => {
			const { Sortable } = await import('@shopify/draggable');
			if (destroyed) return;
			sortable = new Sortable(el, {
				mirror: {
					constrainDimensions: true,
				},
				...options,
			});
			sortable.removePlugin(Sortable.Plugins.Focusable);
			if (options?.onSort) sortable.on('sortable:sort', options.onSort);
			if (options?.onSorted) sortable.on('sortable:sorted', options.onSorted);
			if (options?.onSortStart) sortable.on('sortable:start', options.onSortStart);
			if (options?.onSortStop) sortable.on('sortable:stop', options.onSortStop);
			if (options?.onDragStart) sortable.on('drag:start', options.onDragStart);
			if (options?.onDragStop) sortable.on('drag:stop', options.onDragStop);

			// Save the current order & positions of the items when they are sorted
			// This is used to animate the items to their new positions when they are sorted
			const containerSortElements = new WeakMap<
				HTMLElement,
				{
					el: HTMLElement;
					offsetTop: number;
					offsetLeft: number;
				}[]
			>();
			sortable.on('sortable:sort', (event) => {
				if (!sortable) return;
				const sourceContainer = event.dragEvent.sourceContainer;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const overContainer = (event.dragEvent as any).overContainer as
					| HTMLElement
					| undefined;
				const elements = sortable.getDraggableElementsForContainer(sourceContainer);
				containerSortElements.set(
					sourceContainer,
					elements.map((el) => {
						return {
							el,
							offsetTop: el.offsetTop,
							offsetLeft: el.offsetLeft,
						};
					}),
				);
				if (overContainer && overContainer !== sourceContainer) {
					const elements = sortable.getDraggableElementsForContainer(overContainer);
					containerSortElements.set(
						overContainer,
						elements.map((el) => {
							return {
								el,
								offsetTop: el.offsetTop,
								offsetLeft: el.offsetLeft,
							};
						}),
					);
				}
			});

			// Animate the "source" element to its new position when it is dragged
			// The source element is the element that shows where the item will be dropped
			let dragSourceLastX = 0;
			let dragSourceLastY = 0;
			sortable.on('sortable:sort', (event) => {
				dragSourceLastX = event.dragEvent.source.offsetLeft;
				dragSourceLastY = event.dragEvent.source.offsetTop;
			});
			sortable.on('sortable:sorted', (event) => {
				if (!sortable) return;
				const x = dragSourceLastX - event.dragEvent.source.offsetLeft;
				const y = dragSourceLastY - event.dragEvent.source.offsetTop;
				animateElement(event.dragEvent.source, x, y);
				const { oldIndex, newIndex, oldContainer } = event;

				if (oldIndex === newIndex) return;
				const elements = containerSortElements.get(oldContainer);
				if (!elements) return;
				let start;
				let end;
				let num;
				if (oldIndex > newIndex) {
					start = newIndex;
					end = oldIndex - 1;
					num = 1;
				} else {
					start = oldIndex + 1;
					end = newIndex;
					num = -1;
				}
				for (let i = start; i <= end; i++) {
					const from = elements[i];
					const to = elements[i + num];
					const distX = from.offsetLeft - to.offsetLeft;
					const distY = from.offsetTop - to.offsetTop;
					animateElement(from.el, distX, distY);
				}
			});

			// Animate the mirror element back to the target item when dropped
			sortable.on('mirror:destroy', async (event) => {
				const element = event.mirror;
				const target = event.source;
				if (!element) return;
				event.cancel();
				const elementRect = element.getBoundingClientRect();
				const targetRect = target.getBoundingClientRect();
				const distance = Math.hypot(
					targetRect.x - elementRect.x,
					targetRect.y - elementRect.y,
				);
				if (distance > 100) element.style.filter = 'blur(2px)';
				const animation = element.animate(
					[
						{
							transform: `translate3D(${elementRect.x}px, ${elementRect.y}px, 0px)`,
						},
						{
							transform: `translate3D(${targetRect.x}px, ${targetRect.y}px, 0px)`,
							opacity: 0.3,
						},
					],
					{ duration: 150, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' },
				);
				await animation.finished;
				element.remove();
			});
		})();

		return () => {
			destroyed = true;
			sortable?.destroy();
			sortable = undefined;
		};
	};
}

/** Animates the sortable element from the given x, y back to the origin (after being sorted) */
function animateElement(element: HTMLElement, x: number, y: number) {
	if (!element) return;
	element.getAnimations().forEach((animation) => {
		try {
			// animation.commitStyles();
			animation.cancel();
		} catch {
			// ignore
		}
	});
	element.style.pointerEvents = 'none';
	element
		.animate(
			[
				{
					transform: `translate3D(${x}px, ${y}px, 0px)`,
				},
				{ transform: `translate3D(0px, 0px, 0px)` },
			],
			{
				duration: 250,
				direction: 'normal',
				fill: 'forwards',
				easing: 'cubic-bezier(0.33, 1, 0.68, 1)',
			},
		)
		.finished.then((animation) => {
			try {
				// animation.commitStyles();
				animation.cancel();
			} catch {
				// ignore
			}
			if (element) element.style.removeProperty('pointer-events');
		})
		.catch(() => null);
}
