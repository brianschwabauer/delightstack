<script lang="ts">
	import { page } from '$app/state';
	import SignInForm from '../SignInForm.svelte';
	import { replaceState } from '$app/navigation';
	import { untrack } from 'svelte';

	const { data } = $props();
	const { authState } = $derived(data);
	let mode = $state<'signin' | 'signup'>('signin');

	let firstChange = true;
	$effect(() => {
		mode;
		if (firstChange) {
			firstChange = false;
			return;
		}
		untrack(() => {
			const url = new URL(page.url);
			url.pathname = `/${mode}`;
			replaceState(url.href, {});
		});
	});
</script>

<article>
	<section>
		{#if authState.signed_in}
			<h1>Welcome Back, {authState.name}!</h1>
		{:else}
			<h1>Sign {mode === 'signin' ? 'In' : 'Up'}</h1>
		{/if}
		<SignInForm bind:mode {authState} allowPasswordless />
	</section>
</article>

<style>
	article {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
	}
	section {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		width: calc(100vw - 2rem);
		max-width: 350px;
		:global(.input) {
			width: 100%;
		}
	}
</style>
