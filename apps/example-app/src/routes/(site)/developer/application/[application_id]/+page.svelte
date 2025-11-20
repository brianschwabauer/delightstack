<script lang="ts">
	import Button from '$lib/form/Button.svelte';
	import BackArrowIcon from '~icons/material-symbols/arrow-back';
	import Input from '$lib/form/Input.svelte';
	import CloseIcon from '~icons/ion/md-close';
	import CopyIcon from '~icons/material-symbols/content-copy';
	import { isEqual } from '@packages/lib';
	import { toast } from '$lib/components';

	const { data } = $props();
	const { application: current_application } = $derived(data);
	let application = $state(
		// svelte-ignore state_referenced_locally
		structuredClone(current_application) || {
			id: '',
			name: '',
			url: undefined,
			description: undefined,
			privacy_policy_url: undefined,
			terms_of_service_url: undefined,
			logo: undefined,
			client_secrets: [] as {
				secret?: string;
				id: string;
				created_at: number;
			}[],
			redirect_urls: [] as string[],
			default_redirect_url: undefined,
			verified_at: undefined,
			created_at: Date.now(),
			updated_at: Date.now(),
		},
	);
	const hasChanges = $derived(!isEqual(application, current_application));

	async function save() {
		if (application.id) {
			// Update existing application
			const response = await fetch(`/api/oauth/application/${application.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(application),
			});
			const data = await response.json<typeof application>();
			if (response.ok) {
				application = data;
			} else {
				toast.error(
					`Failed to update application: ${(data as any)?.message || 'Unknown error'}`,
				);
				throw { message: 'Failed to update application' };
			}
		} else {
			// Create new application
			const response = await fetch('/api/oauth/application', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(application),
			});
			const data = await response.json<typeof application>();
			if (response.ok && data.id) {
				window.location.pathname = `/developer/application/${data.id}`;
			} else {
				toast.error(
					`Failed to create application: ${(data as any)?.message || 'Unknown error'}`,
				);
				throw { message: 'Failed to create application' };
			}
		}
	}

	async function deleteApplication() {
		if (!application.id) {
			toast.error('Application must be saved before deleting');
			return;
		}
		const response = await fetch(`/api/oauth/application/${application.id}`, {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
		});
		if (response.ok) {
			window.location.pathname = '/developer/application';
		} else {
			const data = await response.json();
			toast.error(
				`Failed to delete application: ${(data as any).message || 'Unknown error'}`,
			);
			throw { message: 'Failed to delete application' };
		}
	}

	async function createSecret() {
		if (!application.id) {
			toast.error('Application must be saved before creating a secret');
			return;
		}
		const response = await fetch(`/api/oauth/application/${application.id}/secret`, {
			method: 'POST',
		});
		const data = await response.json<{
			secret: string;
			id: string;
			created_at: number;
		}>();
		if (response.ok) {
			application.client_secrets.push(data);
			toast('Client secret created successfully');
		} else {
			toast.error(
				`Failed to create client secret: ${(data as any).message || 'Unknown error'}`,
			);
			throw { message: 'Failed to create client secret' };
		}
	}

	async function deleteSecret(secret_id: string) {
		if (!application.id) {
			toast.error('Application must be saved before deleting a secret');
			return;
		}
		const response = await fetch(
			`/api/oauth/application/${application.id}/secret/${secret_id}`,
			{
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
			},
		);

		if (response.ok) {
			const index = application.client_secrets.findIndex(
				(secret) => secret.id === secret_id,
			);
			if (index > -1) {
				application.client_secrets = application.client_secrets.filter(
					(secret) => secret.id !== secret_id,
				);
			}
			toast('Client secret deleted successfully');
		} else {
			const data = await response.json();
			toast.error(
				`Failed to delete client secret: ${(data as any).message || 'Unknown error'}`,
			);
			throw { message: 'Failed to delete client secret' };
		}
	}
</script>

<div class="page" data-sveltekit-reload>
	<article>
		<header>
			<Button transparent dense href="/developer/application">
				<BackArrowIcon />
				OAuth Applications
			</Button>
		</header>
		<section>
			<h1>{application?.name || 'Unnamed Application'}</h1>
			<div class="pill" class:error={!application?.verified_at}>
				{#if application?.verified_at}
					Verified
				{:else}
					Unverified
				{/if}
			</div>
			<div class="form">
				<Input
					type="text"
					label="Application Name"
					bind:value={application.name}
					required>
				</Input>
				<Input
					type="textarea"
					label="Application Description"
					bind:value={application.description}></Input>
				<Input type="url" label="Logo URL" bind:value={application.logo}></Input>
				<Input type="url" label="Homepage URL" bind:value={application.url}></Input>
				<Input
					type="url"
					label="Privacy Policy URL"
					bind:value={application.privacy_policy_url}></Input>
				<Input
					type="url"
					label="Terms of Service URL"
					bind:value={application.terms_of_service_url}></Input>
				<h2 style="margin: 1.5rem 0 .5rem;">Redirect URLs</h2>
				{#each application.redirect_urls as redirect_url, index}
					<div style="display: flex; gap: 0.5rem; align-items: center; margin: .5rem 0;">
						<Input
							type="url"
							label={`Redirect URL ${index + 1}`}
							bind:value={application.redirect_urls[index]}
							required>
						</Input>
						<Button
							type="button"
							icon
							transparent
							dense
							size="0"
							onclick={() => {
								application.redirect_urls.splice(index, 1);
							}}>
							<CloseIcon />
						</Button>
					</div>
				{/each}
				<Button
					type="button"
					transparent
					fullWidth
					onclick={() => {
						application.redirect_urls.push('');
					}}>
					Add Redirect URL
				</Button>
			</div>
			{#if application.id}
				<h2 style="margin: 1.5rem 0 .5rem;">Client Secrets</h2>
				{#each application.client_secrets as secret}
					<div
						style="display: flex; justify-content: space-between; align-items: center;">
						{#if 'secret' in secret && secret.secret}
							<div
								style="flex: 1; display: flex; flex-direction: column; gap: 0.5rem; background-color: var(--c-bg-active); border-radius: var(--radius-3); padding: 1.5rem;">
								<p>
									Please copy the secret for your own safekeeping. Secrets will no longer
									be available after this moment.
								</p>
								<Input readonly value={secret.secret}>
									{#snippet append()}
										<Button
											transparent
											icon
											size="0"
											onclick={() => {
												navigator.clipboard
													.writeText(secret.secret!)
													.then(() => toast('Secret copied to clipboard!'))
													.catch(() => toast.error(`Couldn't copy secret to clipboard`));
											}}>
											<CopyIcon />
										</Button>
									{/snippet}
								</Input>
							</div>
						{:else}
							<span>Created at {new Date(secret.created_at).toLocaleString()}</span>
							<Button
								type="button"
								tooltip="Revoke Secret"
								icon
								transparent
								dense
								size="00"
								onclick={() => deleteSecret(secret.id)}>
								<CloseIcon />
							</Button>
						{/if}
					</div>
				{/each}
				<Button type="button" transparent fullWidth onclick={createSecret}>
					Create New Secret
				</Button>
			{/if}
			<Button onclick={save} disabled={!hasChanges || !application.name} fullWidth>
				{#if application.id}
					Save Changes
				{:else}
					Create Application
				{/if}
			</Button>
			{#if application.id}
				<Button type="button" transparent error fullWidth onclick={deleteApplication}>
					Delete Application
				</Button>
			{/if}
		</section>
	</article>
</div>

<style>
	.page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: 2rem 0 6rem;
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
	section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.pill {
		display: inline-block;
		padding: 0.25rem 0.5rem;
		border-radius: var(--radius-round);
		background-color: var(--c-success);
		color: var(--c-success-text);
		font-size: 0.875rem;
		font-weight: 500;
		width: fit-content;
		&.error {
			background-color: var(--c-error);
			color: var(--c-error-text);
		}
	}
</style>
