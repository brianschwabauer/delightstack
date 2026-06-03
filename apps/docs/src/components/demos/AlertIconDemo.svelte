<script>
	import { Alert, Button } from '@delightstack/components/actions';
	import WarningIcon from './AlertWarningIcon.svelte';

	let showWarning = $state(false);
</script>

<Button onclick={() => (showWarning = true)}>Show Warning</Button>

<Alert
	bind:open={showWarning}
	title="Warning"
	message="This will overwrite existing data."
	icon={WarningIcon}
	destructive />
