<script lang="ts">
	import { Button, Stat } from '@delightstack/components';
	import Badge from '$lib/Badge.svelte';

	const { data } = $props();
	const { auth } = $derived(data);

	const features = [
		{
			title: 'Family Directory',
			description: 'Keep track of every family member with profiles, contact info, and relationships.',
			icon: '👨‍👩‍👧‍👦',
			package: 'database',
		},
		{
			title: 'Shared Stories',
			description: 'Write and share family memories. Publish them publicly or keep them private.',
			icon: '📝',
			package: 'database',
		},
		{
			title: 'AI Writing Assistant',
			description: 'Get help writing your family stories with our built-in AI assistant.',
			icon: '✨',
			package: 'ai',
		},
		{
			title: 'Photo Gallery',
			description: 'Upload and organize family photos with automatic optimization and thumbnails.',
			icon: '🖼',
			package: 'images',
		},
		{
			title: 'Real-time Collaboration',
			description: 'See who is online and collaborate in real-time with your family members.',
			icon: '🔄',
			package: 'websocket',
		},
		{
			title: 'Secure Authentication',
			description: 'Email, password, and OAuth sign-in with invitations for family members.',
			icon: '🔐',
			package: 'auth',
		},
	];
</script>

<svelte:head>
	<title>Forever Family — Keep your family connected</title>
</svelte:head>

