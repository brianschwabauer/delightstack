<script lang="ts">
	import { List, ListItem } from '@delightstack/components/display';
</script>

<div class="density-grid">
	<div class="variant">
		<p class="variant-label">Dense</p>
		<List filled dense>
			<ListItem>Edit</ListItem>
			<ListItem>Duplicate</ListItem>
			<ListItem>Delete</ListItem>
		</List>
	</div>

	<div class="variant">
		<p class="variant-label">Default</p>
		<List filled>
			<ListItem>Edit</ListItem>
			<ListItem>Duplicate</ListItem>
			<ListItem>Delete</ListItem>
		</List>
	</div>

	<div class="variant">
		<p class="variant-label">Comfortable</p>
		<List filled comfortable>
			<ListItem>Edit</ListItem>
			<ListItem>Duplicate</ListItem>
			<ListItem>Delete</ListItem>
		</List>
	</div>
</div>

<style>
	.density-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem;
	}
	.variant {
		flex: 1;
		min-width: 10rem;
	}
	.variant-label {
		margin: 0 0 0.5rem;
		font-size: 0.8rem;
		color: var(--color-text-disabled, #888);
	}
</style>
