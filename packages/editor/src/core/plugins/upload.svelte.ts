import { Plugin, PluginKey } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { UploadKind, UploadResult, Uploader } from '../../types/index.js';
import type { Editor } from '../editor.svelte.js';
import { createBlockId } from './block-id.js';

export const uploadKey = new PluginKey('uploads');

/** Node names used for each upload kind (when present in the schema). */
const KIND_NODES: Record<UploadKind, string> = {
	image: 'image',
	video: 'video',
	audio: 'audio',
	file: 'file',
};

interface ActiveUpload {
	upload_id: string;
	kind: UploadKind;
	controller: AbortController;
	blob_url: string;
}

/**
 * Optimistic upload orchestration:
 * 1. A REAL placeholder node (`uploading: true`, `upload_id`, `blob_url`) is
 *    inserted immediately — ProseMirror maps it through edits/moves/undo for
 *    free, so no manual position bookkeeping.
 * 2. The file uploads in the background with reactive progress
 *    (`editor.uploads`).
 * 3. On success the node is found by `upload_id` and its attrs swapped in
 *    place with `addToHistory: false` (undo never restores a placeholder).
 * 4. Deleting the node mid-upload aborts the request (appendTransaction
 *    watcher). Failures flip the node to an error state with retry/remove.
 */
export function uploads(editor: Editor): Plugin {
	const active = new Map<string, ActiveUpload>();
	// Final attrs of finished uploads, kept so undo→redo across a completed
	// upload can restore the real content instead of a dead placeholder
	const completed = new Map<string, Record<string, unknown>>();

	function detectKind(file: File): UploadKind {
		for (const block of editor.blocks.values()) {
			if (block.paste?.match_file?.(file)) return block.upload_kind ?? 'file';
		}
		if (file.type.startsWith('image/')) return 'image';
		if (file.type.startsWith('video/')) return 'video';
		if (file.type.startsWith('audio/')) return 'audio';
		return 'file';
	}

	function nodeTypeFor(kind: UploadKind) {
		const name = KIND_NODES[kind];
		return editor.schema.nodes[name] ?? editor.schema.nodes.file ?? null;
	}

	function findByUploadId(upload_id: string): { node: PMNode; pos: number } | null {
		let found: { node: PMNode; pos: number } | null = null;
		editor.state.doc.descendants((node, pos) => {
			if (found) return false;
			if (node.attrs.upload_id === upload_id) found = { node, pos };
			return !found;
		});
		return found;
	}

	function patchNode(
		upload_id: string,
		patch: Record<string, unknown>,
		history = false,
	): void {
		const found = findByUploadId(upload_id);
		if (!found) return;
		const tr = editor.state.tr
			.setNodeMarkup(found.pos, null, { ...found.node.attrs, ...patch })
			.setMeta('addToHistory', history);
		editor.dispatch(tr);
	}

	function setProgress(upload_id: string, progress: number): void {
		const entry = editor.uploads.find((upload) => upload.upload_id === upload_id);
		if (entry) entry.progress = progress;
	}

	function finish(upload_id: string): void {
		const entry = active.get(upload_id);
		if (entry) {
			// Give the swapped-in real source a beat to paint before the blob
			// preview disappears
			setTimeout(() => URL.revokeObjectURL(entry.blob_url), 1000);
		}
		active.delete(upload_id);
		editor.uploads = editor.uploads.filter((upload) => upload.upload_id !== upload_id);
	}

	async function start(
		file: File,
		kind: UploadKind,
		upload_id: string,
		blob_url: string,
		controller: AbortController,
	) {
		const uploader = editor.uploader as Uploader;

		// Probe media dimensions for layout stability while uploading
		if (kind === 'image') {
			probeImage(blob_url).then((size) => {
				if (!size || !active.has(upload_id)) return;
				patchNode(upload_id, {
					width: size.width,
					height: size.height,
					aspect_ratio: size.width / size.height,
				});
			});
		} else if (kind === 'video') {
			probeVideo(blob_url).then((size) => {
				if (!size || !active.has(upload_id)) return;
				patchNode(upload_id, { aspect_ratio: size.width / size.height });
			});
		}

		try {
			const result = await uploader.upload(file, {
				kind,
				signal: controller.signal,
				on_progress: (fraction) => setProgress(upload_id, fraction),
			});
			if (!active.has(upload_id)) return; // node was deleted mid-upload
			const attrs = completedAttrs(kind, file, result);
			completed.set(upload_id, attrs);
			patchNode(upload_id, attrs);
			finish(upload_id);
		} catch (error) {
			if (controller.signal.aborted || !active.has(upload_id)) {
				finish(upload_id);
				return;
			}
			const message = error instanceof Error ? error.message : 'Upload failed';
			const entry = editor.uploads.find((upload) => upload.upload_id === upload_id);
			if (entry) entry.error = message;
			patchNode(upload_id, { upload_error: message });
		}
	}

	/**
	 * Snaps a raw drop position to the nearest top-level block boundary so a
	 * file dropped onto the middle of a sentence doesn't split the sentence.
	 */
	function blockBoundary(pos: number): number {
		const resolved = editor.state.doc.resolve(pos);
		if (resolved.depth === 0) return pos;
		const before = resolved.before(1);
		const after = resolved.after(1);
		return pos - before < after - pos ? before : after;
	}

	function uploadFiles(files: File[], pos?: number): void {
		if (!editor.uploader) return;
		let insertAt = pos === undefined ? undefined : blockBoundary(pos);
		for (const file of files) {
			const kind = detectKind(file);
			const type = nodeTypeFor(kind);
			if (!type) continue;
			const upload_id = createBlockId();
			const blob_url = URL.createObjectURL(file);
			const attrs: Record<string, unknown> = {
				uploading: true,
				upload_id,
				blob_url,
				name: file.name,
				size: file.size,
				mime: file.type,
			};
			// Only pass attrs the node type declares
			const declared = Object.fromEntries(
				Object.entries(attrs).filter(
					([key]) => type.spec.attrs && key in type.spec.attrs,
				),
			);
			// Register BEFORE inserting: the placeholder must never be visible
			// while unknown to the watcher, or the orphan sweep in
			// appendTransaction would flag it as interrupted
			const controller = new AbortController();
			active.set(upload_id, { upload_id, kind, controller, blob_url });
			editor.uploads.push({
				upload_id,
				kind,
				file_name: file.name,
				progress: 0,
				error: null,
			});
			if (!editor.insertBlock(type.name, declared, insertAt)) {
				active.delete(upload_id);
				editor.uploads = editor.uploads.filter(
					(upload) => upload.upload_id !== upload_id,
				);
				URL.revokeObjectURL(blob_url);
				continue;
			}
			if (insertAt !== undefined) {
				// Inserted at a block boundary, so the node sits exactly there;
				// advance past it for the next file
				const node = editor.state.doc.nodeAt(insertAt);
				insertAt += node?.nodeSize ?? 0;
			} else {
				// Inserted at the selection, which insertNode leaves ON the fresh
				// placeholder — inserting the next file there would REPLACE it
				// (aborting its upload). Switch to explicit positions after the
				// placeholder for the remaining files.
				const found = findByUploadId(upload_id);
				if (found) insertAt = found.pos + found.node.nodeSize;
			}
			void start(file, kind, upload_id, blob_url, controller);
		}
	}

	editor.setUploadHandler(uploadFiles);

	return new Plugin({
		key: uploadKey,
		props: {
			handleDrop(view, event) {
				const files = filesFrom(event.dataTransfer);
				if (!files.length || !editor.uploader) return false;
				event.preventDefault();
				const drop = view.posAtCoords({ left: event.clientX, top: event.clientY });
				uploadFiles(files, drop?.pos);
				return true;
			},
			handlePaste(_view, event) {
				const files = filesFrom(event.clipboardData);
				if (!files.length || !editor.uploader) return false;
				event.preventDefault();
				uploadFiles(files);
				return true;
			},
		},
		appendTransaction(transactions, oldState, newState) {
			if (!transactions.some((tr) => tr.docChanged)) return null;
			const present = new Set<string>();
			// Placeholders with no live upload behind them (undo→redo across an
			// in-flight or finished upload re-inserts the placeholder version)
			const orphans: { pos: number; node: PMNode }[] = [];
			newState.doc.descendants((node, pos) => {
				if (typeof node.attrs.upload_id !== 'string') return true;
				present.add(node.attrs.upload_id);
				if (node.attrs.uploading && !active.has(node.attrs.upload_id)) {
					orphans.push({ pos, node });
				}
				return true;
			});
			// Abort uploads whose placeholder node was deleted
			for (const [upload_id, entry] of active) {
				if (present.has(upload_id)) continue;
				entry.controller.abort();
				URL.revokeObjectURL(entry.blob_url);
				active.delete(upload_id);
				editor.uploads = editor.uploads.filter(
					(upload) => upload.upload_id !== upload_id,
				);
			}
			if (!orphans.length) return null;
			// Restore finished uploads to their real attrs; anything else has
			// no request behind it anymore — surface an error instead of a
			// forever-stuck progress state
			const tr = newState.tr.setMeta('addToHistory', false);
			for (const { pos, node } of orphans) {
				const upload_id = node.attrs.upload_id as string;
				const patch = completed.get(upload_id) ?? {
					uploading: false,
					upload_id: null,
					blob_url: null,
					upload_error: 'Upload interrupted — remove and try again',
				};
				tr.setNodeMarkup(pos, null, { ...node.attrs, ...patch });
			}
			return tr;
		},
	});
}

