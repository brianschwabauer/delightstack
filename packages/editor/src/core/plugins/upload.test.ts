import { describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { Editor } from '../editor.svelte.js';
import { svelteNodeViews } from '../node-view/svelte-node-view.svelte.js';
import { defaultBlocks } from '../../blocks/index.js';
import type { UploadResult, Uploader } from '../../types/index.js';

// happy-dom lacks URL.createObjectURL
URL.createObjectURL = vi.fn(() => `blob:test-${Math.random()}`);
URL.revokeObjectURL = vi.fn();

function deferredUploader(): Uploader & {
	resolve: (result: UploadResult) => void;
	reject: (error: Error) => void;
	aborted: () => boolean;
} {
	let resolveFn: (result: UploadResult) => void;
	let rejectFn: (error: Error) => void;
	let signal: AbortSignal | null = null;
	return {
		upload(_file, ctx) {
			signal = ctx.signal;
			return new Promise((resolve, reject) => {
				resolveFn = resolve;
				rejectFn = reject;
				ctx.signal.addEventListener('abort', () => reject(new Error('aborted')));
			});
		},
		resolve: (result) => resolveFn(result),
		reject: (error) => rejectFn(error),
		aborted: () => signal?.aborted ?? false,
	};
}

function mountEditor(uploader: Uploader) {
	const editor = new Editor({ blocks: defaultBlocks(), uploader });
	editor.setNodeViews(svelteNodeViews(editor));
	const el = document.createElement('div');
	document.body.appendChild(el);
	editor.mount(el);
	flushSync();
	return { editor, el };
}

function imageFile(name = 'photo.png'): File {
	return new File([new Uint8Array(16)], name, { type: 'image/png' });
}

async function tick() {
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
}

describe('upload plugin', () => {
	it('inserts an optimistic placeholder and swaps in real attrs on completion', async () => {
		const uploader = deferredUploader();
		const { editor, el } = mountEditor(uploader);

		editor.uploadFiles([imageFile()]);
		await tick();

		// Placeholder node present with uploading state
		let image = editor
			.getJSON({ strip_uploading: false })
			.content?.find((node) => node.type === 'image');
		expect(image?.attrs?.uploading).toBe(true);
		expect(String(image?.attrs?.blob_url)).toMatch(/^blob:/);
		expect(editor.uploads).toHaveLength(1);
		// getJSON strips it by default
		expect(editor.getJSON().content?.some((node) => node.type === 'image')).toBe(false);

		uploader.resolve({
			image: { id: 'img_1', width: 800, height: 600, src: 'https://cdn/img_1', alt: '' },
		});
		await tick();

		image = editor.getJSON().content?.find((node) => node.type === 'image');
		expect(image?.attrs?.uploading).toBe(false);
		expect(image?.attrs?.src).toBe('https://cdn/img_1');
		expect(image?.attrs?.image_id).toBe('img_1');
		expect(image?.attrs?.width).toBe(800);
		expect(editor.uploads).toHaveLength(0);

		editor.destroy();
		el.remove();
	});

	it('completion does not pollute undo history', async () => {
		const uploader = deferredUploader();
		const { editor, el } = mountEditor(uploader);
		editor.uploadFiles([imageFile()]);
		await tick();
		uploader.resolve({ image: { id: 'x', width: 1, height: 1, src: 'https://cdn/x' } });
		await tick();
		// One undo removes the whole insertion, not the attr swap first
		editor.undo();
		flushSync();
		expect(editor.getJSON().content?.some((node) => node.type === 'image')).toBe(false);
		editor.destroy();
		el.remove();
	});

	it('aborts the upload when the placeholder is deleted', async () => {
		const uploader = deferredUploader();
		const { editor, el } = mountEditor(uploader);
		editor.uploadFiles([imageFile()]);
		await tick();

		let pos = -1;
		editor.state.doc.descendants((node, position) => {
			if (node.type.name === 'image') pos = position;
		});
		editor.deleteNode(pos);
		await tick();

		expect(uploader.aborted()).toBe(true);
		expect(editor.uploads).toHaveLength(0);
		editor.destroy();
		el.remove();
	});

	it('marks the node with an error on failure', async () => {
		const uploader = deferredUploader();
		const { editor, el } = mountEditor(uploader);
		editor.uploadFiles([imageFile()]);
		await tick();
		uploader.reject(new Error('network down'));
		await tick();

		const image = editor
			.getJSON({ strip_uploading: false })
			.content?.find((node) => node.type === 'image');
		expect(image?.attrs?.upload_error).toBe('network down');
		expect(editor.uploads[0]?.error).toBe('network down');
		editor.destroy();
		el.remove();
	});

	it('routes non-image files to the file block', async () => {
		const uploader = deferredUploader();
		const { editor, el } = mountEditor(uploader);
		const doc = new File([new Uint8Array(8)], 'report.pdf', { type: 'application/pdf' });
		editor.uploadFiles([doc]);
		await tick();

		const file = editor
			.getJSON({ strip_uploading: false })
			.content?.find((node) => node.type === 'file');
		expect(file?.attrs?.name).toBe('report.pdf');
		uploader.resolve({
			file: {
				url: 'https://cdn/report.pdf',
				name: 'report.pdf',
				size: 8,
				mime: 'application/pdf',
			},
		});
		await tick();
		const done = editor.getJSON().content?.find((node) => node.type === 'file');
		expect(done?.attrs?.src).toBe('https://cdn/report.pdf');
		editor.destroy();
		el.remove();
	});
});
