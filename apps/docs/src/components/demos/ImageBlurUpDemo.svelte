<script>
	import { Image } from '@delightstack/components';
	import { Button } from '@delightstack/components';

	// Cache-bust the src so toggling re-runs the blur-up transition.
	let nonce = $state(0);
	const placeholderUrl = 'https://picsum.photos/id/1015/20/13';
	// Example ThumbHash (base64) — decodes to a tiny blurred gradient.
	const thumb = '1QcSHQRnh493V4dIh4eXh1h4kJUI';
</script>

<div style="display: flex; flex-direction: column; gap: 1rem;">
	<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
		<div>
			<p style="font-size: 0.8rem; margin: 0 0 0.35rem; opacity: 0.7;">placeholder URL</p>
			{#key nonce}
				<Image
					src={`https://picsum.photos/id/1015/640/400?n=${nonce}`}
					alt="Mountain lake"
					placeholder={placeholderUrl}
					aspect_ratio="16/10" />
			{/key}
		</div>
		<div>
			<p style="font-size: 0.8rem; margin: 0 0 0.35rem; opacity: 0.7;">thumbhash</p>
			{#key nonce}
				<Image
					src={`https://picsum.photos/id/1025/640/400?n=${nonce}`}
					alt="Dog"
					thumbhash={thumb}
					aspect_ratio="16/10" />
			{/key}
		</div>
	</div>
	<Button outline dense size="0" onclick={() => nonce++}>Reload images</Button>
</div>
