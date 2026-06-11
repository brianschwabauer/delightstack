<script lang="ts">
	import { Button } from '@delightstack/components';
	import PDF from '@delightstack/components/pdf';

	const PDF_URL =
		'https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf';
	let src = $state<string | undefined>(undefined);
</script>

<!-- The skeleton is the built-in loading state: it shows while `src` is
     missing or the document is still loading, then dismisses itself. -->
<div style="display: flex; flex-direction: column; gap: 0.75rem; width: 100%;">
	<div style="height: 500px; border-radius: 0.5rem; overflow: hidden;">
		<PDF {src} height="100%" show_toolbar={false} />
	</div>
	<Button outline dense size="0" onclick={() => (src = src ? undefined : PDF_URL)}>
		{src ? 'Unload (back to skeleton)' : 'Load PDF'}
	</Button>
</div>
