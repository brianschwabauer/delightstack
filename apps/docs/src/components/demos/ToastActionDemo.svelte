<script>
	import { Toaster, toast } from '@delightstack/components/feedback';
	import { Button } from '@delightstack/components/actions';

	function handleDelete() {
		toast('Item deleted', {
			action: {
				label: 'Undo',
				onclick: () => toast.success('Item restored!'),
			},
		});
	}
</script>

<Button onclick={handleDelete}>Delete Item</Button>
<Toaster />
