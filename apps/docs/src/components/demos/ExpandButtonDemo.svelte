<script>
	import { Expand } from '@delightstack/components/display';
	import { Button } from '@delightstack/components/actions';

	let visible = $state(false);
</script>

<Button onclick={() => (visible = !visible)}>
	{visible ? 'Collapse' : 'Expand'}
</Button>

<Expand bind:show={visible}>
	<div style="padding: 1rem 0;">
		<p style="margin: 0;">This content slides in and out smoothly.</p>
	</div>
</Expand>
