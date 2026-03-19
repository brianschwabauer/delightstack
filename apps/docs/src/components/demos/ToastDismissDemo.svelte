<script>
	import { Toaster, toast } from '@delightstack/components/feedback';
	import { Button } from '@delightstack/components/actions';

	function showAndDismiss() {
		const id = toast('This will be dismissed in 2 seconds');
		setTimeout(() => toast.dismiss(id), 2000);
	}
</script>

<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
	<Button onclick={showAndDismiss}>Show then Dismiss</Button>
	<Button outline onclick={() => toast.dismiss()}>Clear All Toasts</Button>
</div>
<Toaster />