function completedAttrs(
	kind: UploadKind,
	file: File,
	result: UploadResult,
): Record<string, unknown> {
	const done = { uploading: false, upload_id: null, blob_url: null, upload_error: null };
	if (kind === 'image' && result.image) {
		const image = result.image;
		return {
			...done,
			src: image.src ?? result.url ?? '',
			srcset: image.srcset ?? null,
			image_id: image.id,
			width: image.width,
			height: image.height,
			aspect_ratio:
				image.aspect_ratio ?? (image.height ? image.width / image.height : null),
			thumbhash: image.thumbhash ?? null,
			background_color: image.background_color ?? null,
			alt: image.alt ?? '',
		};
	}
	const info = result.file;
	return {
		...done,
		src: info?.url ?? result.url ?? '',
		name: info?.name ?? file.name,
		size: info?.size ?? file.size,
		mime: info?.mime ?? file.type,
	};
}

function filesFrom(data: DataTransfer | null): File[] {
	if (!data) return [];
	return Array.from(data.files ?? []);
}

function probeVideo(url: string): Promise<{ width: number; height: number } | null> {
	return new Promise((resolve) => {
		const video = document.createElement('video');
		video.preload = 'metadata';
		video.onloadedmetadata = () => {
			const { videoWidth, videoHeight } = video;
			video.src = '';
			resolve(
				videoWidth && videoHeight ? { width: videoWidth, height: videoHeight } : null,
			);
		};
		video.onerror = () => resolve(null);
		video.src = url;
	});
}

function probeImage(url: string): Promise<{ width: number; height: number } | null> {
	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
		img.onerror = () => resolve(null);
		img.src = url;
	});
}
