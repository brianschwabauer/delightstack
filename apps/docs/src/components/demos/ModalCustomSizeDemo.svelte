<script>
	import { Modal, Button } from '@delightstack/components/actions';

	let open = $state(false);
</script>

<Button onclick={() => (open = true)}>Open Wide Modal</Button>

<Modal bind:open title="Wide Modal" width="800px" height="500px">
	<p style="margin: 0; color: var(--color-text)">This modal has a custom size of 800×500px.</p>
</Modal>
