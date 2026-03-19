<script>
	import { Input } from '@delightstack/components/form';

	let tags = $state([]);
</script>

<Input label="Tags" multiple bind:value={tags} placeholder="Add tags..." />
