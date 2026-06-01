<script lang="ts">
	import { Button } from '@delightstack/components';
	import PDF from '@delightstack/components/pdf';

	let showSkeleton = $state(true);
</script>

<div style="display: flex; flex-direction: column; gap: 0.75rem; width: 100%;">
	<div style="height: 500px; border-radius: 0.5rem; overflow: hidden;">
		<PDF
			skeleton={showSkeleton}
			height="100%"
			src="https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf"
			show_toolbar={false} />
	</div>
	<Button outline dense size="0" onclick={() => (showSkeleton = !showSkeleton)}>
		Toggle skeleton ({showSkeleton ? 'on' : 'off'})
	</Button>
</div>
