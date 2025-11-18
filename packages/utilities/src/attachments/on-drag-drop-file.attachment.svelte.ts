import type { Attachment } from 'svelte/attachments';

export interface DragDropActionOptions {
	/** A callback function that is called when a file is currently being dragged over the element */
	onDrag?: (isDragging: boolean) => void;

	/** A callback function that provides the dropped files */
	onDrop: (files: File[], event: DragEvent) => void;

	/**
	 * The list of file mime types to accept
	 * Wildcards are allowed. For example, `image/*` will accept any image file. '*' will accept any file
	 */
	fileTypes?: string[];

	/** The text to show when a file is about to be dropped on the element @defaults to 'Upload Files' */
	label?: string;

	/** Whether the drag & drop listener is enabled. @defaults true */
	enabled?: boolean;
}

export interface DragDropListener {
	/** The element of the component that handles when these files are dropped on it */
	element: HTMLElement;

	/** The listener that the files will be dropped to (if the user drops the file). This changes on drag */
	isActive: boolean;

	/** A callback function that is called when a file is currently being dragged over the element */
	onDrag?: (isDragging: boolean) => void;

	/** A callback function that provides the dropped files */
	onDrop: (files: File[], event: DragEvent) => void;

	/**
	 * The list of file mime types to accept
	 * Wildcards are allowed. For example, `image/*` will accept any image file. '*' will accept any file
	 */
	fileTypes: string[];

	/** The cached bounding client rect of the listener element */
	bounds: DOMRect;

	/** The cached border radius of the listener element */
	borderRadius: string;

	/** The text to show when a file is about to be dropped on the element @defaults to 'Upload Files' */
	label: string;
}

let hasEventListener = false;

/** The list of active drag & drop listeners */
let dragDropListeners: DragDropListener[] = [];

/** The DOM element used to show which element will receive the 'drop' when the drag has finished */
let dragDropIndicator: HTMLElement | undefined;

/**
 * Adds the given element as a drag & drop target for files
 * When a user drag & drops files onto the window, this will determine which drag & drop listener should handle the dropped files
 * The dropped files are then passed to the `onDrop` callback
 * @example
 * ```svelte
 * <div {@attach onDragDropFile({ onDrop: (files) => console.log(files) })}>
 * ```
 */
export function onDragDropFile(options: DragDropActionOptions): Attachment<HTMLElement> {
	function update(el: HTMLElement) {
		const listener = dragDropListeners.find((l) => l.element === el);
		if (listener) {
			if (options.onDrop) listener.onDrop = options.onDrop;
			if (options.onDrag) listener.onDrag = options.onDrag;
			if (options.fileTypes) listener.fileTypes = options.fileTypes;
			if (options.label) listener.label = options.label;
			return;
		}
		dragDropListeners.push({
			element: el,
			isActive: false,
			fileTypes: options.fileTypes ?? ['video/*', 'image/*', 'application/pdf'],
			onDrag: options.onDrag,
			onDrop: options.onDrop,
			bounds: el.getBoundingClientRect(),
			borderRadius: window.getComputedStyle(el).borderRadius,
			label: options.label ?? 'Upload Files',
		});
		if (!hasEventListener) {
			document.addEventListener('dragenter', onDragEnter);
			hasEventListener = true;
		}
	}

	function destroy(el: HTMLElement) {
		const index = dragDropListeners.findIndex((l) => l.element === el);
		if (index !== -1) dragDropListeners.splice(index, 1);
		if (!dragDropListeners.length) {
			document.removeEventListener('dragenter', onDragEnter);
			hasEventListener = false;
		} else {
			dragDropListeners = dragDropListeners.filter(
				(listener) => listener.element.isConnected,
			);
		}
	}

	return (el) => {
		if (options.enabled === false) destroy(el);
		if (options.enabled !== false) update(el);
		return () => destroy(el);
	};
}

