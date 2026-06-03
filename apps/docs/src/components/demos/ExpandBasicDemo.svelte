<script>
	import { Expand } from '@delightstack/components/display';

	let showDetails = $state(false);
</script>

<button
	onclick={() => (showDetails = !showDetails)}
	style="padding: 0.5rem 1rem; border: 1px solid #ccc; border-radius: 6px; background: transparent; cursor: pointer;">
	{showDetails ? 'Hide' : 'Show'} Details
</button>

<Expand bind:show={showDetails}>
	<div style="padding: 1rem 0;">
		<p style="margin: 0 0 0.5rem;">
			Additional information that can be expanded and collapsed smoothly.
		</p>
		<p style="margin: 0;">
			The height animates from 0 to auto without any JavaScript measurement.
		</p>
	</div>
</Expand>
