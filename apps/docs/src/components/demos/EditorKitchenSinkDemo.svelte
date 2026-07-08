<script lang="ts">
	import {
		Editor as EditorClass,
		defaultBlocks,
		type JSONContent,
		type Uploader,
	} from '@delightstack/editor';
	import { Editor, Toolbar } from '@delightstack/editor/components';

	// Demo uploader: simulates network progress, then serves the file from a
	// blob URL. Real apps implement this interface with @delightstack/images.
	const uploader: Uploader = {
		async upload(file, { signal, on_progress }) {
			for (let step = 1; step <= 12; step++) {
				await new Promise((resolve) => setTimeout(resolve, 140));
				if (signal.aborted) throw new Error('aborted');
				on_progress?.(step / 12);
			}
			const url = URL.createObjectURL(file);
			if (file.type.startsWith('image/')) {
				const size = await new Promise<{ width: number; height: number }>(
					(resolve, reject) => {
						const img = new Image();
						img.onload = () =>
							resolve({ width: img.naturalWidth, height: img.naturalHeight });
						img.onerror = reject;
						img.src = url;
					},
				);
				return { image: { id: crypto.randomUUID(), src: url, alt: file.name, ...size } };
			}
			return { file: { url, name: file.name, size: file.size, mime: file.type } };
		},
	};

	const paragraph = (...content: JSONContent[]): JSONContent => ({
		type: 'paragraph',
		content,
	});
	const text = (
		value: string,
		...marks: { type: string; attrs?: Record<string, unknown> }[]
	) => ({ type: 'text', text: value, ...(marks.length ? { marks } : {}) }) as JSONContent;

	// One document exercising every built-in node, mark, and block
	const kitchenSink: JSONContent = {
		type: 'doc',
		content: [
			{
				type: 'heading',
				attrs: { level: 2 },
				content: [text('The kitchen sink')],
			},
			paragraph(
				text('Every mark: '),
				text('bold', { type: 'bold' }),
				text(', '),
				text('italic', { type: 'italic' }),
				text(', '),
				text('underline', { type: 'underline' }),
				text(', '),
				text('strikethrough', { type: 'strike' }),
				text(', '),
				text('code', { type: 'code' }),
				text(', and a '),
				text('link', {
					type: 'link',
					attrs: { href: 'https://docs.thedelight.co', target: null },
				}),
				text('. Select any of it to get the floating menu.'),
			),
			{
				type: 'callout',
				attrs: { variant: 'tip' },
				content: [
					paragraph(
						text('Type '),
						text('/', { type: 'code' }),
						text(
							' anywhere for the command menu, hover a block for the drag handle (click it for actions), and click this callout to find the settings gear (top right).',
						),
					),
				],
			},
			{
				type: 'heading',
				attrs: { level: 3 },
				content: [text('Lists')],
			},
			{
				type: 'bullet_list',
				content: [
					{
						type: 'list_item',
						content: [paragraph(text('Markdown shortcuts work: try '))],
					},
					{
						type: 'list_item',
						content: [
							paragraph(
								text('# ', { type: 'code' }),
								text('for headings, '),
								text('> ', { type: 'code' }),
								text('for quotes'),
							),
						],
					},
				],
			},
			{
				type: 'ordered_list',
				attrs: { start: 1 },
				content: [
					{
						type: 'list_item',
						content: [paragraph(text('Numbered lists renumber themselves'))],
					},
					{
						type: 'list_item',
						content: [paragraph(text('Tab / Shift-Tab nest and un-nest items'))],
					},
				],
			},
			{
				type: 'todo_list',
				content: [
					{
						type: 'todo_item',
						attrs: { checked: true },
						content: [paragraph(text('Click a checkbox to toggle it'))],
					},
					{
						type: 'todo_item',
						attrs: { checked: false },
						content: [paragraph(text('Checked items strike through'))],
					},
				],
			},
			{
				type: 'blockquote',
				content: [
					paragraph(
						text(
							'Blockquotes hold any block content, and Backspace at the start lifts you back out.',
						),
					),
				],
			},
			{
				type: 'heading',
				attrs: { level: 3 },
				content: [text('Blocks')],
			},
			{
				type: 'code_block',
				attrs: { language: 'svelte' },
				content: [
					text(
						// oxlint-disable-next-line no-useless-escape -- an unescaped closing script tag would terminate this component's script block
						'<script>\n\tconst editor = new Editor({ blocks: defaultBlocks(), uploader });\n<\/script>\n\n<Toolbar {editor} />\n<Editor {editor} />',
					),
				],
			},
			paragraph(
				text('This image was preset in the document — drag its side grips to feel the '),
				text('magnetic snap resize', { type: 'bold' }),
				text(' (watch for the ⅓ / ½ / ⅔ / full badges):'),
			),
			{
				type: 'image',
				attrs: {
					src: 'https://picsum.photos/seed/delight-ridge/1200/800',
					alt: 'A pine-covered mountain ridge with low morning fog',
					caption: 'Morning fog rolling over the alpine ridge',
					width: 1200,
					height: 800,
					aspect_ratio: 1.5,
					width_pct: 66.7,
				},
			},
			{
				type: 'gallery',
				attrs: {
					display: 'masonry',
					items: [
						{
							id: 'g1',
							src: 'https://picsum.photos/seed/delight-portrait/800/1200',
							width: 800,
							height: 1200,
							alt: 'A peach-coloured doorway between two stone walls',
						},
						{
							id: 'g2',
							src: 'https://picsum.photos/seed/delight-square/900/900',
							width: 900,
							height: 900,
							alt: 'A ceramic mug on a wooden table',
						},
						{
							id: 'g3',
							src: 'https://picsum.photos/seed/delight-wide/1600/900',
							width: 1600,
							height: 900,
							alt: 'A wide coastal horizon at dusk',
						},
					],
				},
			},
			paragraph(
				text(
					'Galleries and embeds have settings popovers too — select the block and hit the gear. This embed came from pasting a YouTube URL on an empty line:',
				),
			),
			{
				type: 'embed',
				attrs: {
					src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
					title: 'YouTube video',
					aspect_ratio: 16 / 9,
				},
			},
			{ type: 'horizontal_rule' },
			paragraph(
				text(
					'Now try it yourself: drop an image anywhere (uploads are simulated with a progress ring), paste rich text from another site, or paste markdown as plain text. ',
				),
				text('Everything undoes cleanly.', { type: 'italic' }),
			),
		],
	};

	const editor = new EditorClass({
		blocks: defaultBlocks(),
		uploader,
		placeholder: 'Write something delightful…',
		content: kitchenSink,
	});
</script>

<div class="demo">
	<Toolbar {editor} />

	<div class="surface">
		<Editor {editor} />
	</div>

	<p class="hints">
		<kbd>/</kbd>
		commands · select text → floating menu · hover a block → drag handle (click it for actions)
		· drop an image to upload · paste markdown or a YouTube URL
	</p>
</div>

<style>
	.demo {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		text-align: start;
	}

	.surface {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg, 12px);
		padding: 0.5rem 1.5rem 0.5rem 3.5rem;
		max-height: 34rem;
		overflow-y: auto;
	}

	.hints {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-align: center;

		kbd {
			font-family: var(--font-mono, monospace);
			background: var(--color-bg-muted);
			border-radius: 4px;
			padding: 0.05rem 0.3rem;
		}
	}
</style>