/** Updates the drag effect to show which element the file will be dropped on */
function updateDragEffect() {
	const previousListener = dragDropListeners.find(({ element }) =>
		element.classList.contains('drag-drop-active'),
	);
	const listener = dragDropListeners.find(({ isActive }) => isActive);
	if (previousListener) previousListener.element.classList.remove('drag-drop-active');
	if (!listener) {
		if (dragDropIndicator) dragDropIndicator.style.opacity = '0';
		return;
	}
	if (previousListener === listener) return;
	if (!dragDropIndicator) {
		dragDropIndicator = document.createElement('div');
		dragDropIndicator.className = 'drag-drop-indicator';
		dragDropIndicator.style.position = 'fixed';
		dragDropIndicator.style.zIndex = '999999';
		dragDropIndicator.style.outline = '3px dashed rgba(var(--contrast-rgb-high) / 1)';
		dragDropIndicator.style.outlineOffset = '4px';
		dragDropIndicator.style.pointerEvents = 'none';
		dragDropIndicator.style.opacity = '0';
		dragDropIndicator.style.backgroundColor = 'rgba(var(--contrast-rgb-high) / .5)';
		dragDropIndicator.style.backdropFilter = 'blur(5px)';
		dragDropIndicator.style.color = 'rgba(var(--contrast-rgb-low) / .8)';
		dragDropIndicator.style.display = 'flex';
		dragDropIndicator.style.flexDirection = 'column';
		dragDropIndicator.style.transition = 'opacity 150ms ease';
		dragDropIndicator.style.alignItems = 'center';
		dragDropIndicator.style.justifyContent = 'center';
		dragDropIndicator.style.fontWeight = 'bold';
		dragDropIndicator.style.padding = '1rem';
		dragDropIndicator.role = 'presentation';
		dragDropIndicator.innerHTML = `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M11 20H6.5q-2.28 0-3.89-1.57Q1 16.85 1 14.58q0-1.95 1.17-3.48q1.18-1.53 3.08-1.95q.63-2.3 2.5-3.72Q9.63 4 12 4q2.93 0 4.96 2.04Q19 8.07 19 11q1.73.2 2.86 1.5q1.14 1.28 1.14 3q0 1.88-1.31 3.19T18.5 20H13v-7.15l1.6 1.55L16 13l-4-4l-4 4l1.4 1.4l1.6-1.55Z"/></svg><span>Upload Files</span>`;
		const icon = dragDropIndicator.querySelector('.icon') as SVGElement;
		icon.style.width = 'max(2rem, min(4rem, 15%))';
		icon.style.height = 'auto';
		icon.style.aspectRatio = '1';
		icon.animate(
			[
				{ transform: 'scale(1,1) translateY(0)' },
				{ transform: 'scale(1.2,.8) translateY(0)', offset: 0.15 },
				{ transform: 'scale(.7,1.3) translateY(-60%)', offset: 0.4 },
				{ transform: 'scale(1.05,.95) translateY(10%)', offset: 0.7 },
				{ transform: 'scale(1,1) translateY(0)', offset: 1 },
			],
			{
				iterations: Infinity,
				duration: 750,
				easing: 'cubic-bezier(0.280, 0.840, 0.420, 1)',
			},
		);
		document.body.appendChild(dragDropIndicator);
	}
	const textEl = dragDropIndicator.querySelector('span');
	if (textEl) textEl.innerText = listener.label;
	dragDropIndicator.style.left = listener.bounds.left + 'px';
	dragDropIndicator.style.top = listener.bounds.top + 'px';
	dragDropIndicator.style.width =
		Math.min(window.innerWidth, listener.bounds.width) + 'px';
	dragDropIndicator.style.height =
		Math.min(window.innerHeight, listener.bounds.height) + 'px';
	dragDropIndicator.style.opacity = '1';
	dragDropIndicator.style.lineHeight = '1.2';
	dragDropIndicator.style.gap = '0 1rem';
	if (listener.bounds.width < 100 || listener.bounds.height < 100) {
		dragDropIndicator.style.flexDirection = 'row';
		dragDropIndicator.style.fontSize = '1rem';
	} else {
		dragDropIndicator.style.flexDirection = 'column';
		dragDropIndicator.style.fontSize = `${Math.max(16, Math.min(35, listener.bounds.width * 0.075))}px`;
	}
	if (
		listener.bounds.width >= window.innerWidth - 20 &&
		listener.bounds.height >= window.innerHeight - 20
	) {
		dragDropIndicator.style.outlineOffset = '-16px';
		dragDropIndicator.style.outlineColor = 'rgba(var(--contrast-rgb-low) / 1)';
		dragDropIndicator.style.outlineWidth = '5px';
		dragDropIndicator.style.borderRadius = '0px';
	} else {
		dragDropIndicator.style.outlineOffset = '4px';
		dragDropIndicator.style.outlineColor = 'rgba(var(--contrast-rgb-high) / 1)';
		dragDropIndicator.style.outlineWidth = '3px';
		dragDropIndicator.style.borderRadius = `max(10px, ${listener.borderRadius})`;
	}
}

