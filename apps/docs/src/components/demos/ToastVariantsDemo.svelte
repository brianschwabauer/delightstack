<script>
	import { Toaster, toast } from '@delightstack/components/feedback';
	import { Button } from '@delightstack/components/actions';
</script>

<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
	<Button onclick={() => toast('A general notification')}>Default</Button>
	<Button onclick={() => toast.success('File uploaded successfully')}>Success</Button>
	<Button error onclick={() => toast.error('Failed to save changes')}>Error</Button>
	<Button outline onclick={() => toast.warning('You have unsaved changes')}>Warning</Button>
</div>
<Toaster />
