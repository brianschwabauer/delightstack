<script>
	import { ButtonGroup, Button } from '@delightstack/components/actions';

	let viewMode = $state('grid');
</script>

<ButtonGroup size="0" aria-label="View mode">
	<Button
		active={viewMode === 'grid'}
		onclick={() => (viewMode = 'grid')}
		icon
		aria-label="Grid view">
		<svg viewBox="0 0 24 24" fill="currentColor">
			<path d="M3 3h8v8H3V3zm0 10h8v8H3v-8zm10-10h8v8h-8V3zm0 10h8v8h-8v-8z" />
		</svg>
	</Button>
	<Button
		active={viewMode === 'list'}
		onclick={() => (viewMode = 'list')}
		icon
		aria-label="List view">
		<svg viewBox="0 0 24 24" fill="currentColor">
			<path
				d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" />
		</svg>
	</Button>
</ButtonGroup>
