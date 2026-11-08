<script lang="ts">
	import { DiffViewer } from '@delightstack/components/display';
	import { ButtonGroup, Button } from '@delightstack/components/actions';

	const before = `The lighthouse had not been lit in eleven years, though the lamp still turned.
Elias set his case down on the stones and looked up at it.
The keeper's cottage was boarded at every window.`;

	const after = `The lighthouse had not been lit in eleven years, and the lamp had not turned in twelve.
Elias set his case down on the wet stones and looked up.
The keeper's cottage was boarded at every window.`;

	let mode = $state<'inline' | 'side-by-side'>('inline');
</script>

<div class="demo">
	<ButtonGroup>
		<Button outline={mode !== 'inline'} onclick={() => (mode = 'inline')}>
			Inline
		</Button>
		<Button
			outline={mode !== 'side-by-side'}
			onclick={() => (mode = 'side-by-side')}>
			Side by side
		</Button>
	</ButtonGroup>

	<DiffViewer {before} {after} {mode} />
</div>

<style>
	.demo {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		inline-size: 100%;
	}
</style>
