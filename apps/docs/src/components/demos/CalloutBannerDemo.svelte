<script>
	import { Callout } from '@delightstack/components/feedback';

	let showBanner = $state(true);

	function reset() {
		showBanner = true;
	}
</script>

<div style="display: flex; flex-direction: column; gap: 1rem;">
	{#if showBanner}
		<Callout banner dismissible ondismiss={() => (showBanner = false)}>
			We've updated our privacy policy. Please review the changes.

			{#snippet action()}
				<button
					style="color: inherit; font-weight: 500; background: none; border: none; cursor: pointer; text-decoration: underline; padding: 0;">
					Learn more
				</button>
			{/snippet}
		</Callout>
	{:else}
		<button
			onclick={reset}
			style="align-self: flex-start; padding: 0.5rem 1rem; border: 1px solid #ccc; border-radius: 6px; background: transparent; cursor: pointer;">
			Show banner again
		</button>
	{/if}

	<Callout banner warning>Scheduled maintenance tonight at 11pm UTC.</Callout>
</div>
