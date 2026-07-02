<script lang="ts">
	import { Button } from '@delightstack/components';
	import type { Editor } from '../core/editor.svelte.js';
	import { icons } from '../core/icons.js';

	interface Props {
		editor: Editor;
		onclose: () => void;
	}

	let { editor, onclose }: Props = $props();

	const existing = $derived.by(() => {
		const link = editor.active_marks.link;
		return link && link !== true && typeof link.href === 'string' ? link.href : '';
	});

	let href = $state('');
	let input = $state<HTMLInputElement | null>(null);

	$effect(() => {
		href = existing;
	});

	$effect(() => {
		input?.focus();
	});

	function apply() {
		const value = normalize(href);
		const link = editor.schema.marks.link;
		const { from, to } = editor.selection;
		if (!link || from === to) return onclose();
		if (value) {
			editor.dispatch(
				editor.state.tr
					.removeMark(from, to, link)
					.addMark(from, to, link.create({ href: value })),
			);
		}
		editor.focus();
		onclose();
	}

	function remove() {
		const link = editor.schema.marks.link;
		const { from, to } = editor.selection;
		if (link) editor.dispatch(editor.state.tr.removeMark(from, to, link));
		editor.focus();
		onclose();
	}

	function normalize(value: string): string | null {
		const trimmed = value.trim();
		if (!trimmed) return null;
		// Add https:// to bare domains, keep relative/anchor/mailto links as-is
		if (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(trimmed)) return trimmed;
		if (/^[\w-]+(\.[\w-]+)+/.test(trimmed)) return `https://${trimmed}`;
		return trimmed;
	}
</script>

<form
	class="link-editor"
	onsubmit={(event) => {
		event.preventDefault();
		apply();
	}}>
	<input
		type="text"
		placeholder="Paste or type a link…"
		bind:value={href}
		bind:this={input}
		onkeydown={(event) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				onclose();
				editor.focus();
			}
		}} />
	<Button
		icon
		transparent
		dense
		size="0"
		type="submit"
		aria-label="Apply link"
		tooltip="Apply">
		{@html icons.check}
	</Button>
	{#if existing}
		<Button
			icon
			transparent
			dense
			size="0"
			aria-label="Remove link"
			tooltip="Remove link"
			onpointerdown={(event: PointerEvent) => {
				event.preventDefault();
				remove();
			}}>
			{@html icons.unlink}
		</Button>
	{/if}
</form>

<style>
	.link-editor {
		display: flex;
		align-items: center;
		gap: 2px;
		color: var(--color-text-muted);
	}

	input {
		inline-size: 14rem;
		padding: 0.375rem 0.5rem;
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		font-size: 0.875rem;
		outline: none;

		&::placeholder {
			color: var(
				--color-text-disabled,
				color-mix(in oklab, currentColor 35%, transparent)
			);
		}
	}
</style>
