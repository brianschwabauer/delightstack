<script lang="ts">
	import { Button, Input, Avatar, AvatarGroup, Table, Modal, Callout } from '@delightstack/components';
	import Badge from '$lib/Badge.svelte';
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
			const response = await fetch('/api/auth/invitation', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: invite_email.trim(), org_id: auth.org_id }),
			});
			if (!response.ok) {
				const data = await response.json();
				invite_error = data.message || 'Failed to send invitation';
				return;
			}
			invite_success = `Invitation sent to ${invite_email}`;
			invite_email = '';
		} catch {
			invite_error = 'Failed to send invitation';
		} finally {
			inviting = false;
		}
	}

	// Check which members are currently online
	function isOnline(user_id: string) {
		return ws.sessions.some((s) => s.meta?.user_id === user_id);
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
		<h3>Invite a Family Member</h3>
		{#if invite_error}
			<Callout type="error">{invite_error}</Callout>
		{/if}
		{#if invite_success}
			<Callout type="success">{invite_success}</Callout>
		{/if}
		<form onsubmit={(e) => { e.preventDefault(); sendInvite(); }} class="invite-form">
			<Input
				type="email"
				bind:value={invite_email}
				placeholder="Email address"
				required
			/>
			<Button type="submit" disabled={inviting || !invite_email.trim()}>
				{inviting ? 'Sending...' : 'Send Invite'}
			</Button>
		</form>
	</section>

	<!-- Online now -->
	{#if ws.connected && ws.sessions.length > 0}
		<section class="online-section">
			<h3>Online Now</h3>
			<div class="online-list">
				<AvatarGroup>
					{#each ws.sessions as session}
						<div class="online-member" {@attach tooltip(session.meta?.user_name ?? 'User')}>
							<Avatar name={session.meta?.user_name ?? 'User'} />
						</div>
					{/each}
				</AvatarGroup>
				<small>{ws.sessions.length} member{ws.sessions.length === 1 ? '' : 's'} online</small>
			</div>
		</section>
	{/if}

	<!-- Connection status -->
	<section class="status-section">
		<div class="status-indicator">
			<span
				class="dot"
				class:connected={ws.connected}
				{@attach tooltip(ws.connected ? 'Connected' : 'Disconnected')}
			></span>
			<small>WebSocket: {ws.status}</small>
		</div>
	</section>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: var(--size-5);
	}
	header {
		p { color: var(--color-text-disabled); }
	}
	.invite-section {
		display: flex;
		flex-direction: column;
		gap: var(--size-3);
		padding: var(--size-4);
		border: 1px solid var(--color-outline);
		border-radius: var(--radius-3);
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
		small { color: var(--color-text-disabled); }
	}
	.online-member {
		display: inline-flex;
	}
	.status-section {
		padding-top: var(--size-3);
		border-top: 1px solid var(--color-outline);
	}
	.status-indicator {
		display: flex;
		align-items: center;
		gap: var(--size-2);
		small { color: var(--color-text-disabled); }
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-round);
		background: var(--color-error);
		&.connected { background: var(--color-success); }
	}
</style>
