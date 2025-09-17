<!-- svelte-ignore state_referenced_locally -->
<script lang="ts">
	import { page } from '$app/state';
	import { toast } from '$lib/components';
	import Expand from '$lib/components/Expand.svelte';
	import Button from '$lib/form/Button.svelte';
	import Input from '$lib/form/Input.svelte';
	import type { AuthState } from '$lib/state';
	import { ApiError } from '@packages/lib';

	let {
		authState,
		style,
		mode = $bindable('signin'),
		redirect: redirectProp,
		allowPasswordless = false,
	}: {
		authState: AuthState;
		style?: string;
		mode?: 'signin' | 'signup';
		redirect?: string;
		/** Allow "magic link" sign ins (no password required, and a link sent to their email) */
		allowPasswordless?: boolean;
	} = $props();

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let signing_in = $state(false);
	let email_signin_link_sent = $state(false);
	const signed_in = authState.signed_in;
	const redirect_url = $derived.by(() => {
		let path = redirectProp || page.url.searchParams.get('redirect');
		if (!path) return '';
		if (!path.startsWith('/')) {
			const invalid_url =
				!path.match(/^https?:\/\//) || new URL(path).host !== page.url.host;
			if (invalid_url) path = '/';
		}
		if (path === '/' || path === '/dashboard') return '';
		return path;
	});
	const redirect_param = $derived(
		!redirect_url ? '' : `redirect=${encodeURIComponent(redirect_url)}`,
	);

	async function submit() {
		if (!email || (!password && !allowPasswordless) || signing_in) return;
		if (mode === 'signup' && !name) return;
		if (email_signin_link_sent) return;
		signing_in = true;
		const response = await fetch(
			`/${mode}${redirect_param ? '?' : ''}${redirect_param}`,
			{
				method: 'POST',
				body: JSON.stringify({ email, password: password || undefined, name }),
				headers: { 'Content-Type': 'application/json' },
			},
		);
		signing_in = false;
		if (!response.ok) {
			const error = await response.json();
			toast.error(ApiError.from(error).toString());
			throw error;
		}
		if (!password) {
			email_signin_link_sent = true;
			toast(
				`A ${mode === 'signin' ? 'sign-in' : 'sign-up'} link has been sent to your email. Please check your inbox and click the link to continue.`,
			);
			return;
		}

		const params = new URLSearchParams(page.url.search);
		params.delete('redirect');
		if (mode === 'signup') params.set('toast', `Email verification link sent!`);
		window.location.href =
			(redirect_url || '/') === '/'
				? `/dashboard?${params.toString()}`
				: `${redirect_url}?${params.toString()}`;
	}
</script>

<div class="signin-form" {style} data-sveltekit-reload>
	{#if signed_in}
		<Button style="margin: .25rem 0;" fullWidth href="/dashboard">Go to Dashboard</Button>
		<Button style="margin: .25rem 0;" fullWidth transparent href="/signout">
			Sign Out
		</Button>
	{:else}
		<Button
			style="margin-top: 1rem;"
			fullWidth
			translucent
			href="/signin/google{redirect_param ? '?' : ''}{redirect_param}">
			<img
				src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiA/PjxzdmcgaWQ9IkNhcGFfMSIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgMTUwIDE1MDsiIHZlcnNpb249IjEuMSIgdmlld0JveD0iMCAwIDE1MCAxNTAiIHhtbDpzcGFjZT0icHJlc2VydmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiPjxzdHlsZSB0eXBlPSJ0ZXh0L2NzcyI+Cgkuc3Qwe2ZpbGw6IzFBNzNFODt9Cgkuc3Qxe2ZpbGw6I0VBNDMzNTt9Cgkuc3Qye2ZpbGw6IzQyODVGNDt9Cgkuc3Qze2ZpbGw6I0ZCQkMwNDt9Cgkuc3Q0e2ZpbGw6IzM0QTg1Mzt9Cgkuc3Q1e2ZpbGw6IzRDQUY1MDt9Cgkuc3Q2e2ZpbGw6IzFFODhFNTt9Cgkuc3Q3e2ZpbGw6I0U1MzkzNTt9Cgkuc3Q4e2ZpbGw6I0M2MjgyODt9Cgkuc3Q5e2ZpbGw6I0ZCQzAyRDt9Cgkuc3QxMHtmaWxsOiMxNTY1QzA7fQoJLnN0MTF7ZmlsbDojMkU3RDMyO30KCS5zdDEye2ZpbGw6I0Y2QjcwNDt9Cgkuc3QxM3tmaWxsOiNFNTQzMzU7fQoJLnN0MTR7ZmlsbDojNDI4MEVGO30KCS5zdDE1e2ZpbGw6IzM0QTM1Mzt9Cgkuc3QxNntjbGlwLXBhdGg6dXJsKCNTVkdJRF8yXyk7fQoJLnN0MTd7ZmlsbDojMTg4MDM4O30KCS5zdDE4e29wYWNpdHk6MC4yO2ZpbGw6I0ZGRkZGRjtlbmFibGUtYmFja2dyb3VuZDpuZXcgICAgO30KCS5zdDE5e29wYWNpdHk6MC4zO2ZpbGw6IzBENjUyRDtlbmFibGUtYmFja2dyb3VuZDpuZXcgICAgO30KCS5zdDIwe2NsaXAtcGF0aDp1cmwoI1NWR0lEXzRfKTt9Cgkuc3QyMXtvcGFjaXR5OjAuMztmaWxsOnVybCgjXzQ1X3NoYWRvd18xXyk7ZW5hYmxlLWJhY2tncm91bmQ6bmV3ICAgIDt9Cgkuc3QyMntjbGlwLXBhdGg6dXJsKCNTVkdJRF82Xyk7fQoJLnN0MjN7ZmlsbDojRkE3QjE3O30KCS5zdDI0e29wYWNpdHk6MC4zO2ZpbGw6IzE3NEVBNjtlbmFibGUtYmFja2dyb3VuZDpuZXcgICAgO30KCS5zdDI1e29wYWNpdHk6MC4zO2ZpbGw6I0E1MEUwRTtlbmFibGUtYmFja2dyb3VuZDpuZXcgICAgO30KCS5zdDI2e29wYWNpdHk6MC4zO2ZpbGw6I0UzNzQwMDtlbmFibGUtYmFja2dyb3VuZDpuZXcgICAgO30KCS5zdDI3e2ZpbGw6dXJsKCNGaW5pc2hfbWFza18xXyk7fQoJLnN0Mjh7ZmlsbDojRkZGRkZGO30KCS5zdDI5e2ZpbGw6IzBDOUQ1ODt9Cgkuc3QzMHtvcGFjaXR5OjAuMjtmaWxsOiMwMDRENDA7ZW5hYmxlLWJhY2tncm91bmQ6bmV3ICAgIDt9Cgkuc3QzMXtvcGFjaXR5OjAuMjtmaWxsOiMzRTI3MjM7ZW5hYmxlLWJhY2tncm91bmQ6bmV3ICAgIDt9Cgkuc3QzMntmaWxsOiNGRkMxMDc7fQoJLnN0MzN7b3BhY2l0eTowLjI7ZmlsbDojMUEyMzdFO2VuYWJsZS1iYWNrZ3JvdW5kOm5ldyAgICA7fQoJLnN0MzR7b3BhY2l0eTowLjI7fQoJLnN0MzV7ZmlsbDojMUEyMzdFO30KCS5zdDM2e2ZpbGw6dXJsKCNTVkdJRF83Xyk7fQoJLnN0Mzd7ZmlsbDojRkJCQzA1O30KCS5zdDM4e2NsaXAtcGF0aDp1cmwoI1NWR0lEXzlfKTtmaWxsOiNFNTM5MzU7fQoJLnN0Mzl7Y2xpcC1wYXRoOnVybCgjU1ZHSURfMTFfKTtmaWxsOiNGQkMwMkQ7fQoJLnN0NDB7Y2xpcC1wYXRoOnVybCgjU1ZHSURfMTNfKTtmaWxsOiNFNTM5MzU7fQoJLnN0NDF7Y2xpcC1wYXRoOnVybCgjU1ZHSURfMTVfKTtmaWxsOiNGQkMwMkQ7fQo8L3N0eWxlPjxnPjxwYXRoIGNsYXNzPSJzdDE0IiBkPSJNMTIwLDc2LjFjMC0zLjEtMC4zLTYuMy0wLjgtOS4zSDc1Ljl2MTcuN2gyNC44Yy0xLDUuNy00LjMsMTAuNy05LjIsMTMuOWwxNC44LDExLjUgICBDMTE1LDEwMS44LDEyMCw5MCwxMjAsNzYuMUwxMjAsNzYuMXoiLz48cGF0aCBjbGFzcz0ic3QxNSIgZD0iTTc1LjksMTIwLjljMTIuNCwwLDIyLjgtNC4xLDMwLjQtMTEuMUw5MS41LDk4LjRjLTQuMSwyLjgtOS40LDQuNC0xNS42LDQuNGMtMTIsMC0yMi4xLTguMS0yNS44LTE4LjkgICBMMzQuOSw5NS42QzQyLjcsMTExLjEsNTguNSwxMjAuOSw3NS45LDEyMC45eiIvPjxwYXRoIGNsYXNzPSJzdDEyIiBkPSJNNTAuMSw4My44Yy0xLjktNS43LTEuOS0xMS45LDAtMTcuNkwzNC45LDU0LjRjLTYuNSwxMy02LjUsMjguMywwLDQxLjJMNTAuMSw4My44eiIvPjxwYXRoIGNsYXNzPSJzdDEzIiBkPSJNNzUuOSw0Ny4zYzYuNS0wLjEsMTIuOSwyLjQsMTcuNiw2LjlMMTA2LjYsNDFDOTguMywzMy4yLDg3LjMsMjksNzUuOSwyOS4xYy0xNy40LDAtMzMuMiw5LjgtNDEsMjUuMyAgIGwxNS4yLDExLjhDNTMuOCw1NS4zLDYzLjksNDcuMyw3NS45LDQ3LjN6Ii8+PC9nPjwvc3ZnPg=="
				width="32"
				height="32"
				alt="Google Logo" />
			Continue with Google
		</Button>
		<div class="separator">Or {mode === 'signin' ? 'Sign In' : 'Sign Up'} With Email</div>
		<Expand show={mode === 'signup'} style="width: 100%;">
			<Input
				style="margin-bottom: .75rem;"
				type="text"
				multiple={false}
				label="Name"
				onsubmit={submit}
				bind:value={name}></Input>
		</Expand>
		<Input
			style="margin-bottom: .75rem;"
			type="email"
			multiple={false}
			label="Email"
			onsubmit={submit}
			bind:value={email}></Input>
		<Input
			style="margin-bottom: .75rem;"
			type="password"
			multiple={false}
			label="Password"
			onsubmit={submit}
			bind:value={password}></Input>
		<div style="display: flex; width: 100%; gap: .5rem; margin-top: 1rem;">
			<Button
				fullWidth
				transparent={mode === 'signup'}
				loading={signing_in && mode === 'signin'}
				disabled={email_signin_link_sent ||
					(mode === 'signin' && (!email || (!password && !allowPasswordless)))}
				onclick={() => {
					if (mode === 'signup') mode = 'signin';
					else return submit();
				}}>
				Sign In
			</Button>
			<Button
				fullWidth
				transparent={mode === 'signin'}
				loading={signing_in && mode === 'signup'}
				disabled={email_signin_link_sent ||
					(mode === 'signup' && (!name || !email || (!password && !allowPasswordless)))}
				onclick={() => {
					if (mode === 'signin') mode = 'signup';
					else return submit();
				}}>
				Sign Up
			</Button>
		</div>
		<Expand show={mode === 'signin'}>
			<a
				class="reset-password"
				href="/account/reset-password?redirect={encodeURIComponent(page.url.pathname)}">
				Forgot Password?
			</a>
		</Expand>
	{/if}
</div>

<style>
	.signin-form {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: 100%;
		:global(.input) {
			width: 100%;
		}
	}
	.reset-password {
		display: block;
		margin-top: 1rem;
		color: var(--c-text-disabled);
		font-size: 0.85rem;
		transition: color 100ms ease;
		&:hover,
		&:focus-visible {
			color: var(--c-text);
		}
	}
	.separator {
		margin: 1.25rem 0;
		color: var(--c-text-disabled);
		font-size: 0.8rem;
		display: flex;
		align-items: center;
		width: 100%;
		gap: 0.5rem;
		&:before {
			content: '';
			flex: 1;
			height: 1px;
			background-color: var(--c-outline);
		}
		&:after {
			content: '';
			flex: 1;
			height: 1px;
			background-color: var(--c-outline);
		}
	}
</style>
