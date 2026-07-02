<script lang="ts">
	import { MediaQuery } from 'svelte/reactivity';
	import type { Editor } from '../core/editor.svelte.js';
	import { portal } from './portal.js';
	import { prefersReducedMotion } from './motion.js';
	import Toolbar from './Toolbar.svelte';

	interface Props {
		editor: Editor;
	}

	let { editor }: Props = $props();

	// Phones and small tablets — where the floating selection toolbar is
	// fiddly and there's no hover for the gutter affordances
	const small = new MediaQuery('(max-width: 767px)');

	const visible = $derived(small.current && editor.editable && editor.focused);

	// iOS keyboards cover `position: fixed` elements (fixed is laid out
	// against the layout viewport); track the visual viewport and lift the
	// bar to sit on top of the keyboard.
	let keyboard_offset = $state(0);
	$effect(() => {
		const vv = window.visualViewport;
		if (!vv) return;
		const update = () => {
			keyboard_offset = Math.max(
				0,
				Math.round(window.innerHeight - vv.height - vv.offsetTop),
			);
		};
		update();
		vv.addEventListener('resize', update);
		vv.addEventListener('scroll', update);
		return () => {
			vv.removeEventListener('resize', update);
			vv.removeEventListener('scroll', update);
		};
	});

	function slideUp(_node: Element) {
		if (prefersReducedMotion()) return { duration: 0 };
		return {
			duration: 160,
			css: (t: number, u: number) => `opacity: ${t}; translate: 0 ${u * 100}%;`,
		};
	}
</script>

{#if visible}
	<div
		class="mobile-bar"
		style:transform="translateY(-{keyboard_offset}px)"
		transition:slideUp
		use:portal>
		<Toolbar {editor} class="mobile-toolbar" />
	</div>
{/if}

<style>
	.mobile-bar {
		position: fixed;
		inset-inline: 0;
		bottom: 0;
		z-index: 40;
		padding-block-end: env(safe-area-inset-bottom, 0px);
		background: var(--color-surface, Canvas);
		border-block-start: 1px solid
			var(--color-border, color-mix(in oklab, currentColor 15%, transparent));

		/* One scrollable row — the toolbar's own chrome is dropped since the
		   bar provides the surface */
		:global(.mobile-toolbar) {
			flex-wrap: nowrap;
			overflow-x: auto;
			border: none;
			border-radius: 0;
			background: none;
			padding: 6px 8px;

			&::-webkit-scrollbar {
				display: none;
			}
		}
	}
</style>
