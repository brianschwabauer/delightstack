<script lang="ts">
	import { Checkbox } from '@delightstack/components';
	import type { BlockProps } from '../../types/index.js';

	type TodoAttrs = { checked: boolean; block_id: string | null };

	let { attrs, editable, update_attrs, content }: BlockProps<TodoAttrs> = $props();
</script>

<div class="todo" class:checked={attrs.checked}>
	<span class="box" contenteditable="false">
		<Checkbox
			size="0"
			checked={attrs.checked}
			disabled={!editable}
			onchange={({ checked }) => update_attrs({ checked: Boolean(checked) })} />
	</span>
	<div class="body" {@attach content}></div>
</div>

<style>
	.todo {
		display: flex;
		align-items: flex-start;
		gap: 0.5em;
	}

	.box {
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		/* Center the checkbox on the first line of text */
		block-size: calc(1em * var(--editor-line-height, 1.7));
		user-select: none;
	}

	.body {
		flex: 1;
		min-width: 0;
		transition: color 300ms ease;

		:global(p) {
			margin: 0;
		}
	}

	.checked .body {
		color: var(--color-text-muted, inherit);
		text-decoration: line-through;
		text-decoration-color: color-mix(in oklab, currentColor 50%, transparent);
	}
</style>
