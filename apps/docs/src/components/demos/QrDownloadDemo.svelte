<script>
	import { QR } from '@delightstack/components/display';
	import { Button } from '@delightstack/components/actions';

	let qr_ref = $state(undefined);
</script>

<div style="display: inline-flex; flex-direction: column; align-items: center; gap: 0.75rem;">
	<QR bind:this={qr_ref} value="https://example.com" download_filename="my-share-code" />
	<Button outline onclick={() => qr_ref?.triggerDownload()}>Download PNG</Button>
</div>
