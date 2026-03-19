<script>
	import { Callout } from '@delightstack/components/feedback';

	let visible = $state(true);

	function reset() {
		visible = true;
	}
</script>

{#if visible}
	<Callout tip title="Pro Tip" dismissible ondismiss={() => (visible = false)}>
		You can use keyboard shortcuts to speed up your workflow.
	</Callout>
{:else}
	<button
		onclick={reset}
		style="padding: 0.5rem 1rem; border: 1px solid #ccc; border-radius: 6px; background: transparent; cursor: pointer;"
	>
		Show callout again
	</button>
{/if}
