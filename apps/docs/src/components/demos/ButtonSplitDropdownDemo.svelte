<script>
	import { Button } from '@delightstack/components/actions';
	import { List, ListItem } from '@delightstack/components/display';
</script>

<Button onclick={() => {}}>
	Save
	{#snippet dropdown({ close })}
		<List>
			<ListItem onclick={() => close()}>Save As…</ListItem>
			<ListItem onclick={() => close()}>Save Copy</ListItem>
		</List>
	{/snippet}
</Button>
