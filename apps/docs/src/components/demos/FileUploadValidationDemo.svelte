<script>
	import { FileUpload } from '@delightstack/components/form';

	let files = $state([]);
</script>

<FileUpload
	bind:files
	accept=".pdf,.doc,.docx"
	maxSize={10 * 1024 * 1024}
	maxFiles={3}
	multiple
	label="Upload documents (PDF, DOC — max 3 files, 10MB each)"
/>
