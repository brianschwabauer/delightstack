<script>
	import { Toaster, toast } from '@delightstack/components/feedback';
	import { Button } from '@delightstack/components/actions';
</script>

<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
	<Button onclick={() => toast.success('Changes saved successfully!')}>
		Success Toast
	</Button>
	<Button error onclick={() => toast.error('Something went wrong!')}>Error Toast</Button>
	<Button outline onclick={() => toast.warning('You have unsaved changes')}>
		Warning Toast
	</Button>
	<Button onclick={() => toast('This is an info notification')}>Info Toast</Button>
</div>
<Toaster />
