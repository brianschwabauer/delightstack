<!-- svelte-ignore state_referenced_locally -->
<script lang="ts">
	import { page } from '$app/state';
	import { toast } from '$lib/components';
	import Expand from '$lib/components/Expand.svelte';
	import Button from '$lib/form/Button.svelte';
	import Input from '$lib/form/Input.svelte';
	import Select from '$lib/form/Select.svelte';
	import { ApiError, formatToString, isEqual } from '@packages/lib';
	import {
		CreateOrgInvitation,
		decodePermissions,
		encodePermissions,
		OrgInvitation,
		ROLES,
	} from '@packages/types';

	const { data } = $props();
	const {
		accounts,
		sessions,
		sign_in_methods,
		authState,
		org_users,
		oauth_applications,
		invitations,
	} = $derived(data);

	let active_sessions = $state<typeof sessions>(sessions);
	let active_methods = $state<typeof sign_in_methods>(sign_in_methods);
	let active_accounts = $state<typeof accounts>(accounts);
	let active_invitations = $state<typeof invitations>(invitations);
	let active_org_users = $state<typeof org_users>(org_users);
	let active_oauth_applications = $state<typeof oauth_applications>(oauth_applications);
	let email = $state('');
	let password = $state('');
	let creating_invitation = $state(false);
	let saving_invitation = $state(false);
	let invitation = $state({
		permission: encodePermissions(ROLES.editor),
		max_redemptions: 1,
		expires_at: undefined,
		email: '',
	} satisfies CreateOrgInvitation);
	let roles = $state(Object.keys(ROLES) as Array<keyof typeof ROLES>);

	async function deleteSession(session_id: string) {
		const response = await fetch(`/account/session/${session_id}`, {
			method: 'DELETE',
		});
		if (response.ok) {
			active_sessions = active_sessions.filter((session) => session.id !== session_id);
		} else {
			const data = await response.json().catch(() => undefined);
			const errorMessage = ApiError.from(data).toString();
			toast.error(errorMessage);
			throw { message: errorMessage };
		}
	}

	async function deleteSignInMethod(signin_method_id: string) {
		const response = await fetch(`/account/signin-method/${signin_method_id}`, {
			method: 'DELETE',
		});
		if (response.ok) {
			active_methods = active_methods.filter((v) => v.id !== signin_method_id);
		} else {
			const data = await response.json().catch(() => undefined);
			const errorMessage = ApiError.from(data).toString();
			toast.error(errorMessage);
			throw { message: errorMessage };
		}
	}

	async function deleteOauthAccount(oauth_token_id: string) {
		const response = await fetch(`/account/oauth-account/${oauth_token_id}`, {
			method: 'DELETE',
		});
		if (response.ok) {
			active_accounts = active_accounts.filter((v) => v.id !== oauth_token_id);
		} else {
			const data = await response.json().catch(() => undefined);
			const errorMessage = ApiError.from(data).toString();
			toast.error(errorMessage);
			throw { message: errorMessage };
		}
	}

	async function addSignInMethod(email: string, password?: string) {
		const requestParams = new URLSearchParams();
		if (authState.orgID) requestParams.set('org', authState.orgID);
		const response = await fetch(`/account/signin-method?${requestParams.toString()}`, {
			method: 'POST',
			body: JSON.stringify({ email, password }),
		});
		if (response.ok) {
			const params = new URLSearchParams(page.url.search);
			params.set(
				'toast',
				`Successfully added email to your account. Please check your email for a ${!password ? 'signin' : 'verification'} link.`,
			);
			window.location.href = `${page.url.pathname}?${params.toString()}`;
			email = '';
			password = '';
		} else {
			const data = await response.json().catch(() => undefined);
			const errorMessage = ApiError.from(data).toString();
			toast.error(errorMessage);
			throw { message: errorMessage };
		}
	}

	async function deleteOrg(org_id: string) {
		const response = await fetch(`/api/org/${org_id}`, {
			method: 'DELETE',
		});
		if (response.ok) {
			window.location.href = '/account';
		} else {
			const data = await response.json().catch(() => undefined);
			const errorMessage = ApiError.from(data).toString();
			toast.error(errorMessage);
			throw { message: errorMessage };
		}
	}

	async function deleteAccount() {
		const response = await fetch(`/account`, {
			method: 'DELETE',
		});
		if (response.ok) {
			window.location.href = '/';
		} else {
			const data = await response.json().catch(() => undefined);
			const errorMessage = ApiError.from(data).toString();
			toast.error(errorMessage);
			throw { message: errorMessage };
		}
	}

	async function createInvitation() {
		if (saving_invitation) return;
		const requestParams = new URLSearchParams();
		if (authState.orgID) requestParams.set('org', authState.orgID);
		saving_invitation = true;
		const response = await fetch(`/api/invitation?${requestParams.toString()}`, {
			method: 'POST',
			body: JSON.stringify(invitation),
		});
		if (response.ok) {
			const body = await response.json<OrgInvitation>();
			active_invitations = [...active_invitations, body];
			saving_invitation = false;
			invitation = {
				permission: 0,
				max_redemptions: 1,
				expires_at: undefined,
				email: '',
			};
			creating_invitation = false;
		} else {
			saving_invitation = false;
			const data = await response.json().catch(() => undefined);
			const errorMessage = ApiError.from(data).toString();
			toast.error(errorMessage);
			throw { message: errorMessage };
		}
	}

	async function deleteInvitation(invitation_id: string) {
		const response = await fetch(`/api/invitation/${invitation_id}`, {
			method: 'DELETE',
		});
		if (response.ok) {
			active_invitations = active_invitations.filter((v) => v.id !== invitation_id);
		} else {
			const data = await response.json().catch(() => undefined);
			const errorMessage = ApiError.from(data).toString();
			toast.error(errorMessage);
			throw { message: errorMessage };
		}
	}

	async function revokeOauthApplication(application_id: string) {
		const response = await fetch(`/api/oauth/application/${application_id}/revoke`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Org: authState.orgID || '' },
		});
		if (response.ok) {
			active_oauth_applications = active_oauth_applications.filter(
				(v) => v.id !== application_id,
			);
		} else {
			const data = await response.json().catch(() => undefined);
			const errorMessage = ApiError.from(data).toString();
			toast.error(errorMessage);
			throw { message: errorMessage };
		}
	}

	function getRoleFromPermissions(permissions: Permissions[]) {
		return Object.entries(ROLES).find(([_, v]) => isEqual(v, permissions))?.[0] as
			| keyof typeof ROLES
			| undefined;
	}
