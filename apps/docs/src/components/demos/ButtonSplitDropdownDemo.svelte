<script>
	import { Button } from '@delightstack/components/actions';
</script>

<Button onclick={() => {}}>
	Save
	{#snippet dropdown({ close })}
		<button onclick={() => close()}>Save As...</button>
		<button onclick={() => close()}>Save Copy</button>
	{/snippet}
</Button>
