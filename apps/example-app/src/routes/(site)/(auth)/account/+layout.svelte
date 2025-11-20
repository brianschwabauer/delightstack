<script lang="ts">
	import { page } from '$app/state';
	import Button from '$lib/form/Button.svelte';
	import BackArrowIcon from '~icons/material-symbols/arrow-back';

	const { data, children } = $props();
	const { authState } = $derived(data);

	const orgID = $derived(page.params.org_id || authState.orgID);
	const backUrl = $derived.by(() => {
		const params = new URLSearchParams(page.url.search);
		const redirect = params.get('redirect');
		params.delete('subscribe_to');
		params.delete('org');
		params.delete('redirect');
		if (authState.signed_out) {
			if (page.url.pathname.startsWith('/account/reset-password') && redirect) {
				return redirect;
			}
			return `/signin`;
		}
		if (!authState.verified) return `/signout`;
		const hasActiveSubscription =
			authState.org?.subscription_status === 'active' ||
			authState.org?.subscription_status === 'trialing' ||
			authState.org?.subscription_status === 'past_due';
		if (hasActiveSubscription) {
			if (
				page.url.pathname.match(/^\/account\/([^\/]+)\/payment/) &&
				page.url.searchParams.has('subscribe_to')
			) {
				return `/account/${orgID}/subscription${params.size ? `?${params}` : ''}`;
			}
			if (redirect?.startsWith('/')) return redirect;
			return `/${orgID}/dashboard${params.size ? `?${params}` : ''}`;
		}
		if (page.url.pathname.match(/^\/account\/([^\/]+)\/payment/)) {
			return `/account/${orgID}/subscription${params.size ? `?${params}` : ''}`;
		}
		if (page.url.pathname.match(/^\/account\/([^\/]+)\/subscription/)) {
			return `/account${params.size ? `?${params}` : ''}`;
		}
		if (!authState.orgs.length) return `/signout`;
		if (page.url.pathname.startsWith('/account/reset-password')) {
			if (redirect) return redirect;
			if (orgID) {
				return `/${orgID}/dashboard${params.size ? `?${params}` : ''}`;
			}
			return `/dashboard${params.size ? `?${params}` : ''}`;
		}
		if (page.url.pathname.match(/^\/account([^\/].*)?$/)) {
			params.delete('new');
			if (orgID) {
				return `/${orgID}/dashboard${params.size ? `?${params}` : ''}`;
			}
			return `/signout`;
		}
		if (authState.orgs.length > 1) {
			return `/account${params.size ? `?${params}` : ''}`;
		}
		return `/signout`;
	});
</script>

<div class="page">
	<article>
		{#if backUrl}
			<header data-sveltekit-reload>
				<Button transparent dense href={backUrl}>
					<BackArrowIcon />
					{#if backUrl.match(/^\/account\/([^\/]+)\/subscription/)}
						Choose Subscription Plan
					{:else if backUrl.match(/^\/account\/([^\/]+)\/payment/)}
						Manage Payment Methods
					{:else if backUrl.match(/^(\/[^\/]+)?\/dashboard/)}
						Dashboard
					{:else if backUrl.match(/^\/account([^\/].*)?$/)}
						Switch Families
					{:else if backUrl.startsWith('/invitation')}
						Accept Invitation
					{:else if backUrl.startsWith('/signin')}
						Sign In
					{:else}
						Sign Out
					{/if}
				</Button>
			</header>
		{/if}
		{@render children()}
	</article>
</div>

<style>
	.page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: 0 0 4rem;
	}
	article {
		display: flex;
		flex-direction: column;
		max-width: 450px;
		width: 100%;
		padding: 0 1rem;
	}
	header {
		margin-left: -0.5rem;
	}
</style>
