<script lang="ts">
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';

	let {
		/** Title text displayed as the dialog header */
		title = '',

		/** The message text displayed as the dialog body */
		message = '',

		/** The text for the "Cancel" button */
		cancelText = 'Cancel',

		/** The text for the "Continue" button */
		continueText = 'Continue',

		/** Called when the user hits the "Cancel" button */
		oncancel = (() => {}) as () => void,

		/** Called when the user hits the "Continue" button */
		oncontinue = (() => {}) as () => void,
	} = $props();
	
</script>

<Modal {title} {oncancel} {oncontinue}>
	{#if message}
		<div class="message">
			{message}
		</div>
	{/if}
	{#snippet footerEnd()}
		<div class="actions">
			<Button transparent onclick={oncancel}>{cancelText}</Button>
			<Button onclick={oncontinue}>{continueText}</Button>
		</div>
	{/snippet}
</Modal>
