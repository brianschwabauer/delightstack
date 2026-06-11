<script>
	import { Modal, Button } from '@delightstack/components/actions';
	import { Checkbox } from '@delightstack/components/form';

	let open = $state(false);
	let agreed = $state(false);

	function openModal() {
		agreed = false;
		open = true;
	}
</script>

<Button onclick={openModal}>Open Required Modal</Button>

<Modal bind:open title="Updated Terms of Service" closable={false} width="460px">
	<div
		style="display: flex; flex-direction: column; gap: 0.75em; line-height: 1.6; color: var(--color-text);">
		<p style="margin: 0;">
			We've updated our Terms of Service and Privacy Policy, effective June 1, 2026. The
			changes clarify how workspace data is stored, add new data-export rights, and update
			our subprocessor list.
		</p>
		<p style="margin: 0;">
			You must accept the updated terms before continuing — the Escape key and backdrop
			click are disabled on this dialog.
		</p>
		<Checkbox bind:checked={agreed} label="I have read and agree to the updated terms" />
	</div>

	{#snippet footer()}
		<Button accent disabled={!agreed} onclick={() => (open = false)}>
			Accept and Continue
		</Button>
	{/snippet}
</Modal>
