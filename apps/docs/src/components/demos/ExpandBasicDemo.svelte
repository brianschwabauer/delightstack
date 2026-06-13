<script>
	import { Expand } from '@delightstack/components/display';
	import { Button } from '@delightstack/components/actions';

	let showDetails = $state(false);
</script>

<div style="display: flex; flex-direction: column; align-items: flex-start;">
	<Button onclick={() => (showDetails = !showDetails)}>
		{showDetails ? 'Hide' : 'Show'} Details
	</Button>

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
</div>
