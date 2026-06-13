<script>
	import { Expand } from '@delightstack/components/display';
	import { Button } from '@delightstack/components/actions';

	let visible = $state(false);
</script>

<div style="display: flex; flex-direction: column; align-items: flex-start;">
	<Button onclick={() => (visible = !visible)}>
		{visible ? 'Hide' : 'Show'} Styled Content
	</Button>

	<Expand
		show={visible}
		style="border-top: 2px solid #6366f1; margin-top: 0.75rem; align-self: stretch;">
		<div style="padding: 1rem; background: #f5f3ff; border-radius: 0 0 8px 8px;">
			<p style="margin: 0; color: #4338ca;">
				This expand container has a custom inline style with an accent border and tinted
				background.
			</p>
		</div>
	</Expand>
</div>
