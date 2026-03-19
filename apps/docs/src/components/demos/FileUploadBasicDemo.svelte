<script>
	import { FileUpload } from '@delightstack/components/form';

	let files = $state([]);
</script>

<FileUpload bind:files accept="image/*" label="Upload images" />
