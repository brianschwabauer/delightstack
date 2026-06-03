<script lang="ts">
	// Marketing site landing page.
</script>

<svelte:head>
	<title>DelightStack</title>
</svelte:head>

<main class="landing">
	<picture>
		<source srcset="/delightstack_logo_dark.svg" media="(prefers-color-scheme: dark)" />
		<img class="logo" src="/delightstack_logo_light.svg" alt="DelightStack" />
	</picture>
</main>

<style>
	:global(body) {
		margin: 0;
		/* Opt the page into both schemes so light-dark() follows the OS theme. */
		color-scheme: light dark;
	}

	.landing {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		background: light-dark(#ffffff, #0b0f14);
	}

	.logo {
		width: min(540px, 82vw);
		height: auto;
	}
</style>
