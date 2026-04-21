<script lang="ts">
	import { Button, Input, AvatarGroup, Callout } from '@delightstack/components';
	import Icon from '$lib/Icon.svelte';
	import { tooltip } from '@delightstack/utilities';

	const { data } = $props();
	const { auth, ws } = $derived(data);

	let invite_email = $state('');
	let inviting = $state(false);
	let invite_error = $state('');
	let invite_success = $state('');

	async function sendInvite() {
		if (!invite_email.trim()) return;
		invite_error = '';
		invite_success = '';
		inviting = true;
		try {
			await auth.invitation.create({ email: invite_email.trim(), permission: 1 });
			invite_success = `Invitation sent to ${invite_email}`;
			invite_email = '';
		} catch (e) {
			invite_error = (e as { message?: string })?.message || 'Failed to send invitation';
		} finally {
			inviting = false;
		}
	}

</script>

<svelte:head>
	<title>Members | Forever Family</title>
</svelte:head>

<div class="page">
	<header>
		<div>
			<h1>Family Members</h1>
			<p>Manage who has access to your family space</p>
		</div>
	</header>

	<!-- Invite section -->
	<section class="invite-section">
		<div class="section-heading">
			<h3>Invite a family member</h3>
			<small>They'll receive an email with a signup link.</small>
		</div>
		{#if invite_error}
			<Callout error>{invite_error}</Callout>
		{/if}
		{#if invite_success}
			<Callout success>{invite_success}</Callout>
		{/if}
		<form onsubmit={(e) => { e.preventDefault(); sendInvite(); }} class="invite-form">
			<Input
				type="email"
				bind:value={invite_email}
				placeholder="name@example.com"
				required
			/>
			<Button onclick={sendInvite} disabled={inviting || !invite_email.trim()}>
				<Icon name="plus" size={16} />
				<span>{inviting ? 'Sending...' : 'Send invite'}</span>
			</Button>
		</form>
	</section>

	<!-- Online now -->
	<section class="online-section">
		<div class="section-heading">
			<h3>Online now</h3>
			<div class="status-indicator">
				<span
					class="dot"
					class:connected={ws.connected}
					{@attach tooltip(ws.connected ? 'Connected' : 'Disconnected')}
				></span>
				<small>{ws.status}</small>
			</div>
		</div>
		{#if ws.connected && ws.sessions.length > 0}
			<div class="online-list">
				<AvatarGroup
					avatars={ws.sessions.map((s) => ({ name: s.meta?.user_name ?? 'User' }))}
				/>
				<small>{ws.sessions.length} member{ws.sessions.length === 1 ? '' : 's'} online</small>
			</div>
		{:else}
			<p class="empty-inline">No one else is online right now.</p>
		{/if}
	</section>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: var(--size-5);
	}
	header {
		h1 {
			font-family: var(--font-serif);
			font-size: var(--font-size-4);
			letter-spacing: -0.01em;
		}
		p { color: var(--color-text-disabled); }
	}
	.section-heading {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--size-2);
		flex-wrap: wrap;
		h3 { font-size: var(--font-size-1); }
		small { color: var(--color-text-disabled); }
	}
	.invite-section {
		display: flex;
		flex-direction: column;
		gap: var(--size-3);
		padding: var(--size-4);
		border: 1px solid var(--color-outline);
		border-radius: var(--radius-3);
		background: var(--color-bg-1);
	}
	.invite-form {
		display: flex;
		gap: var(--size-2);
		align-items: flex-end;
		max-width: 500px;
	}
	.online-section {
		display: flex;
		flex-direction: column;
		gap: var(--size-3);
	}
	.online-list {
		display: flex;
		align-items: center;
		gap: var(--size-3);
		padding: var(--size-3);
		border: 1px solid var(--color-outline);
		border-radius: var(--radius-3);
		small { color: var(--color-text-disabled); }
	}
	.empty-inline {
		padding: var(--size-3);
		color: var(--color-text-disabled);
		font-size: var(--font-size-0);
		border: 1px dashed var(--color-outline);
		border-radius: var(--radius-3);
	}
	.status-indicator {
		display: flex;
		align-items: center;
		gap: var(--size-1);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-round);
		background: var(--color-error);
		&.connected { background: var(--color-success); }
	}
</style>
