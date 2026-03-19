<script>
	import { Button } from '@delightstack/components/actions';

	async function handleSave() {
		await new Promise((resolve) => setTimeout(resolve, 1500));
	}
</script>

<Button onclick={handleSave}>Save</Button>
