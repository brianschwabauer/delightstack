<script lang="ts">
	import { assets } from '$app/paths';
	import { page } from '$app/state';
	import Button from '$lib/form/Button.svelte';
	import { setContext, untrack } from 'svelte';
	import AccountModal from './AccountModal.svelte';
	import StoriesIcon from '~icons/hugeicons/notebook-02';
	import GalleryIcon from '~icons/hugeicons/image-01';
	import PeopleIcon from '~icons/hugeicons/user-group';
	import FamilyTreeIcon from '~icons/hugeicons/three-d-scale';
	import MapIcon from '~icons/hugeicons/maps-location-01';
	import ShareIcon from '~icons/hugeicons/share-01';
	import DocumentIcon from '~icons/hugeicons/document-attachment';
	import SupportIcon from '~icons/hugeicons/bubble-chat-question';
	import AccountIcon from '~icons/hugeicons/account-setting-01';
	import SearchIcon from '~icons/hugeicons/search-01';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { PostModal } from '$lib/modals/PostModal';

	const { children, data } = $props();
	const { auth } = $derived(data);
	setContext('auth', data.auth);

	let isDarkMode = $state<boolean>(false);
	$effect.pre(() => {
		untrack(() => {
			const colorScheme = document.documentElement.style.getPropertyValue('color-scheme');
			if (colorScheme === 'dark') {
				isDarkMode = true;
			} else if (colorScheme === 'light') {
				isDarkMode = false;
			} else {
				isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
			}
		});
	});

	// Forever Family Mobile Menu Bar
	// - Search (search for people, stories, etc)
	// - Memories (or stories/posts)
	// - People
	// - Documents
	// - Account
	//    - Support (link to support page & email)
	//    - Notifications, upload progress, switch org/families, sign out, dark/light mode
	//    - Profile Settings
	//    - Billing Settings
	//    - Subscription Settings
	//    - Security Settings
	//    - Integrations
</script>

<svelte:head>
	<script>
		(() => {
			const preference = window.localStorage.getItem('theme');
			if (preference === 'dark' || preference === 'light') {
				document.documentElement.style.colorScheme = preference;
			} else {
				document.documentElement.style.removeProperty('color-scheme');
			}
		})();
	</script>
</svelte:head>

