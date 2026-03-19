<script>
	import { Button } from '@delightstack/components/actions';
</script>

<Button showChevron>
	Options
	{#snippet menu({ close })}
		<button onclick={() => close()}>Edit</button>
		<button onclick={() => close()}>Remove</button>
	{/snippet}
</Button>
