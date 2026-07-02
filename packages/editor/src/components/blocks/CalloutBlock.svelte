<script lang="ts">
	import { Callout } from '@delightstack/components';
	import type { BlockProps } from '../../types/index.js';

	type CalloutAttrs = {
		variant: 'info' | 'success' | 'warning' | 'error' | 'tip';
		block_id: string | null;
	};

	let { attrs, content }: BlockProps<CalloutAttrs> = $props();

	// The Callout's own chrome (icon) must not accept the caret — only the
	// content hole is editable. The component doesn't expose contenteditable
	// on its internals, so mark everything outside the hole after mount.
	function shieldChrome(el: HTMLElement) {
		el.querySelectorAll('.icon, .title').forEach((chrome) => {
			chrome.setAttribute('contenteditable', 'false');
		});
	}
</script>

<div class="callout-block" {@attach shieldChrome}>
	<Callout
		success={attrs.variant === 'success'}
		warning={attrs.variant === 'warning'}
		error={attrs.variant === 'error'}
		tip={attrs.variant === 'tip'}>
		<div class="body" {@attach content}></div>
	</Callout>
</div>

<style>
	.body {
		min-width: 0;

		:global {
			> * + * {
				margin-block-start: 0.5em;
			}

			p {
				margin: 0;
			}
		}
	}
</style>