/** Returns the modal element that the given modal element belongs to (or undefined if the element is not in a modal) */
function getModalElement(element?: HTMLElement | null) {
	if (!element) return;
	let el = element;
	while (el) {
		if (el.classList.contains('modal')) return el;
		if (el.classList.contains('modal-bg')) return el;
		if (el.role === 'dialog') return el;
		if (el.classList.contains('modal-container')) return el;
		if (el.classList.contains('portal')) return el;
		el = el.parentElement as HTMLElement;
	}
}

// Determine the active option by the priority & proximity to cursor
function getActiveListener(event: DragEvent) {
	if (!event.dataTransfer || !event.dataTransfer.types.includes('Files')) return;
	const eventFileTypes = Array.from(event.dataTransfer.items).map((item) => item.type);
	const options = dragDropListeners
		.filter((listener) => {
			const targetModal = getModalElement(event.target as HTMLElement);
			const listenerModal = getModalElement(listener.element);
			if (targetModal) return targetModal === listenerModal;

			// Only allow the listener if the element is connected, the file types match, and the element is in the viewport
			return (
				listener.element?.isConnected &&
				listener.fileTypes.some(
					(type) =>
						type.startsWith('*') ||
						eventFileTypes.some((eventFileType) =>
							eventFileType.startsWith(type.replace(/\/\*$/, '')),
						),
				) &&
				listener.bounds &&
				listener.bounds.bottom > 0 &&
				listener.bounds.top < window.innerHeight
			);
		})
		.filter((listener, i, array) => {
			// Remove any listeners that are the parent of another listener
			return !array.some((otherListener) => {
				if (otherListener === listener) return false;
				return listener.element.contains(otherListener.element);
			});
		});
	if (options.length <= 1) return options[0];

	// First check if the event target is a child of the drag & drop listener
	let el = event.target as HTMLElement | null;
	while (el) {
		const listener = options.find((option) => option.element === el);
		if (listener) return listener;
		el = el.parentElement;
	}

	// If not, determine the closest listener to the cursor
	let shortestDistance = Infinity;
	let closestOption: DragDropListener | undefined = undefined;
	options.forEach((option) => {
		const distance = Math.min(
			Math.hypot(option.bounds.left - event.clientX, option.bounds.top - event.clientY),
			Math.hypot(option.bounds.right - event.clientX, option.bounds.top - event.clientY),
			Math.hypot(
				option.bounds.left - event.clientX,
				option.bounds.bottom - event.clientY,
			),
			Math.hypot(
				option.bounds.right - event.clientX,
				option.bounds.bottom - event.clientY,
			),
		);
		if (distance < shortestDistance) {
			closestOption = option;
			shortestDistance = distance;
		}
	});
	return closestOption || options[0];
}

/** Handles when the drag/drop is canceled (by leaving the document without dropping) */
function onDragLeave(event: DragEvent) {
	if (event.relatedTarget) return;
	dragDropListeners.forEach((listener) => {
		if (listener.onDrag && listener.isActive) listener.onDrag(false);
		listener.isActive = false;
	});
	updateDragEffect();
	document.removeEventListener('dragover', onDragOver);
	document.removeEventListener('dragleave', onDragLeave);
	document.removeEventListener('drop', onDrop);
	event.preventDefault();
	event.stopPropagation();
}

/** Handles when a user finishes the drag/drop and drops the file on the document */
function onDrop(event: DragEvent) {
	const activeListener = getActiveListener(event);
	dragDropListeners.forEach((listener) => {
		if (listener.onDrag && listener.isActive) listener.onDrag(false);
		listener.isActive = false;
	});
	updateDragEffect();
	document.removeEventListener('dragover', onDragOver);
	document.removeEventListener('dragleave', onDragLeave);
	document.removeEventListener('drop', onDrop);
	event.preventDefault();
	event.stopPropagation();
	if (!activeListener) return;
	getDragDropFiles(event, activeListener.fileTypes).then((files) =>
		activeListener.onDrop(files, event),
	);
}

