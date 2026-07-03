<script lang="ts">
	import type { Editor } from '../core/editor.svelte.js';
	import type {
		EditorCommand,
		SuggestionContext,
		SuggestionHandler,
	} from '../types/index.js';
	import { portal } from './portal.js';
	import { surfaceIn, surfaceOut } from './motion.js';
	import CommandMenu from './CommandMenu.svelte';

	interface Props {
		editor: Editor;
	}

	let { editor }: Props = $props();

	let open = $state(false);
	let query = $state('');
	let range = $state<{ from: number; to: number } | null>(null);
	let selected = $state(0);
	let menu_width = $state(0);
	let menu_height = $state(0);
	// Bumped by any scroll/resize so the anchor re-measures and the menu
	// follows the caret instead of stranding at stale viewport coordinates
	let scroll_tick = $state(0);
	// Consecutive updates with zero results — a hopeless query auto-dismisses
	// so typing a normal sentence starting with '/' doesn't drag a dead menu
	// along for its whole length
	let misses = 0;

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
			misses = 0;
			this.update(ctx);
		},
		update(ctx: SuggestionContext) {
			const query_changed = ctx.query !== query;
			// A changed query re-filters the list, so a kept index would point
			// at an unrelated command — always restart the highlight at the top
			if (query_changed) selected = 0;
			query = ctx.query;
			range = ctx.range;
			// Only typing advances the miss counter (updates also fire for
			// unrelated transactions that leave the query untouched)
			if (query_changed) {
				if (items.length === 0) {
					// Defer: update() runs inside the view's update cycle, where
					// dispatching another transaction re-entrantly is unsafe
					if (query.length > 0 && ++misses >= 3) queueMicrotask(ctx.dismiss);
				} else {
					misses = 0;
				}
			}
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

	$effect(() =>
		editor.suggest('/', () => handler, {
			// Slash commands come from an empty line only: the trigger must be
			// the first character of its block and nothing may follow the
			// caret. Mid-sentence slashes are just text.
			allow: (state, trigger_pos) => {
				const trigger = state.doc.resolve(trigger_pos);
				return (
					trigger.parentOffset === 0 &&
					trigger.parent.content.size === state.selection.$from.parentOffset
				);
			},
		}),
	);

	function pick(command: EditorCommand) {
		const target = range;
		open = false;
		// Remove the "/query" text, then run the command
		if (target) {
			editor.dispatch(editor.state.tr.delete(target.from, target.to));
		}
		editor.focus();
		// The query text is gone, so hand the command the (still valid)
		// collapsed insertion point rather than the pre-delete range
		command.run(
			editor,
			target ? { range: { from: target.from, to: target.from } } : undefined,
		);
	}

	// Caret anchor, re-measured on every doc update, scroll, and resize
	const anchor = $derived.by(() => {
		void scroll_tick;
		if (!open || !range) return null;
		const view = editor.view;
		if (!view) return null;
		try {
			const coords = view.coordsAtPos(range.from);
			return { left: coords.left, top: coords.top, bottom: coords.bottom };
		} catch {
			return null;
		}
	});

	// Position below the caret; flip above when there's no room. When flipped
	// the menu is pinned by its BOTTOM edge so a growing/shrinking result list
	// expands upward, never downward over the text being typed.
	const position = $derived.by(() => {
		if (!anchor) return null;
		const height = menu_height || 304;
		const width = menu_width || 288;
		const viewport_h = typeof window === 'undefined' ? 800 : window.innerHeight;
		const viewport_w = typeof window === 'undefined' ? 1200 : window.innerWidth;
		const left = Math.max(8, Math.min(anchor.left, viewport_w - width - 8));
		if (anchor.bottom + 6 + height > viewport_h - 8 && anchor.top - height - 6 >= 8) {
			return { left, bottom: viewport_h - anchor.top + 6 };
		}
		return { left, top: anchor.bottom + 6 };
	});
</script>

<svelte:window
	onscrollcapture={() => (scroll_tick = scroll_tick + 1)}
	onresize={() => (scroll_tick = scroll_tick + 1)} />

{#if open && position}
	<div
		class="slash-menu"
		in:surfaceIn={{ origin: position.bottom !== undefined ? 'bottom left' : 'top left' }}
		out:surfaceOut
		style:left="{position.left}px"
		style:top={position.top !== undefined ? `${position.top}px` : null}
		style:bottom={position.bottom !== undefined ? `${position.bottom}px` : null}
		style:visibility={menu_height ? null : 'hidden'}
		bind:offsetWidth={menu_width}
		bind:offsetHeight={menu_height}
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
