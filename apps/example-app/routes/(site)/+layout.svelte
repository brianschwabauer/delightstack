<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from '$lib/components';
	import Toast from '$lib/components/Toast.svelte';
	import { untrack } from 'svelte';
	import './global.css';
	const { children } = $props();

	$effect(() => {
		untrack(() => {
			const toastMessage = page.url.searchParams.get('toast');
			if (!toastMessage) return;
			toast(toastMessage);
			const new_url = new URL(page.url);
			new_url.searchParams.delete('toast');
			goto(new_url, { replaceState: true, keepFocus: true, noScroll: true });
		});
	});
</script>

<svelte:head>
	<title>Forever Family</title>
</svelte:head>

<Toast />

{@render children()}