</script>

<article>
	<h1>Account Page</h1>
	<span data-sveltekit-reload style="width: 100%">
		<Button transparent fullWidth href="/signout">Sign Out</Button>
	</span>

	<h2 style="margin: 2rem 0 0;">Families</h2>
	<div class="families">
		{#each authState.orgs as org}
			<div class="family" data-sveltekit-reload style="margin: 2rem 0">
				<h3>{org.name}</h3>
				<Button
					transparent
					active={authState.orgID === org.id}
					href={authState.orgID === org.id ? '' : `/${org.id}/dashboard`}>
					{authState.orgID === org.id ? 'Current Family' : 'Switch to Family'}
				</Button>
				{#if org.permissions.includes('billing:write')}
					<Button
						transparent
						href="/account/{org.id}/subscription?redirect={encodeURIComponent(
							`/${org.id}/dashboard/settings/account`,
						)}">
						Manage Subscription
					</Button>
					<Button
						transparent
						href="/account/{org.id}/payment?redirect={encodeURIComponent(
							`/${org.id}/dashboard/settings/account`,
						)}">
						Manage Payment
					</Button>
					<Button transparent>
						Change Family Name
						{#snippet menu()}
							<div
								style="padding: 2rem; display: flex; flex-direction: column; gap: 1rem">
								<Input bind:value={org.name}></Input>
								<Button
									fullWidth
									onclick={async () => {
										await fetch(`/api/org/${org.id}`, {
											method: 'PATCH',
											body: JSON.stringify({ name: org.name }),
										});
									}}>
									Save
								</Button>
							</div>
						{/snippet}
					</Button>
					<Button transparent error onclick={() => deleteOrg(org.id)}>
						Delete Family
					</Button>
				{/if}
				<h4>Members</h4>
				{#if org_users}
					{#each active_org_users as user}
						<div class="user" style="display: flex; gap: 1rem; align-items: center">
							<p class="name">
								{user.name}
								{#if user.id === authState.id}
									<span style="color: var(--c-text-active)">(Me)</span>
								{/if}
							</p>
							{#if user.id !== authState.id}
								<Button transparent>
									Update Permisions
									{#snippet menu()}
										<div
											style="padding: 2rem; display: flex; flex-direction: column; gap: 1rem">
											<Select
												label="User Role"
												options={roles}
												value={getRoleFromPermissions(
													decodePermissions(user.permission) as any,
												)}
												onchange={(val) => {
													user.permission = encodePermissions(ROLES[val]);
												}}></Select>
											<Button
												fullWidth
												onclick={async () => {
													await fetch(
														`/api/user/${user.id}/permission/${user.permission}?org=${org.id}`,
														{ method: 'PUT' },
													);
												}}>
												Save
											</Button>
											<Button
												transparent
												error
												fullWidth
												onclick={async () => {
													await fetch(`/api/user/${user.id}/permission?org=${org.id}`, {
														method: 'DELETE',
													});
													active_org_users = active_org_users.filter(
														(u) => u.id !== user.id,
													);
												}}>
												Remove from Family
											</Button>
										</div>
									{/snippet}
								</Button>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		{/each}
	</div>

	<h2 style="margin: 2rem 0 0;">Actions</h2>
	<div
		class="actions"
		style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 2rem">
		<Button
			transparent
			href="/account/invoice?redirect={encodeURIComponent(
				`/${authState.orgID}/dashboard/settings/account`,
			)}">
			See Account Invoices
		</Button>
		<Button transparent error onclick={() => deleteAccount()}>Delete account</Button>
	</div>

	<h2>Invitations</h2>
	<section>
		{#each active_invitations as invitation}
			<div class="invitation">
				<p>Invitation ID: {invitation.id}</p>
				<p>Org ID: {invitation.org_id}</p>
				<p>Max Redemptions: {invitation.max_redemptions}</p>
				<p>Permission: {invitation.permission}</p>
				<p>Email: {invitation.email}</p>
				<p>Created at: {new Date(invitation.created_at).toLocaleString()}</p>
				{#if invitation.expires_at}
					<p>Expires at: {new Date(invitation.expires_at).toLocaleString()}</p>
				{/if}
				<Button transparent href="/invitation/{invitation.id}">Invitation Link</Button>
				<Button transparent onclick={() => deleteInvitation(invitation.id)}>
					Delete Invitation
				</Button>
			</div>
		{/each}
		<Button
			transparent
			onclick={() => {
				creating_invitation = !creating_invitation;
			}}>
			Create Invitation
		</Button>
		<Expand show={creating_invitation}>
			<div style="padding: 2rem; display: flex; flex-direction: column; gap: 1rem">
				<Input type="email" multiple={false} label="Email" bind:value={invitation.email}
				></Input>
				<Input
					type="number"
					multiple={false}
					label="Max Redemptions"
					bind:value={invitation.max_redemptions}></Input>
				<Input
					type="date"
					multiple={false}
					label="Expires"
					bind:value={invitation.expires_at}></Input>
				<Select
					label="User Role"
					options={roles}
					value={getRoleFromPermissions(decodePermissions(invitation.permission) as any)}
					onchange={(val) => {
						invitation.permission = encodePermissions(ROLES[val]);
					}}></Select>
				<Button fullWidth disabled={saving_invitation} onclick={createInvitation}>
					Create Invitation
				</Button>
			</div>
		</Expand>
	</section>

	<h2>Sign In Methods</h2>
	{#each active_methods as method}
		<div class="sign-in-method">
			<p>Method: {method.vendor ? method.vendor : 'email'}</p>
			<p>Email: {method.email}</p>
			<p>Last Used: {formatToString(method.refreshed_at, { type: 'date' })}</p>
			<p>Verified: {!!method.verified_at}</p>
			<p>Current: {method.id === authState.user_auth_id}</p>
			{#if method.id !== authState.user_auth_id && active_methods.some((m) => m.id !== method.id && !!m.verified_at)}
				<Button transparent onclick={() => deleteSignInMethod(method.id)}>
					Remove Sign in Method
				</Button>
			{/if}
		</div>
	{/each}
	<div class="sign-in-method">
		<Button transparent href="/signin/google?connect_user_id={authState.id}">
			Add Google Sign In
		</Button>
		<Button transparent>
			Add Email Sign In
			{#snippet menu()}
				<div style="padding: 2rem; display: flex; flex-direction: column; gap: 1rem">
					<Input type="email" multiple={false} label="Email" bind:value={email}></Input>
					<Input type="password" multiple={false} label="Password" bind:value={password}
					></Input>
					<Button
						fullWidth
						disabled={!email}
						onclick={() => addSignInMethod(email, password)}>
						Add Sign In Method
					</Button>
				</div>
			{/snippet}
		</Button>
	</div>

	<h2>OAuth Accounts</h2>
	<section>
		{#each active_accounts as account}
			<div class="account">
				<p>Account ID: {account.id}</p>
				<p>Vendor: {account.vendor}</p>
				<p>Vendor ID: {account.vendor_id}</p>
				<p>Capabilities: {account.capabilities.join(', ')}</p>
				<p>Permissions: {account.permissions.join(', ')}</p>
				{#if !active_methods.some((m) => m.vendor === account.vendor && m.vendor_id === account.vendor_id)}
					<Button transparent onclick={() => deleteOauthAccount(account.id)}>
						Remove Oauth Account
					</Button>
				{/if}
			</div>
		{/each}
		<Button
			transparent
			href="/oauth/google?capabilities=person&redirect={encodeURIComponent(
				page.url.pathname,
			)}">
			Add Oauth Account
		</Button>
	</section>

	<h2>OAuth Applications</h2>
	<section>
		{#each active_oauth_applications as oauth_application}
			<div class="account">
				<p>Application: {oauth_application.name}</p>
				<Button transparent onclick={() => revokeOauthApplication(oauth_application.id)}>
					Remove Oauth Application
				</Button>
			</div>
		{/each}
	</section>

	<h2>Active Sessions</h2>
	<section>
		{#each active_sessions as session}
			<div class="session">
				{#if !session.is_current}
					<Button onclick={() => deleteSession(session.id)}>Revoke Session</Button>
				{/if}
				<p>Session ID: {session.id}</p>
				<p>Created at: {new Date(session.created_at).toLocaleString()}</p>
				<p>Last accessed: {new Date(session.updated_at).toLocaleString()}</p>
				<pre>{JSON.stringify(session, undefined, 2)}</pre>
			</div>
		{/each}
	</section>
</article>

<style>
	article {
		padding: 2rem;
	}
	section {
		margin: 2rem 0;
	}
	.account {
		margin: 2rem 0;
	}
	.session {
		margin: 2rem 0;
	}
	.sign-in-method {
		margin: 2rem 0;
	}
</style>