<div class="page">
	{#if !!page.url.pathname.match(/\/dashboard(\/(gallery|map|document))?$/)}
		<nav class="mobile-submenu" transition:slide={{ duration: 150, easing: cubicOut }}>
			<Button
				round
				dense
				transparent
				href="/{auth.org_id}/dashboard"
				active={!!page.url.pathname.match(/\/dashboard$/)}>
				Stories
			</Button>
			<Button
				round
				dense
				transparent
				href="/{auth.org_id}/dashboard/gallery"
				active={!!page.url.pathname.match(/\/dashboard\/gallery$/)}>
				Gallery
			</Button>
			<Button
				round
				dense
				transparent
				href="/{auth.org_id}/dashboard/map"
				active={!!page.url.pathname.match(/\/dashboard\/map$/)}>
				Map
			</Button>
			<Button
				round
				dense
				transparent
				href="/{auth.org_id}/dashboard/document"
				active={!!page.url.pathname.match(/\/dashboard\/document$/)}>
				Documents
			</Button>
		</nav>
	{/if}
	{#if !!page.url.pathname.match(/\/dashboard\/(person|family|share)$/)}
		<nav class="mobile-submenu" transition:slide={{ duration: 150, easing: cubicOut }}>
			<Button
				round
				dense
				transparent
				href="/{auth.org_id}/dashboard/person"
				active={!!page.url.pathname.match(/\/dashboard\/person$/)}>
				Directory
			</Button>
			<Button
				round
				dense
				transparent
				href="/{auth.org_id}/dashboard/family"
				active={!!page.url.pathname.match(/\/dashboard\/family$/)}>
				Family Tree
			</Button>
			<Button
				round
				dense
				transparent
				href="/{auth.org_id}/dashboard/share"
				active={!!page.url.pathname.match(/\/dashboard\/share$/)}>
				Share
			</Button>
		</nav>
	{/if}
	<nav class="mobile">
		<Button transparent href="?q" active={!!page.url.searchParams.has('q')}>
			<SearchIcon /> Search
		</Button>
		<Button
			transparent
			href="/{auth.org_id}/dashboard"
			active={!!page.url.pathname.match(/\/dashboard$/)}>
			<StoriesIcon /> Memories
		</Button>
		<Button
			transparent
			href="/{auth.org_id}/dashboard/person"
			active={!!page.url.pathname.match(/\/dashboard\/person$/)}>
			<PeopleIcon /> People
		</Button>
		<Button
			transparent
			href="?modal=/account"
			active={!!page.url.searchParams.get('modal')?.startsWith('/account')}>
			<AccountIcon /> Account
		</Button>
	</nav>
	<nav class="sidebar">
		<div class="logo">
			<img src="{assets}/logo.svg" alt="Forever Family Logo" class:invert={isDarkMode} />
		</div>
		<div class="new">
			<Button fullWidth href="?modal=/post/new">Create New</Button>
		</div>
		<div class="links">
			<Button
				transparent
				fullWidth
				href="/{auth.org_id}/dashboard"
				active={!!page.url.pathname.match(/\/dashboard$/)}>
				<StoriesIcon /> Stories
			</Button>
			<Button
				transparent
				fullWidth
				href="/{auth.org_id}/dashboard/gallery"
				active={!!page.url.pathname.match(/\/dashboard\/gallery$/)}>
				<GalleryIcon /> Gallery
			</Button>
			<Button
				transparent
				fullWidth
				href="/{auth.org_id}/dashboard/person"
				active={!!page.url.pathname.match(/\/dashboard\/person$/)}>
				<PeopleIcon /> People
			</Button>
			<Button
				transparent
				fullWidth
				href="/{auth.org_id}/dashboard/family"
				active={!!page.url.pathname.match(/\/dashboard\/family$/)}>
				<FamilyTreeIcon /> Family Tree
			</Button>
			<Button
				transparent
				fullWidth
				href="/{auth.org_id}/dashboard/map"
				active={!!page.url.pathname.match(/\/dashboard\/map$/)}>
				<MapIcon /> Map
			</Button>
			<Button
				transparent
				fullWidth
				href="/{auth.org_id}/dashboard/document"
				active={!!page.url.pathname.match(/\/dashboard\/document$/)}>
				<DocumentIcon /> Documents
			</Button>
			<Button
				transparent
				fullWidth
				href="/{auth.org_id}/dashboard/share"
				active={!!page.url.pathname.match(/\/dashboard\/share$/)}>
				<ShareIcon /> Share
			</Button>
		</div>
		<!-- <small style="margin-top: 2rem; width: 100%; text-align: center;">
			WebSockets {auth.ws_status.toUpperCase()}
		</small>
		<small style="margin-top: 0rem; width: 100%; text-align: center;">
			WebSocket Clients {auth.ws_num_connected}
		</small> -->
		<div style="flex: 1;"></div>
		<div class="links">
			<Button
				transparent
				fullWidth
				href="/{auth.org_id}/dashboard/support"
				active={!!page.url.pathname.match(/\/dashboard\/support$/)}>
				<SupportIcon /> Support
			</Button>
			<Button
				transparent
				fullWidth
				href="?modal=/account"
				active={!!page.url.searchParams.get('modal')?.startsWith('/account')}>
				<AccountIcon /> Account
			</Button>
			<AccountModal {auth} ondarkmodechange={(darkMode) => (isDarkMode = darkMode)}
			></AccountModal>
		</div>
	</nav>
	{@render children()}
</div>

<PostModal></PostModal>

<style>
	nav.mobile {
		display: flex;
		flex-direction: row;
		padding: 0;
		background-color: var(--color-bg-2);
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		width: 100%;
		height: 3.75rem;
		z-index: var(--layer-5);
		--action-radius: 0;
		:global(> .button) {
			flex: 1;
		}
		:global(> .button button),
		:global(> .button a) {
			padding: 2px 0 0;
			display: flex;
			flex-direction: column;
			gap: 0px;
			font-size: 0.85rem;
			width: 100%;
			:global(svg) {
				width: 1.5rem;
				height: 1.5rem;
			}
		}
		@media (min-width: 768px) {
			display: none;
		}
	}
	nav.mobile-submenu {
		display: flex;
		justify-content: center;
		flex-direction: row;
		padding: 0.25rem;
		position: fixed;
		bottom: 3.75rem;
		left: 0;
		right: 0;
		width: 100%;
		height: 2.75rem;
		gap: 0.5rem;
		z-index: var(--layer-5);
		backdrop-filter: blur(15px);
		background-color: rgb(from var(--color-bg-2) r g b / 0.8);
		font-size: 0.9rem;
		@media (min-width: 768px) {
			display: none;
		}
	}
	nav.sidebar {
		display: none;
		width: clamp(200px, 15vw, 250px);
		flex-direction: column;
		align-items: center;
		background-color: var(--color-bg-2);
		height: 100vh;
		padding: 1rem;
		gap: 0.5rem;
		flex-shrink: 0;
		position: sticky;
		top: 0;
		.new {
			width: 100%;
			margin: 1rem 0;
			:global(> .button button),
			:global(> .button a) {
				font-size: var(--font-size-2);
			}
		}
		@media (min-width: 768px) {
			display: flex;
		}
		.links {
			display: flex;
			flex-direction: column;
			gap: 0.25rem;
			width: 100%;
			:global(> .button button),
			:global(> .button a) {
				justify-content: start;
				text-align: left;
				font-size: var(--font-size-2);
				padding: 0.75em 1rem;
			}
		}
	}
	.page {
		display: flex;
	}
	.logo {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 30px;
		margin: 0.5rem 0 0;
		img {
			width: 100%;
			height: 100%;
			max-width: 200px;
			&.invert {
				filter: invert(1) grayscale(1);
			}
		}
	}
</style>
