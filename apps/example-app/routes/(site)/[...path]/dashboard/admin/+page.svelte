<script lang="ts">
	import Button from '$lib/form/Button.svelte';
</script>

<article>
	<Button transparent fullWidth href="/dashboard/admin/auth">Auth Database</Button>
	<Button transparent fullWidth href="/dashboard/admin/org">Org Database</Button>
</article>

<style>
	article {
		width: calc(100% - 2rem);
		max-width: 1200px;
		margin: 2rem auto;
	}
</style>
