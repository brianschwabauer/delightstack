<script lang="ts">
	import { assets } from '$app/paths';
	import Button from '$lib/form/Button.svelte';

	const { data } = $props();
	const { authState } = $derived(data);
</script>

<svelte:head>
	<link
		href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap"
		rel="stylesheet" />
</svelte:head>

<nav>
	<div class="logo">
		<img src="{assets}/logo.svg" alt="Forever Family Logo" />
	</div>
	<div class="actions">
		{#if authState.signed_in}
			<Button href="/dashboard">Dashboard</Button>
		{:else}
			<Button transparent href="/signin" t>Sign In</Button>
			<Button href="/signup">Sign Up</Button>
		{/if}
	</div>
</nav>
<article>
	<header>
		<h1>
			Preserve your family's <br />
			<strong>precious memories</strong>
		</h1>
		<p>
			Lorem ipsum dolor sit amet consectetur adipisicing elit. Dolores totam soluta autem
			ipsum, iste fuga iure. Vitae fugit, rem praesentium et quas repudiandae eaque beatae
			voluptates tempora laudantium dolorum eveniet!
		</p>
		<Button href="/signup">Get Started</Button>
	</header>
	<aside>
		<div
			class="image"
			style="background-color: #cccccc; width: 400px; height: 300px; border-radius: var(--radius)">
		</div>
	</aside>
</article>

<style>
	article {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 4rem;
		min-height: 80vh;
	}

	nav {
		position: sticky;
		width: 100%;
		bottom: 0;
		display: flex;
		align-items: center;
		padding: 0.5rem;
		@media (min-width: 768px) {
			top: 0;
			bottom: unset;
			justify-content: space-between;
		}
	}
	.logo {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 40px;
		img {
			width: 100%;
			height: 100%;
			max-width: 200px;
		}
	}

	header {
		display: flex;
		flex-direction: column;
		gap: 2rem;
		p {
			max-width: 500px;
			font-size: 1.15rem;
		}
		h1 {
			font-size: 4rem;
			font-weight: 400;
			line-height: 4.5rem;
			strong {
				font-weight: 700;
			}
		}
	}
</style>
