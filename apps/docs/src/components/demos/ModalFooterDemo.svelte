<script>
	import { Modal, Button } from '@delightstack/components/actions';
	import { Input } from '@delightstack/components/form';

	let open = $state(false);
	let name = $state('Ada Lovelace');
	let email = $state('ada@example.com');
	let bio = $state('');
</script>

<Button onclick={() => (open = true)}>Edit Profile</Button>

<Modal bind:open title="Edit Profile" width="440px">
	<div style="display: flex; flex-direction: column; gap: 1rem; padding-top: 0.25rem;">
		<Input label="Full name" bind:value={name} />
		<Input type="email" label="Email" bind:value={email} placeholder="you@example.com" />
		<Input
			type="textarea"
			label="Bio"
			bind:value={bio}
			placeholder="A few words about yourself…"
			rows={3} />
	</div>

	{#snippet footer()}
		<Button transparent onclick={() => (open = false)}>Cancel</Button>
		<Button accent onclick={() => (open = false)}>Save Changes</Button>
	{/snippet}
</Modal>