/** Handles when the user is dragging a file over the document */
function onDragOver(event: DragEvent) {
	if (!event.dataTransfer) return;
	event.dataTransfer.dropEffect = 'copy';
	event.preventDefault();
	event.stopPropagation();
	const activeListener = getActiveListener(event);
	dragDropListeners.forEach((listener) => {
		if (listener === activeListener) {
			listener.isActive = true;
			if (listener.onDrag && !listener.isActive) listener.onDrag(true);
		} else {
			if (listener.onDrag && listener.isActive) listener.onDrag(false);
			listener.isActive = false;
		}
	});
	updateDragEffect();
}

/** Handles when a drag starts over the document element */
function onDragEnter(event: DragEvent) {
	if (event.relatedTarget || ('fromElement' in event && event.fromElement)) return;
	if (!event.dataTransfer || !event.dataTransfer.types.includes('Files')) return;
	dragDropListeners.forEach((listener) => {
		listener.bounds = listener.element.getBoundingClientRect();
		listener.borderRadius = window.getComputedStyle(listener.element).borderRadius;
	});
	document.addEventListener('dragover', onDragOver);
	document.addEventListener('dragleave', onDragLeave);
	document.addEventListener('drop', onDrop);
	event.dataTransfer.dropEffect = 'copy';
	event.preventDefault();
	event.stopPropagation();
	event.dataTransfer.setDragImage(document.createElement('img'), 0, 0);

	const activeListener = getActiveListener(event);
	dragDropListeners.forEach((listener) => {
		if (listener === activeListener) {
			listener.isActive = true;
			if (listener.onDrag) listener.onDrag(true);
		} else {
			if (listener.onDrag && listener.isActive) listener.onDrag(false);
			listener.isActive = false;
		}
	});
	updateDragEffect();
}

/**
 * Given a drag/drop event, this returns a promise of a list of the dropped files
 * If mimeTypes are provided, it will only return the files that match the given mime types
 * Mime types are in the format of `image/*`, `video/*`, `application/pdf`, etc
 */
async function getDragDropFiles(event: DragEvent, mimeTypes?: string[]): Promise<File[]> {
	if (!event?.dataTransfer?.items?.length && !event.dataTransfer?.files?.length) {
		return [];
	}
	const fileList = event.dataTransfer.items
		? Array.from(event.dataTransfer.items)
		: Array.from(event.dataTransfer.files);
	const files: File[] = [];

	// Loop through the files/folders a part of the drag/drop event
	for (const item of fileList) {
		if (!item) continue;
		if ('webkitGetAsEntry' in item) {
			const entry = item.webkitGetAsEntry();
			if (entry) {
				if (entry.isDirectory) {
					files.push(...(await getFolderFiles(entry)));
				} else {
					files.push(item.getAsFile()!);
				}
			}
		} else if (item instanceof File) {
			files.push(item);
		} else {
			const file = (item as DataTransferItem).getAsFile();
			if (file) files.push(file);
		}
	}
	return files.filter((file) => {
		if (!mimeTypes) return true;
		return mimeTypes.some(
			(type) => type.startsWith('*') || file.type.startsWith(type.replace(/\/\*$/, '')),
		);
	});
}

/**
 * Tranverse through the folder recursively to find the files. Emits the found files
 * A max search depth of - 1 means it will search all folders
 * A max search depth of 0 means it will only include files in the given folder
 */
async function getFolderFiles(
	folder: FileSystemEntry,
	maxDepth = 0,
	currentDepth = 0,
): Promise<File[]> {
	if (!folder) return [];
	return new Promise((resolve) => {
		if (folder.isFile) {
			(folder as FileSystemFileEntry).file((file) => resolve([file]));
			return;
		}
		let files: File[] = [];
		const dirReader = (folder as FileSystemDirectoryEntry).createReader();
		dirReader.readEntries(async (entries) => {
			if (!entries.length) return resolve([]);
			for (const entry of entries) {
				if (!entry) continue;
				if (entry.isFile) {
					await new Promise<void>((r) => {
						(entry as FileSystemFileEntry).file((file) => {
							files.push(file);
							r();
						});
					});
				} else if (maxDepth === -1 || maxDepth > currentDepth) {
					const folderFiles = await getFolderFiles(entry, maxDepth, currentDepth + 1);
					files = [...files, ...folderFiles];
				}
			}
			resolve(files);
		});
	});
}
