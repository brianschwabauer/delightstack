<script>
	import { Toaster, toast } from '@delightstack/components/feedback';
	import { Button } from '@delightstack/components/actions';
</script>

<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
	<Button onclick={() => toast('Quick notice', { duration: 2000 })}>2s Toast</Button>
	<Button onclick={() => toast('Longer notice', { duration: 8000 })}>8s Toast</Button>
</div>
<Toaster />
