<script>
	import { Expand } from '@delightstack/components/display';

	let visible = $state(false);
</script>

<button
	onclick={() => (visible = !visible)}
	style="padding: 0.5rem 1rem; border: 1px solid #ccc; border-radius: 6px; background: transparent; cursor: pointer;">
	{visible ? 'Hide' : 'Show'} Styled Content
</button>

<Expand show={visible} style="border-top: 2px solid #6366f1; margin-top: 0.75rem;">
	<div style="padding: 1rem; background: #f5f3ff; border-radius: 0 0 8px 8px;">
		<p style="margin: 0; color: #4338ca;">
			This expand container has a custom inline style with an accent border and tinted
			background.
		</p>
	</div>
</Expand>
