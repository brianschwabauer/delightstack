<script>
	import { Toaster, toast } from '@delightstack/components/feedback';
	import { Button } from '@delightstack/components/actions';
</script>

<Button onclick={() => toast.warning('Session expiring soon', { persistent: true })}>
	Show Persistent Warning
</Button>
<Toaster />
