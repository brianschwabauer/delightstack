<script lang="ts">
	import {
		Button,
		AvatarGroup,
		ThemeToggle,
		List,
		ListItem,
	} from '@delightstack/components';
	import { tooltip } from '@delightstack/utilities';
	import { setPresence, trackCursor } from '@delightstack/presence';
	import { Cursors, Reactions } from '@delightstack/presence/components';
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Icon from '$lib/Icon.svelte';

	const { data, children } = $props();
	const { auth, ws, presence } = $derived(data);

	const current_path = $derived(page.url.pathname);

	// Make presence available to every dashboard route. The client is a stable
	// per-load singleton, so capture it once (untrack avoids a reactivity warning).
	setPresence(untrack(() => presence));

	// Connect WebSocket when dashboard mounts (db is initialized in +layout.ts).
	$effect(() => {
		if (auth.org_id) {
			ws.connect(auth.org_id);
			return () => ws.disconnect();
		}
	});

	// Start presence alongside the connection; scope it to the current route.
	$effect(() => {
		presence.start();
		return () => presence.destroy();
	});
	$effect(() => {
		presence.setPage(current_path);
	});

	const nav_items = [
		{ href: '/dashboard', label: 'Home', icon: 'home' },
		{ href: '/dashboard/family', label: 'Family', icon: 'family' },
		{ href: '/dashboard/gallery', label: 'Gallery', icon: 'gallery' },
		{ href: '/dashboard/members', label: 'Members', icon: 'members' },
		{ href: '/dashboard/search-lab', label: 'Search Lab', icon: 'flask' },
		{ href: '/dashboard/presence', label: 'Presence', icon: 'eye' },
		{ href: '/dashboard/billing', label: 'Billing', icon: 'billing' },
		{ href: '/dashboard/settings', label: 'Settings', icon: 'settings' },
	] as const;

	function isActive(href: string) {
		if (href === '/dashboard') return current_path === '/dashboard';
		return current_path.startsWith(href);
	}

	async function signOut() {
		await auth.signOut();
		goto('/signin');
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
			<List>
				{#each nav_items as item (item.href)}
					<ListItem href={item.href} active={isActive(item.href)}>
						<span class="nav-icon"><Icon name={item.icon} size={18} /></span>
						{item.label}
					</ListItem>
				{/each}
			</List>
		</div>

		<div class="sidebar-footer">
			<!-- Online presence -->
			{#if ws.connected && ws.sessions.length > 0}
				<div class="presence" {@attach tooltip('Online family members')}>
					<AvatarGroup
						avatars={ws.sessions.map((s) => ({ name: s.meta?.user_name ?? 'User' }))}
						max={3}
						size="0" />
					<small>{ws.sessions.length} online</small>
				</div>
			{/if}

			<div class="footer-actions">
				<ThemeToggle />
				<Button onclick={signOut} transparent dense>Sign Out</Button>
			</div>
		</div>
	</nav>

	<!-- Main content (presence stage — cursors are tracked within it) -->
	<main
		class="content"
		class:wide={current_path.startsWith('/dashboard/search-lab')}
		data-presence-stage="dashboard"
		{@attach trackCursor({ chat: true })}>
		{@render children()}
	</main>

	<!-- Bottom nav (mobile) -->
	<nav class="bottom-nav mobile-only">
		{#each nav_items.slice(0, 5) as item (item.href)}
			<a href={item.href} class="bottom-nav-item" class:active={isActive(item.href)}>
				<Icon name={item.icon} size={22} />
				<small>{item.label}</small>
			</a>
		{/each}
	</nav>

	<!-- Live presence overlays — render only for peers on the same route -->
	<Cursors />
	<Reactions />
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
		flex: 1;
	}
	.nav-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5em;
		color: var(--color-text-disabled);
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

		/* The Search Lab runs a controls column beside results and a map; 960px
		   pinches both. Every other route keeps the reading measure. */
		&.wide {
			max-width: 1400px;
		}
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
	}
</style>
