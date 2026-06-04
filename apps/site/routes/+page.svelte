<script lang="ts">
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
		{
			name: 'Auth',
			blurb: 'JWT sessions, Argon2id, OAuth, multi-org, guards',
			slug: 'auth',
		},
		{
			name: 'Database',
			blurb: 'Reactive SQLite on Durable Objects + search',
			slug: 'database',
		},
		{
			name: 'Realtime',
			blurb: 'Room-scoped WebSockets with live presence',
			slug: 'websocket',
		},
		{ name: 'AI', blurb: 'Chat, resumable streaming, vector embeddings', slug: 'ai' },
		{
			name: 'Billing',
			blurb: 'Stripe subscriptions, metered usage, webhooks',
			slug: 'stripe',
		},
		{
			name: 'Images',
			blurb: 'Variants, ThumbHash, EXIF, face-aware crops',
			slug: 'images',
		},
	];
</script>

<svelte:head>
	<title>Delightstack — Svelte 5 components + an edge-native Cloudflare backend</title>
	<meta
		name="description"
		content="Two products, one design language: a polished Svelte 5 component library and an edge-native backend for Cloudflare. Use either, or both." />
</svelte:head>

<header class="nav">
	<a class="brand" href="/">
		<img src="/delightstack_brandmark.svg" alt="" width="28" height="28" />
		<span>delightstack</span>
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
			<a class="btn primary" href="{DOCS}/components/overview/">Browse components →</a>
			<a class="btn" href="{DOCS}/stack/overview/">Explore the stack →</a>
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
			<a class="btn primary" href={EXAMPLE}>View the live example →</a>
			<a class="btn" href={GITHUB}>Star on GitHub</a>
		</div>
	</section>
</main>

<footer>
	<span>MIT licensed</span>
	<span>·</span>
	<a href={GITHUB}>github.com/brianschwabauer/delightstack</a>
</footer>

<style>
	:global(:root) {
		color-scheme: light dark;
		--bg: light-dark(#ffffff, #0b0f14);
		--bg-soft: light-dark(#f6f8f8, #11161c);
		--text: light-dark(#0e1a1f, #e8eef0);
		--muted: light-dark(#5a6b70, #94a6ab);
		--border: light-dark(rgb(0 0 0 / 0.09), rgb(255 255 255 / 0.1));
		--accent: light-dark(#0e4a59, #34c3a8);
		--accent-ink: light-dark(#ffffff, #04110d);
	}
	:global(body) {
		margin: 0;
		background: var(--bg);
		color: var(--text);
		font-family:
			ui-sans-serif,
			system-ui,
			-apple-system,
			'Segoe UI',
			sans-serif;
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
		gap: 0.5rem;
		font-weight: 650;
		letter-spacing: -0.01em;
		color: var(--text);
		text-decoration: none;
	}
	.nav-links {
		display: flex;
		gap: clamp(0.75rem, 3vw, 1.75rem);
	}
	.nav-links a {
		color: var(--muted);
		text-decoration: none;
		font-size: 0.95rem;
		transition: color 200ms;
	}
	.nav-links a:hover {
		color: var(--text);
	}

	main {
		max-width: 72rem;
		margin: 0 auto;
		padding: 0 clamp(1rem, 4vw, 2rem);
	}

	.hero {
		position: relative;
		text-align: center;
		padding-block: clamp(3rem, 9vw, 7rem) clamp(2.5rem, 6vw, 5rem);
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
			color-mix(in oklch, var(--accent) 30%, transparent),
			transparent 70%
		);
		filter: blur(50px);
		opacity: 0.5;
	}
	.logo {
		width: min(30rem, 80vw);
		height: auto;
		margin-bottom: 2rem;
	}
	.hero h1 {
		font-size: clamp(2rem, 5.5vw, 3.5rem);
		line-height: 1.08;
		letter-spacing: -0.03em;
		margin: 0 auto 1rem;
		max-width: 16ch;
	}
	.lede {
		margin: 0 auto;
		max-width: 52ch;
		font-size: clamp(1.05rem, 2vw, 1.3rem);
		color: var(--muted);
	}
	.lede strong {
		color: var(--text);
		font-weight: 600;
	}

	.cta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		justify-content: center;
		margin-top: 2rem;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		padding: 0.7rem 1.3rem;
		border-radius: 0.7rem;
		border: 1px solid var(--border);
		background: var(--bg-soft);
		color: var(--text);
		font-weight: 550;
		font-size: 0.98rem;
		text-decoration: none;
		transition:
			transform 200ms,
			border-color 200ms,
			background 0ms;
	}
	.btn:hover {
		transform: translateY(-2px);
		border-color: color-mix(in oklch, var(--accent) 50%, var(--border));
	}
	.btn.primary {
		background: var(--accent);
		color: var(--accent-ink);
		border-color: transparent;
	}

	.products {
		display: grid;
		gap: 1.5rem;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 24rem), 1fr));
		padding-block: clamp(2rem, 5vw, 4rem);
	}
	.product {
		border: 1px solid var(--border);
		border-radius: 1.25rem;
		padding: clamp(1.5rem, 3vw, 2.25rem);
		background: var(--bg-soft);
	}
	.kicker {
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--accent);
		font-weight: 650;
	}
	.product h2 {
		font-size: clamp(1.6rem, 3vw, 2rem);
		letter-spacing: -0.02em;
		margin: 0.25rem 0 0.6rem;
	}
	.product > p {
		color: var(--muted);
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
		border-radius: 0.6rem;
		background: var(--bg);
		border: 1px solid var(--border);
	}
	.grid-name {
		font-weight: 600;
		font-size: 0.92rem;
	}
	.grid-blurb {
		font-size: 0.8rem;
		color: var(--muted);
		line-height: 1.4;
	}
	.link {
		color: var(--accent);
		font-weight: 600;
		text-decoration: none;
	}
	.link:hover {
		text-decoration: underline;
	}

	.closer {
		text-align: center;
		padding-block: clamp(3rem, 7vw, 6rem);
		border-top: 1px solid var(--border);
		margin-top: clamp(2rem, 5vw, 4rem);
	}
	.closer h2 {
		font-size: clamp(1.5rem, 3.5vw, 2.25rem);
		letter-spacing: -0.02em;
		margin: 0 0 0.5rem;
	}
	.closer p {
		color: var(--muted);
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
		color: var(--muted);
		font-size: 0.88rem;
	}
	footer a {
		color: var(--muted);
		text-decoration: none;
	}
	footer a:hover {
		color: var(--text);
	}

	@media (prefers-reduced-motion: reduce) {
		.btn {
			transition: none;
		}
	}
</style>
