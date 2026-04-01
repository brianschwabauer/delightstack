<script lang="ts">
	import { Toaster, toast } from '@delightstack/components';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import './global.css';

	const { children } = $props();

	// Show toast from URL search params (e.g. after redirect)
	$effect(() => {
		const message = page.url.searchParams.get('toast');
		if (message) {
			toast(message);
			const url = new URL(page.url);
			url.searchParams.delete('toast');
			replaceState(url, {});
		}
	});
</script>

<svelte:head>
	<title>Forever Family</title>
</svelte:head>

<Toaster />
{@render children()}
