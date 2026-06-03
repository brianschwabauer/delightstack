<script>
	import { Toaster, toast } from '@delightstack/components/feedback';
	import { Button } from '@delightstack/components/actions';

	function handleSave() {
		const promise = new Promise((resolve) =>
			setTimeout(() => resolve({ filename: 'report.pdf' }), 2000),
		);
		toast.promise(promise, {
			loading: 'Saving...',
			success: (result) => `Saved ${result.filename}`,
			error: (err) => `Failed: ${err.message}`,
		});
	}
</script>

<Button onclick={handleSave}>Save File</Button>
<Toaster />
