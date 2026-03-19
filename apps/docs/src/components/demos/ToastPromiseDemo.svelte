<script>
	import { Toaster, toast } from '@delightstack/components/feedback';
	import { Button } from '@delightstack/components/actions';

	function handleUpload() {
		const promise = new Promise((resolve) => setTimeout(resolve, 2000));
		toast.promise(promise, {
			loading: 'Uploading...',
			success: 'Upload complete!',
			error: 'Upload failed',
		});
	}
</script>

<Button onclick={handleUpload}>Upload</Button>
<Toaster />
