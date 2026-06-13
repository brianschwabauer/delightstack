<script lang="ts">
	import {
		Button,
		Input,
		Tabs,
		ThemeToggle,
		Modal,
		Callout,
		Accordion,
		AccordionItem,
	} from '@delightstack/components';
	import Badge from '$lib/Badge.svelte';
	import { toast } from '@delightstack/components';

	const { data } = $props();
	const { auth } = $derived(data);

	let active_tab = $state(0);

	// Profile editing
	let edit_name = $state(auth.name ?? '');
	let saving_profile = $state(false);

	// Password change
	let current_password = $state('');
	let new_password = $state('');
	let confirm_password = $state('');
	let changing_password = $state(false);
	let password_error = $state('');

	// Sign out confirmation
	let show_signout = $state(false);

	async function updateProfile() {
		saving_profile = true;
		try {
			await auth.user.update({ name: edit_name.trim() });
			toast('Profile updated');
		} catch {
			// swallow — toast is skipped on failure
		} finally {
			saving_profile = false;
		}
	}

	async function changePassword() {
		if (new_password !== confirm_password) {
			password_error = 'Passwords do not match';
			return;
		}
		password_error = '';
		changing_password = true;
		try {
			await auth.password.change(new_password);
			current_password = '';
			new_password = '';
			confirm_password = '';
			toast('Password changed');
		} catch (e) {
			password_error =
				(e as { message?: string })?.message || 'Failed to change password';
		} finally {
			changing_password = false;
		}
	}

	async function signOut() {
		await auth.signOut();
		window.location.href = '/signin';
	}
</script>

<svelte:head>
	<title>Settings | Forever Family</title>
</svelte:head>

<div class="page">
	<header>
		<h1>Settings</h1>
		<p>Manage your profile, security, and preferences</p>
	</header>

	{#snippet profilePanel()}
		<section class="section">
			<h3>Profile Information</h3>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					updateProfile();
				}}
				class="form">
				<Input label="Name" bind:value={edit_name} required />
				<Input label="Email" value={auth.email ?? ''} disabled />
				<small class="hint">Email cannot be changed here</small>

				<Button onclick={updateProfile} disabled={saving_profile}>
					{saving_profile ? 'Saving...' : 'Save Changes'}
				</Button>
			</form>
		</section>

		<section class="section">
			<h3>Account</h3>
			<p class="desc">
				Signed in as <strong>{auth.email}</strong>
			</p>
			{#if auth.org}
				<p class="desc">
					Family: <strong>{auth.org.name}</strong>
				</p>
			{/if}
			<Button onclick={() => (show_signout = true)} error transparent>Sign Out</Button>
		</section>
	{/snippet}

	{#snippet securityPanel()}
		<section class="section">
			<h3>Change Password</h3>
			{#if password_error}
				<Callout error>{password_error}</Callout>
			{/if}
			<form
				onsubmit={(e) => {
					e.preventDefault();
					changePassword();
				}}
				class="form">
				<Input
					label="Current Password"
					type="password"
					bind:value={current_password}
					required />
				<Input label="New Password" type="password" bind:value={new_password} required />
				<Input
					label="Confirm New Password"
					type="password"
					bind:value={confirm_password}
					required />
				<Button onclick={changePassword} disabled={changing_password}>
					{changing_password ? 'Changing...' : 'Change Password'}
				</Button>
			</form>
		</section>

		<section class="section">
			<Accordion>
				<AccordionItem title="Sign-in Methods">
					<p class="desc">Manage how you sign in to your account.</p>
					<div class="method-list">
						<div class="method">
							<span>Email & Password</span>
							<Badge>Active</Badge>
						</div>
					</div>
				</AccordionItem>
			</Accordion>
		</section>
	{/snippet}

	{#snippet preferencesPanel()}
		<section class="section">
			<h3>Appearance</h3>
			<div class="pref-row">
				<div>
					<strong>Theme</strong>
					<p class="desc">Toggle between light and dark mode</p>
				</div>
				<ThemeToggle />
			</div>
		</section>
	{/snippet}

	<Tabs
		bind:tab={active_tab}
		transition="slide"
		tabs={[
			{ label: 'Profile', content: profilePanel },
			{ label: 'Security', content: securityPanel },
			{ label: 'Preferences', content: preferencesPanel },
		]} />
</div>

<Modal bind:open={show_signout} title="Sign Out">
	<p>Are you sure you want to sign out?</p>
	<div class="modal-actions">
		<Button onclick={() => (show_signout = false)} transparent>Cancel</Button>
		<Button onclick={signOut}>Sign Out</Button>
	</div>
</Modal>

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
		p {
			color: var(--color-text-disabled);
			margin-top: var(--size-1);
		}
	}
	.section {
		display: flex;
		flex-direction: column;
		gap: var(--size-3);
		padding: var(--size-4) 0;
		&:not(:last-child) {
			border-bottom: 1px solid var(--color-outline);
		}
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--size-3);
		max-width: 400px;
	}
	.desc {
		color: var(--color-text-disabled);
		font-size: var(--font-size-0);
	}
	.hint {
		color: var(--color-text-disabled);
		font-size: var(--font-size-00);
		margin-top: var(--size-000);
	}
	.pref-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--size-3);
	}
	.method-list {
		display: flex;
		flex-direction: column;
		gap: var(--size-2);
	}
	.method {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--size-2) var(--size-3);
		border: 1px solid var(--color-outline);
		border-radius: var(--radius-2);
		font-size: var(--font-size-0);
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--size-2);
		margin-top: var(--size-4);
	}
</style>
