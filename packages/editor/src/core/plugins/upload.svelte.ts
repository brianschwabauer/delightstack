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
	) {
		const uploader = editor.uploader as Uploader;
		const controller = new AbortController();
		active.set(upload_id, { upload_id, kind, controller, blob_url });
		editor.uploads.push({
			upload_id,
			kind,
			file_name: file.name,
			progress: 0,
			error: null,
		});

		// Probe image dimensions for layout stability while uploading
		if (kind === 'image') {
			probeImage(blob_url).then((size) => {
				if (!size || !active.has(upload_id)) return;
				patchNode(upload_id, {
					width: size.width,
					height: size.height,
					aspect_ratio: size.width / size.height,
				});
			});
		}

		try {
			const result = await uploader.upload(file, {
				kind,
				signal: controller.signal,
				on_progress: (fraction) => setProgress(upload_id, fraction),
			});
			if (!active.has(upload_id)) return; // node was deleted mid-upload
			patchNode(upload_id, completedAttrs(kind, file, result));
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

	function uploadFiles(files: File[], pos?: number): void {
		if (!editor.uploader) return;
		let insertAt = pos;
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
			if (!editor.insertBlock(type.name, declared, insertAt)) {
				URL.revokeObjectURL(blob_url);
				continue;
			}
			if (insertAt !== undefined) {
				const node = editor.state.doc.nodeAt(insertAt);
				insertAt += node?.nodeSize ?? 0;
			}
			void start(file, kind, upload_id, blob_url);
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
			// Abort uploads whose placeholder node was deleted
			if (!active.size || !transactions.some((tr) => tr.docChanged)) return null;
			const present = new Set<string>();
			newState.doc.descendants((node) => {
				if (typeof node.attrs.upload_id === 'string') present.add(node.attrs.upload_id);
			});
			for (const [upload_id, entry] of active) {
				if (present.has(upload_id)) continue;
				entry.controller.abort();
				URL.revokeObjectURL(entry.blob_url);
				active.delete(upload_id);
				editor.uploads = editor.uploads.filter(
					(upload) => upload.upload_id !== upload_id,
				);
			}
			return null;
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

function probeImage(url: string): Promise<{ width: number; height: number } | null> {
	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
		img.onerror = () => resolve(null);
		img.src = url;
	});
}
