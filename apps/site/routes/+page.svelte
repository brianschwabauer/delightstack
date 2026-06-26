<script lang="ts">
	import '@delightstack/styles/global.css';
	import { Button } from '@delightstack/components';

	// Marketing landing page for thedelight.co.
	const DOCS = 'https://docs.thedelight.co';
	const EXAMPLE = 'https://example.thedelight.co';
	const GITHUB = 'https://github.com/brianschwabauer/delightstack';

	const categories = [
		{ name: 'Actions', blurb: 'Buttons, modals, popovers, command palettes' },
		{ name: 'Display', blurb: 'Tables, calendars, charts, trees, timelines' },
		{ name: 'Feedback', blurb: 'Toasts, progress, callouts, confetti' },
		{ name: 'Form', blurb: 'Inputs, selects, validation, file uploads' },
		{ name: 'Media', blurb: 'Galleries, carousels, video, maps, PDF' },
		{ name: 'Navigation', blurb: 'Tabs, drawers, breadcrumbs, steps' },
	];

	const packages = [
		{ name: 'Auth', blurb: 'JWT sessions, Argon2id, OAuth, multi-org, guards' },
		{ name: 'Database', blurb: 'Reactive SQLite on Durable Objects + search' },
		{ name: 'Realtime', blurb: 'Room-scoped WebSockets with live presence' },
		{ name: 'AI', blurb: 'Chat, resumable streaming, vector embeddings' },
		{ name: 'Billing', blurb: 'Stripe subscriptions, metered usage, webhooks' },
		{ name: 'Images', blurb: 'Variants, ThumbHash, EXIF, face-aware crops' },
	];
</script>

<svelte:head>
	<title>Delightstack — Svelte 5 components + an edge-native Cloudflare backend</title>
	<meta
		name="description"
		content="Two products, one design language: a polished Svelte 5 component library and an edge-native backend for Cloudflare. Use either, or both." />
</svelte:head>

<header class="nav">
	<a class="brand" href="/" aria-label="Delightstack home">
		<picture>
			<source srcset="/delightstack_logo_dark.svg" media="(prefers-color-scheme: dark)" />
			<img src="/delightstack_logo_light.svg" alt="Delightstack" />
		</picture>
	</a>
	<nav class="nav-links">
		<a href={DOCS}>Docs</a>
		<a href={EXAMPLE}>Example</a>
		<a href={GITHUB}>GitHub</a>
	</nav>
</header>

