<script>
	import { Modal, Button } from '@delightstack/components/actions';

	let open = $state(false);
</script>

<Button onclick={() => (open = true)}>Open Required Modal</Button>

<Modal bind:open title="Required Step" closable={false}>
	<p style="margin: 0; color: var(--color-text)">
		You must complete this step before continuing. The Escape key and backdrop click are
		disabled.
	</p>

	{#snippet footer()}
		<Button accent onclick={() => (open = false)}>Done</Button>
	{/snippet}
</Modal>
