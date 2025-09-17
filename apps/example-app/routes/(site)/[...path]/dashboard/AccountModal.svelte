<script lang="ts" module>
	export interface AccountNotification {
		/** The ms epoch timestampe when the event took place */
		time: number;

		/** The main title text to describe the event */
		title: string;

		/** Extra context given to the notification event */
		subtitle?: string;

		/** The url/path that should be navigated to on click */
		href?: string;

		/** The function that should be called on click */
		action?: () => void;

		/** The url to the image to display beside the title text */
		image?: string;

		/** The icon that should be displayed when there isn't an image to display */
		icon?: string;

		/** The CSS color string that the icon/bg should be (when no image) */
		color?: string;
	}
</script>

<script lang="ts">
	import { goto } from '$app/navigation';
	import { focusTrap } from '@packages/lib';
	import { fade, scale, fly } from 'svelte/transition';
	import { backIn, backOut, quartOut } from 'svelte/easing';
	import { Button, List, ListItem } from '$lib/form';
	import LogOutIcon from '~icons/ion/log-out-outline';
	import DarkModeIcon from '~icons/material-symbols/dark-mode';
	import LightModeIcon from '~icons/material-symbols/light-mode';
	import OrgSwitcherIcon from '~icons/ion/chevron-expand';
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import type { AuthState } from '$lib/state';

	let {
		authState = undefined as undefined | AuthState,
		ondarkmodechange = (() => {}) as (darkMode: boolean) => void,
	} = $props();

	let hydrated = $state(false);
	const url = $derived(page.url);
	const opened = $derived(
		url.searchParams.get('modal') === '/account' && !url.searchParams.has('q'),
	);

	$effect(() => {
		hydrated = true;
	});

	export async function open() {
		if (opened) return;
		const newURL = new URL(url);
		newURL.searchParams.set('modal', '/account');
		await goto(newURL, { keepFocus: true, noScroll: true, replaceState: true });
	}

	export async function close() {
		if (!opened) return;
		const newURL = new URL(url);
		newURL.searchParams.delete('modal');
		await goto(newURL, { keepFocus: true, noScroll: true, replaceState: true });
	}

	function clickOutsideDeactivates(e: MouseEvent | TouchEvent) {
		const target = e.target as HTMLElement;
		return !target.classList?.contains('profile');
	}

	/** Creates a view transition between light and dark mode centered around the given element */
	function transitionDarkMode(darkMode: boolean | null, element?: HTMLElement) {
		if (darkMode === isDarkMode) return;
		if (darkMode === null) {
			window.localStorage.removeItem('theme');
		} else {
			window.localStorage.setItem('theme', darkMode ? 'dark' : 'light');
		}
		isDarkMode = darkMode;
		const newTheme = darkMode ? 'dark' : darkMode === null ? 'light dark' : 'light';
		const willBeDarkMode = darkMode === null ? isSystemDarkMode : darkMode;
		const shouldAnimate =
			'startViewTransition' in document &&
			!window.matchMedia(`(prefers-reduced-motion: reduce)`).matches;
		if (!shouldAnimate) {
			document.documentElement.style.colorScheme = newTheme;
		} else {
			document.documentElement.style.setProperty(
				'view-transition-name',
				'dark-mode-toggle',
			);
			document.documentElement.classList.add(
				`animating-to-${willBeDarkMode ? 'dark' : 'light'}`,
			);
			const transition = (document as any).startViewTransition(() => {
				document.documentElement.style.colorScheme = newTheme;
			});
			transition.ready.then(() => {
				const elBoundingBox = element?.getBoundingClientRect();
				const x = !elBoundingBox
					? window.innerWidth / 2
					: elBoundingBox.x + elBoundingBox.width / 2;
				const y = !elBoundingBox
					? window.innerHeight / 2
					: elBoundingBox.y + elBoundingBox.height / 2;
				const endRadius = Math.hypot(
					Math.max(x, window.innerWidth - x),
					Math.max(y, window.innerHeight - y),
				);
				const clipPath = [
					`circle(0px at ${x}px ${y}px)`,
					`circle(${endRadius}px at ${x}px ${y}px)`,
				];
				document.documentElement.animate(
					{
						clipPath: willBeDarkMode ? clipPath : [...clipPath].reverse(),
					},
					{
						duration: 300,
						easing: 'ease-in',
						pseudoElement: willBeDarkMode
							? '::view-transition-new(dark-mode-toggle)'
							: '::view-transition-old(dark-mode-toggle)',
					},
				);
			});
			transition.finished.then(() => {
				document.documentElement.classList.remove(
					`animating-to-${willBeDarkMode ? 'dark' : 'light'}`,
				);
				document.documentElement.style.removeProperty('view-transition-name');
			});
		}
	}

	let isSystemDarkMode = $state<boolean>(false);
	let isDarkMode = $state<boolean | null>(false);
	$effect(() => {
		untrack(() => {
			const colorScheme = document.documentElement.style.getPropertyValue('color-scheme');
			if (colorScheme === 'dark') {
				isDarkMode = true;
			} else if (colorScheme === 'light') {
				isDarkMode = false;
			} else {
				isDarkMode = null;
			}
		});
		const systemDarkModeListener = (event: MediaQueryListEvent) => {
			isSystemDarkMode = event.matches;
		};
		const watchDark = window.matchMedia('(prefers-color-scheme: dark)');
		isSystemDarkMode = watchDark.matches;
		watchDark.addEventListener('change', systemDarkModeListener);
		return () => watchDark.removeEventListener('change', systemDarkModeListener);
	});

	$effect(() => {
		ondarkmodechange(isDarkMode === null ? isSystemDarkMode : isDarkMode);
	});