<div class="landing">
	<!-- Nav -->
	<nav class="nav">
		<a href="/" class="logo">Forever Family</a>
		<div class="nav-links">
			{#if auth.signed_in}
				<Button href="/dashboard" dense>Dashboard</Button>
			{:else}
				<Button href="/signin" transparent dense>Sign In</Button>
				<Button href="/signup" dense>Get Started</Button>
			{/if}
		</div>
	</nav>

	<!-- Hero -->
	<section class="hero">
		<Badge>Built with Delightstack</Badge>
		<h1>Keep Your Family<br />Connected Forever</h1>
		<p class="hero-subtitle">
			A simple platform to manage your family, share stories, upload photos,
			and stay connected — powered by the Delightstack framework.
		</p>
		<div class="hero-actions">
			<Button href="/signup">Start for Free</Button>
			<Button href="/signin" transparent>Sign In</Button>
		</div>
	</section>

	<!-- Stats -->
	<section class="stats">
		<div class="stat-item">
			<Stat label="Packages Showcased" value="8" />
		</div>
		<div class="stat-item">
			<Stat label="UI Components" value="50+" />
		</div>
		<div class="stat-item">
			<Stat label="Starting Price" value="$0/mo" />
		</div>
	</section>

	<!-- Features -->
	<section class="features">
		<h2>Everything Your Family Needs</h2>
		<div class="features-grid">
			{#each features as feature}
				<div class="feature-card">
					<span class="feature-icon">{feature.icon}</span>
					<h3>{feature.title}</h3>
					<p>{feature.description}</p>
					<Badge dense>@delightstack/{feature.package}</Badge>
				</div>
			{/each}
		</div>
	</section>

	<!-- Pricing -->
	<section class="pricing">
		<h2>Simple Pricing</h2>
		<p class="pricing-subtitle">Start free, upgrade when you need more</p>
		<div class="pricing-grid">
			<div class="pricing-card">
				<h3>Free</h3>
				<div class="price">$0<span>/month</span></div>
				<ul>
					<li>Unlimited family members</li>
					<li>Create and share posts</li>
					<li>Real-time collaboration</li>
					<li>Invite family members</li>
				</ul>
				<Button href="/signup" fullWidth transparent>Get Started</Button>
			</div>
			<div class="pricing-card featured">
				<Badge>Best Value</Badge>
				<h3>Family Pro</h3>
				<div class="price">$4.99<span>/month</span></div>
				<ul>
					<li>Everything in Free</li>
					<li>AI writing assistant</li>
					<li>Photo gallery & uploads</li>
					<li>Priority support</li>
				</ul>
				<Button href="/signup" fullWidth>Start Free Trial</Button>
			</div>
		</div>
	</section>

	<!-- CTA -->
	<section class="cta">
		<h2>Ready to connect your family?</h2>
		<p>Join Forever Family and start sharing memories today.</p>
		<Button href="/signup">Create Your Family Space</Button>
	</section>

	<!-- Footer -->
	<footer>
		<p>
			Built with
			<a href="https://github.com/anthropics/claude-code" target="_blank">Delightstack</a>
			— An example app showcasing the full framework.
		</p>
	</footer>
</div>

<style>
	.landing {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}

	/* Nav */
	.nav {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--size-3) var(--size-5);
		max-width: 1200px;
		width: 100%;
		margin: 0 auto;
	}
	.logo {
		font-family: var(--font-serif);
		font-size: var(--font-size-3);
		font-weight: var(--font-weight-7);
	}
	.nav-links {
		display: flex;
		gap: var(--size-2);
		align-items: center;
	}

	/* Hero */
	.hero {
		text-align: center;
		padding: var(--size-fluid-7) var(--size-5) var(--size-fluid-5);
		max-width: 800px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--size-4);
	}
	.hero h1 {
		font-family: var(--font-serif);
		font-size: var(--font-size-fluid-3);
		line-height: 1.1;
	}
	.hero-subtitle {
		font-size: var(--font-size-2);
		color: var(--color-text-disabled);
		max-width: var(--size-content-3);
		line-height: var(--font-lineheight-3);
	}
	.hero-actions {
		display: flex;
		gap: var(--size-3);
		align-items: center;
		margin-top: var(--size-3);
	}
	/* Stats */
	.stats {
		display: flex;
		justify-content: center;
		gap: var(--size-fluid-5);
		padding: var(--size-5);
		flex-wrap: wrap;
	}

	/* Features */
	.features {
		max-width: 1200px;
		margin: 0 auto;
		padding: var(--size-fluid-5) var(--size-5);
		text-align: center;
		h2 {
			font-family: var(--font-serif);
			margin-bottom: var(--size-5);
		}
	}
	.features-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: var(--size-4);
		text-align: left;
	}
	.feature-card {
		padding: var(--size-4);
		border: 1px solid var(--color-outline);
		border-radius: var(--radius-3);
		display: flex;
		flex-direction: column;
		gap: var(--size-2);
		transition: box-shadow 0.15s;
		&:hover { box-shadow: var(--shadow-2); }
		h3 { font-size: var(--font-size-2); }
		p { color: var(--color-text-disabled); font-size: var(--font-size-0); line-height: var(--font-lineheight-3); }
	}
	.feature-icon {
		font-size: var(--font-size-5);
	}

	/* Pricing */
	.pricing {
		max-width: 800px;
		margin: 0 auto;
		padding: var(--size-fluid-5) var(--size-5);
		text-align: center;
		h2 { font-family: var(--font-serif); }
	}
	.pricing-subtitle {
		color: var(--color-text-disabled);
		margin-bottom: var(--size-5);
	}
	.pricing-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: var(--size-4);
		text-align: left;
	}
	.pricing-card {
		padding: var(--size-5);
		border: 1px solid var(--color-outline);
		border-radius: var(--radius-3);
		display: flex;
		flex-direction: column;
		gap: var(--size-3);
		&.featured {
			border-color: var(--color-action);
			box-shadow: var(--shadow-2);
		}
		h3 { font-size: var(--font-size-3); }
		ul {
			list-style: none;
			padding: 0;
			display: flex;
			flex-direction: column;
			gap: var(--size-2);
			font-size: var(--font-size-0);
			flex: 1;
			li::before { content: '✓ '; color: var(--color-success); }
		}
	}
	.price {
		font-size: var(--font-size-5);
		font-weight: var(--font-weight-7);
		span {
			font-size: var(--font-size-1);
			font-weight: var(--font-weight-4);
			color: var(--color-text-disabled);
		}
	}

	/* CTA */
	.cta {
		text-align: center;
		padding: var(--size-fluid-5) var(--size-5);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--size-3);
		h2 { font-family: var(--font-serif); }
		p { color: var(--color-text-disabled); }
	}

	/* Footer */
	footer {
		text-align: center;
		padding: var(--size-5);
		border-top: 1px solid var(--color-outline);
		margin-top: auto;
		p {
			font-size: var(--font-size-0);
			color: var(--color-text-disabled);
		}
		a { color: var(--color-action); }
	}
</style>
