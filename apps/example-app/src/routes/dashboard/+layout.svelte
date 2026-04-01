<script lang="ts">
	import { Button, Avatar, AvatarGroup, ThemeToggle } from '@delightstack/components';
	import { tooltip } from '@delightstack/utilities';
	import { page } from '$app/state';

	const { data, children } = $props();
	const { auth, ws } = $derived(data);

	const current_path = $derived(page.url.pathname);

	// Connect WebSocket when dashboard mounts
	$effect(() => {
		if (auth.org_id) {
			ws.connect(auth.org_id);
			return () => ws.disconnect();
		}
	});

	const nav_items = [
		{ href: '/dashboard', label: 'Home', icon: '🏠' },
		{ href: '/dashboard/family', label: 'Family', icon: '👨‍👩‍👧‍👦' },
		{ href: '/dashboard/gallery', label: 'Gallery', icon: '🖼' },
		{ href: '/dashboard/members', label: 'Members', icon: '👥' },
		{ href: '/dashboard/billing', label: 'Billing', icon: '💳' },
		{ href: '/dashboard/settings', label: 'Settings', icon: '⚙' },
	];

	function isActive(href: string) {
		if (href === '/dashboard') return current_path === '/dashboard';
		return current_path.startsWith(href);
	}
</script>

<div class="dashboard">
	<!-- Sidebar (desktop) -->
	<nav class="sidebar mobile-hidden">
		<div class="sidebar-header">
			<h2>Forever Family</h2>
			<small>{auth.org?.name ?? 'My Family'}</small>
		</div>

		<div class="sidebar-nav">
			{#each nav_items as item}
				<a
					href={item.href}
					class="nav-item"
					class:active={isActive(item.href)}
				>
					<span class="nav-icon">{item.icon}</span>
					{item.label}
				</a>
			{/each}
		</div>

		<div class="sidebar-footer">
			<!-- Online presence -->
			{#if ws.connected && ws.sessions.length > 0}
				<div class="presence" {@attach tooltip('Online family members')}>
					<AvatarGroup max={3}>
						{#each ws.sessions as session}
							<Avatar name={session.meta?.user_name ?? 'User'} size="sm" />
						{/each}
					</AvatarGroup>
					<small>{ws.sessions.length} online</small>
				</div>
			{/if}

			<div class="footer-actions">
				<ThemeToggle />
				<Button href="/signin" transparent dense>Sign Out</Button>
			</div>
		</div>
	</nav>

	<!-- Main content -->
	<main class="content">
		{@render children()}
	</main>

	<!-- Bottom nav (mobile) -->
	<nav class="bottom-nav mobile-only">
		{#each nav_items.slice(0, 5) as item}
			<a
				href={item.href}
				class="bottom-nav-item"
				class:active={isActive(item.href)}
			>
				<span>{item.icon}</span>
				<small>{item.label}</small>
			</a>
		{/each}
	</nav>
</div>

<style>
	.dashboard {
		display: flex;
		min-height: 100vh;
	}

	/* Sidebar */
	.sidebar {
		width: 240px;
		border-right: 1px solid var(--color-outline);
		display: flex;
		flex-direction: column;
		padding: var(--size-4);
		gap: var(--size-4);
		position: sticky;
		top: 0;
		height: 100vh;
		overflow-y: auto;
		background: var(--color-bg-0);
	}
	.sidebar-header {
		padding-bottom: var(--size-3);
		border-bottom: 1px solid var(--color-outline);
		h2 {
			font-family: var(--font-serif);
			font-size: var(--font-size-3);
		}
		small {
			color: var(--color-text-disabled);
		}
	}
	.sidebar-nav {
		display: flex;
		flex-direction: column;
		gap: var(--size-1);
		flex: 1;
	}
	.nav-item {
		display: flex;
		align-items: center;
		gap: var(--size-2);
		padding: var(--size-2) var(--size-3);
		border-radius: var(--radius-3);
		color: var(--color-text);
		font-size: var(--font-size-0);
		transition: background 0.15s;
		&:hover {
			background: var(--color-bg-2);
		}
		&.active {
			background: var(--color-bg-3);
			font-weight: var(--font-weight-6);
		}
	}
	.nav-icon {
		font-size: var(--font-size-2);
		width: 1.5em;
		text-align: center;
	}

	.sidebar-footer {
		display: flex;
		flex-direction: column;
		gap: var(--size-3);
		padding-top: var(--size-3);
		border-top: 1px solid var(--color-outline);
	}
	.presence {
		display: flex;
		align-items: center;
		gap: var(--size-2);
		small {
			color: var(--color-text-disabled);
		}
	}
	.footer-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	/* Main content */
	.content {
		flex: 1;
		padding: var(--size-5);
		max-width: 960px;
		width: 100%;
		margin: 0 auto;
		@media (max-width: 767px) {
			padding: var(--size-3);
			padding-bottom: calc(var(--size-9) + var(--size-3));
		}
	}

	/* Bottom nav (mobile) */
	.bottom-nav {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		background: var(--color-bg-0);
		border-top: 1px solid var(--color-outline);
		display: flex;
		justify-content: space-around;
		padding: var(--size-2) 0;
		z-index: var(--layer-4);
	}
	.bottom-nav-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		color: var(--color-text-disabled);
		font-size: var(--font-size-00);
		&.active {
			color: var(--color-action);
		}
		span {
			font-size: var(--font-size-3);
		}
	}
</style>