</script>

<dialog
	open={opened}
	class:hydrated
	onclick={(e) => {
		if ((e.target as HTMLDialogElement).nodeName === 'DIALOG') {
			close();
		}
	}}
	use:focusTrap={{
		allowOutsideClick: true,
		clickOutsideDeactivates,
		checkCanFocusTrap: () => new Promise((resolve) => setTimeout(resolve, 10)),
		escapeDeactivates: true,
		onDeactivate: () => close(),
		enabled: opened,
	}}>
	<div class="profile-modal">
		<div
			class="content"
			in:fly={{ y: 50, duration: 200, easing: quartOut }}
			out:fade={{ duration: 100 }}>
			<Button
				transparent
				fullWidth
				href="/{authState?.orgID}/dashboard/settings/account"
				active={!!page.url.pathname.match(/\/dashboard\/settings\/account$/)}>
				Account Settings
			</Button>
			<Button transparent fullWidth popoverCloseOnInsideClick>
				{#snippet menu()}
					<div data-sveltekit-reload>
						{#if authState}
							<List>
								{#each authState.orgs as org}
									<ListItem
										active={authState.orgID === org.id}
										href="/{org.id}/dashboard">
										{org.name}
									</ListItem>
								{/each}
								<ListItem href="/account?new">Create New Family</ListItem>
							</List>
						{/if}
					</div>
				{/snippet}
				{authState?.org?.name || 'Select Family'}
				<OrgSwitcherIcon font-size=".8rem" />
			</Button>
		</div>
		<footer
			data-sveltekit-reload
			in:fly={{ y: 50, delay: 50, duration: 200, easing: quartOut }}
			out:fade={{ duration: 100 }}>
			<Button href="/signout" transparent fullWidth>
				<LogOutIcon /> Sign out
			</Button>
			<Button
				onclick={(e) => {
					let nextDarkMode: boolean | null = null;
					if (isDarkMode === null) {
						// The dark mode is currently set to system default, so go to the opposite
						// of the system default
						nextDarkMode = !isSystemDarkMode;
					} else {
						nextDarkMode = isDarkMode !== isSystemDarkMode ? !isDarkMode : null;
					}
					transitionDarkMode(nextDarkMode, e.target as HTMLElement);
				}}
				tooltip={isDarkMode === null
					? `Using system default (${isSystemDarkMode ? 'dark mode' : 'light mode'})`
					: isDarkMode !== isSystemDarkMode
						? `Using ${isDarkMode ? 'dark' : 'light'} mode, switch to ${!isDarkMode ? 'dark' : 'light'} mode`
						: `Using ${isDarkMode ? 'dark' : 'light'} mode, switch to system default`}
				transparent
				fullWidth>
				{#if isDarkMode === null}
					{#if isSystemDarkMode}
						<DarkModeIcon />
						Auto (Dark Mode)
					{:else}
						<LightModeIcon />
						Auto (Light Mode)
					{/if}
				{:else if isDarkMode}
					<DarkModeIcon />
					Dark Mode
				{:else}
					<LightModeIcon />
					Light Mode
				{/if}
			</Button>
		</footer>
		<div
			class="bg"
			in:scale={{ start: 0.75, duration: 250, easing: backOut }}
			out:scale={{ start: 0.15, duration: 150, easing: backIn }}>
		</div>
	</div>
</dialog>

<style lang="scss">
	:global(html) {
		&::view-transition-old(dark-mode-toggle),
		&::view-transition-new(dark-mode-toggle) {
			animation: none;
			mix-blend-mode: normal;
		}
		&::view-transition-old(dark-mode-toggle) {
			z-index: 9999;
		}
		&::view-transition-new(dark-mode-toggle) {
			z-index: 1;
		}
	}
	:global(html.animating-to-dark) {
		&::view-transition-old(dark-mode-toggle) {
			z-index: 1;
		}
		&::view-transition-new(dark-mode-toggle) {
			z-index: 9999;
		}
	}
	:global(html):has(dialog[open]) {
		overflow: hidden;
	}
	dialog {
		position: fixed;
		inset: 0;
		padding: 0;
		margin: 0;
		width: 100%;
		height: 100%;
		background-color: transparent;
		z-index: var(--layer-5);
		border: none;
		opacity: 0;
		transform: translateY(100px) scale(0.5);
		transform-origin: left bottom;
		@media (prefers-reduced-motion: no-preference) {
			transition:
				display 250ms allow-discrete,
				overlay 250ms allow-discrete,
				opacity 250ms var(--ease-out-6),
				transform 250ms var(--ease-out-6);
		}
		&[open] {
			transform: translateY(0px) scale(1);
			opacity: 1;
		}
		&.hydrated[open] {
			@starting-style {
				opacity: 0;
				transform: translateY(100px) scale(0.5);
			}
		}
	}
	.profile-modal {
		display: flex;
		flex-direction: column;
		color: var(--c-text);
		gap: 1rem;
		background-color: var(--c-bg-3);
		position: absolute;
		bottom: 4rem;
		left: 0px;
		top: 0px;
		width: 100%;
		@media (min-width: 768px) {
			padding: 1rem 1rem 0;
			top: unset;
			bottom: 0;
			left: 250px;
			right: unset;
			width: 500px;
			min-height: calc(250px + var(--radius-5) + 1rem);
			border-radius: var(--radius-5);
		}
	}
	.content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1rem 0;
		overflow-x: hidden;
		overflow-y: auto;
		max-height: calc(100vh - var(--navbar-width));
		flex: 1;
		@media (min-width: 768px) {
			max-height: calc(100vh - 7rem);
		}
	}
	footer {
		display: flex;
		height: 4rem;
		position: sticky;
		bottom: var(--navbar-size);
		background-color: var(--bg);
		@media (max-width: 768px) {
			:global(> .button button) {
				padding: 0.5rem;
			}
		}
		@media (min-width: 768px) {
			bottom: 0;
		}
		:global(.button) {
			flex: 1;
		}
	}
	.bg {
		background-color: var(--bg);
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: -2;
		@media (min-width: 768px) {
			border-radius: var(--radius-5);
			border-bottom-left-radius: 0;
			box-shadow: var(--shadow-3);
			transform-origin: bottom left;
		}
	}
</style>
