<script>
	import { FileUpload } from '@delightstack/components/form';

	let files = $state([]);
</script>

<FileUpload
	bind:files
	accept=".pdf,.doc,.docx"
	max_size={10 * 1024 * 1024}
	max_files={3}
	multiple
	label="Upload documents (PDF, DOC — max 3 files, 10MB each)" />