<main>
	<section class="hero">
		<div class="glow" aria-hidden="true"></div>
		<picture>
			<source srcset="/delightstack_logo_dark.svg" media="(prefers-color-scheme: dark)" />
			<img class="logo" src="/delightstack_logo_light.svg" alt="Delightstack" />
		</picture>
		<h1>Build delightful apps, end&nbsp;to&nbsp;end.</h1>
		<p class="lede">
			Delightstack is two products that share one design language: a polished
			<strong>Svelte&nbsp;5 component library</strong>
			, and an
			<strong>edge-native backend</strong>
			for Cloudflare. Use either, or both.
		</p>
		<div class="cta">
			<Button href="{DOCS}/components/overview/" size="3">Browse components →</Button>
			<Button href="{DOCS}/stack/overview/" size="3" outline>Explore the stack →</Button>
		</div>
	</section>

	<section class="products">
		<article class="product">
			<div class="kicker">Product one</div>
			<h2>Components</h2>
			<p>
				55 accessible, delightful Svelte&nbsp;5 components — built with runes, snippets,
				and modern CSS. Dark mode and accessibility in every one. Drop them into any
				Svelte&nbsp;5 / Vite app.
			</p>
			<ul class="grid">
				{#each categories as c}
					<li>
						<span class="grid-name">{c.name}</span>
						<span class="grid-blurb">{c.blurb}</span>
					</li>
				{/each}
			</ul>
			<a class="link" href="{DOCS}/getting-started/introduction/">
				Get started with components →
			</a>
		</article>

		<article class="product">
			<div class="kicker">Product two</div>
			<h2>The Stack</h2>
			<p>
				An edge-native backend for Cloudflare Workers, built on Durable Objects — auth, a
				reactive database, realtime, AI, billing, and image processing. Adopt one package,
				or all of them.
			</p>
			<ul class="grid">
				{#each packages as p}
					<li>
						<span class="grid-name">{p.name}</span>
						<span class="grid-blurb">{p.blurb}</span>
					</li>
				{/each}
			</ul>
			<a class="link" href="{DOCS}/stack/overview/">Explore the stack →</a>
		</article>
	</section>

	<section class="closer">
		<h2>See it all working together</h2>
		<p>
			The example app wires every package into one SvelteKit&nbsp;+&nbsp;Cloudflare
			project — the canonical reference for building with Delightstack.
		</p>
		<div class="cta">
			<Button href={EXAMPLE} size="3">View the live example →</Button>
			<Button href={GITHUB} size="3" outline target="_blank">Star on GitHub</Button>
		</div>
	</section>
</main>

<footer>
	<span>MIT licensed</span>
	<span>·</span>
	<a href={GITHUB}>github.com/brianschwabauer/delightstack</a>
</footer>

<style>
	/* Retune the design-system accent toward the logo's teal (#00c2a8) so the
	   Button fills, outline text, and accents match the brandmark. */
	:global(:root) {
		--color-primary: #00c2a8;
		--color-secondary: #00c2a8;
	}

	/* Use the design system's tokens (from @delightstack/styles) but a clean
	   sans body — the global stylesheet defaults body to a display serif. */
	:global(body) {
		margin: 0;
		font-family: var(--font-sans);
		-webkit-font-smoothing: antialiased;
		line-height: 1.6;
	}

	.nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		max-width: 72rem;
		margin: 0 auto;
		padding: 1.25rem clamp(1rem, 4vw, 2rem);
	}
	.brand {
		display: inline-flex;
		align-items: center;
	}
	.brand img {
		height: 1.6rem;
		width: auto;
		display: block;
	}
	.nav-links {
		display: flex;
		gap: clamp(0.75rem, 3vw, 1.75rem);
	}
	.nav-links a {
		color: color-mix(in oklch, var(--color-text) 62%, var(--color-bg));
		text-decoration: none;
		font-size: 0.95rem;
		transition: color 200ms;
	}
	.nav-links a:hover {
		color: var(--color-text);
	}

	main {
		max-width: 72rem;
		margin: 0 auto;
		padding: 0 clamp(1rem, 4vw, 2rem);
	}

	.hero {
		position: relative;
		text-align: center;
		padding-block: clamp(2.5rem, 8vw, 6rem) clamp(2.5rem, 6vw, 5rem);
		overflow: clip;
	}
	.glow {
		position: absolute;
		z-index: -1;
		inset-block-start: -30%;
		inset-inline-start: 50%;
		width: min(60rem, 130%);
		aspect-ratio: 2 / 1;
		transform: translateX(-50%);
		background: radial-gradient(
			50% 50% at 50% 50%,
			color-mix(in oklch, var(--color-action) 32%, transparent),
			transparent 70%
		);
		filter: blur(50px);
		opacity: 0.55;
	}
	.logo {
		display: block;
		width: min(22rem, 68vw);
		height: auto;
		margin: 0 auto 1.5rem;
	}
	.hero h1 {
		color: light-dark(black, white);
		font-size: clamp(2.5rem, 7vw, 4.75rem);
		line-height: 1.05;
		letter-spacing: -0.03em;
		margin: 0 auto 1rem;
		max-width: 16ch;
	}
	.lede {
		margin: 0 auto;
		max-width: 52ch;
		font-size: clamp(1.05rem, 2vw, 1.3rem);
		color: color-mix(in oklch, var(--color-text) 62%, var(--color-bg));
	}
	.lede strong {
		color: var(--color-text);
		font-weight: 600;
	}

	.cta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		justify-content: center;
		margin-top: 2rem;
	}

	.products {
		display: grid;
		gap: 1.5rem;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 24rem), 1fr));
		padding-block: clamp(2rem, 5vw, 4rem);
	}
	.product {
		border: 1px solid var(--color-bg-3);
		border-radius: var(--radius-4);
		padding: clamp(1.5rem, 3vw, 2.25rem);
		background: var(--color-bg-0);
	}
	.kicker {
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: light-dark(
			oklch(from var(--color-action) 0.45 c h),
			oklch(from var(--color-action) 0.82 c h)
		);
		font-weight: 650;
	}
	.product h2 {
		font-size: clamp(1.6rem, 3vw, 2rem);
		letter-spacing: -0.02em;
		margin: 0.25rem 0 0.6rem;
	}
	.product > p {
		color: color-mix(in oklch, var(--color-text) 62%, var(--color-bg));
		margin: 0 0 1.5rem;
	}
	.grid {
		list-style: none;
		margin: 0 0 1.5rem;
		padding: 0;
		display: grid;
		gap: 0.6rem;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr));
	}
	.grid li {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.7rem 0.8rem;
		border-radius: var(--radius-3);
		background: var(--color-bg-2);
		border: 1px solid var(--color-bg-3);
	}
	.grid-name {
		font-weight: 600;
		font-size: 0.92rem;
	}
	.grid-blurb {
		font-size: 0.8rem;
		color: color-mix(in oklch, var(--color-text) 58%, var(--color-bg));
		line-height: 1.4;
	}
	.link {
		color: light-dark(
			oklch(from var(--color-action) 0.45 c h),
			oklch(from var(--color-action) 0.82 c h)
		);
		font-weight: 600;
		text-decoration: none;
	}
	.link:hover {
		text-decoration: underline;
	}

	.closer {
		text-align: center;
		padding-block: clamp(3rem, 7vw, 6rem);
		border-top: 1px solid var(--color-bg-3);
		margin-top: clamp(2rem, 5vw, 4rem);
	}
	.closer h2 {
		font-size: clamp(1.5rem, 3.5vw, 2.25rem);
		letter-spacing: -0.02em;
		margin: 0 0 0.5rem;
	}
	.closer p {
		color: color-mix(in oklch, var(--color-text) 62%, var(--color-bg));
		max-width: 48ch;
		margin: 0 auto;
	}

	footer {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: center;
		align-items: center;
		padding: 2.5rem 1rem 3.5rem;
		color: color-mix(in oklch, var(--color-text) 58%, var(--color-bg));
		font-size: 0.88rem;
	}
	footer a {
		color: inherit;
		text-decoration: none;
	}
	footer a:hover {
		color: var(--color-text);
	}
</style>
