<script>
	import { Modal, Button } from '@delightstack/components/actions';

	let open = $state(false);
</script>

<Button onclick={() => (open = true)}>Open Modal</Button>

<Modal bind:open title="Example Modal">
	<p style="margin: 0; line-height: 1.6; color: var(--color-text)">
		This is a modal dialog with some example content. Click outside or press Escape to close.
	</p>
</Modal>
