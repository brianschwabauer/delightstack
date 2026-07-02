<script lang="ts">
	import type { Editor } from '../core/editor.svelte.js';
	import type {
		EditorCommand,
		SuggestionContext,
		SuggestionHandler,
	} from '../types/index.js';
	import { portal } from './portal.js';
	import CommandMenu from './CommandMenu.svelte';

	interface Props {
		editor: Editor;
	}

	let { editor }: Props = $props();

	let open = $state(false);
	let query = $state('');
	let range = $state<{ from: number; to: number } | null>(null);
	let anchor = $state<DOMRect | null>(null);
	let selected = $state(0);
	let menu_el = $state<HTMLElement | null>(null);

	const items = $derived(
		open
			? editor.commands
					.search(query, 'slash')
					.filter((command) => !command.is_enabled || command.is_enabled(editor))
			: [],
	);

	const handler: SuggestionHandler = {
		open(ctx: SuggestionContext) {
			open = true;
			selected = 0;
			this.update(ctx);
		},
		update(ctx: SuggestionContext) {
			query = ctx.query;
			range = ctx.range;
			if (ctx.rect) anchor = ctx.rect;
			selected = Math.min(selected, Math.max(0, items.length - 1));
		},
		close() {
			open = false;
			query = '';
			range = null;
		},
		keydown(event: KeyboardEvent) {
			if (!open) return false;
			switch (event.key) {
				case 'ArrowDown':
					selected = items.length ? (selected + 1) % items.length : 0;
					return true;
				case 'ArrowUp':
					selected = items.length ? (selected - 1 + items.length) % items.length : 0;
					return true;
				case 'Enter':
				case 'Tab': {
					const command = items[selected];
					if (!command) return false;
					pick(command);
					return true;
				}
			}
			return false;
		},
	};

	$effect(() => editor.suggest('/', () => handler));

	function pick(command: EditorCommand) {
		const target = range;
		open = false;
		// Remove the "/query" text, then run the command
		if (target) {
			editor.dispatch(editor.state.tr.delete(target.from, target.to));
		}
		editor.focus();
		command.run(editor, target ? { range: target } : undefined);
	}

	// Position below the caret; flip above when there's no room
	const position = $derived.by(() => {
		if (!anchor) return { left: 0, top: 0 };
		const height = menu_el?.offsetHeight ?? 304;
		const width = menu_el?.offsetWidth ?? 288;
		const viewport_h = typeof window === 'undefined' ? 800 : window.innerHeight;
		const viewport_w = typeof window === 'undefined' ? 1200 : window.innerWidth;
		let top = anchor.bottom + 6;
		if (top + height > viewport_h - 8) top = Math.max(8, anchor.top - height - 6);
		const left = Math.max(8, Math.min(anchor.left, viewport_w - width - 8));
		return { left, top };
	});
</script>

{#if open}
	<div
		class="slash-menu"
		style:left="{position.left}px"
		style:top="{position.top}px"
		bind:this={menu_el}
		use:portal>
		<CommandMenu
			{items}
			{selected}
			onhover={(index) => (selected = index)}
			onpick={pick}
			empty_message="No results for “{query}”" />
	</div>
{/if}

<style>
	.slash-menu {
		position: fixed;
		z-index: 50;
	}
</style>
