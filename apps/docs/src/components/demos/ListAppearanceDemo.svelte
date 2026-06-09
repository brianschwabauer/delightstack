<script lang="ts">
	import { List, ListItem } from '@delightstack/components/display';
</script>

<div class="appearance-grid">
	<div class="variant">
		<p class="variant-label">Plain (default)</p>
		<List>
			<ListItem>Profile</ListItem>
			<ListItem>Settings</ListItem>
			<ListItem>Sign out</ListItem>
		</List>
	</div>

	<div class="variant">
		<p class="variant-label">Filled</p>
		<List filled>
			<ListItem>Profile</ListItem>
			<ListItem>Settings</ListItem>
			<ListItem>Sign out</ListItem>
		</List>
	</div>

	<div class="variant">
		<p class="variant-label">Outline</p>
		<List outline>
			<ListItem>Profile</ListItem>
			<ListItem>Settings</ListItem>
			<ListItem>Sign out</ListItem>
		</List>
	</div>
</div>

<style>
	.appearance-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem;
	}
	.variant {
		flex: 1;
		min-width: 11rem;
	}
	.variant-label {
		margin: 0 0 0.5rem;
		font-size: 0.8rem;
		color: var(--color-text-disabled, #888);
	}
</style>
