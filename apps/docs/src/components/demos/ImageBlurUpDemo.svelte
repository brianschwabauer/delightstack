<script>
	import { onMount } from 'svelte';
	import { Image } from '@delightstack/components';
	import { Button } from '@delightstack/components';

	const fullA = 'https://picsum.photos/id/1015/640/400';
	const fullB = 'https://picsum.photos/id/1025/640/400';
	const placeholderUrl = 'https://picsum.photos/id/1015/20/13';
	// Example ThumbHash (base64) — decodes to a tiny blurred gradient.
	const thumb = '1QcSHQRnh493V4dIh4eXh1h4kJUI';

	// `src` starts empty so only the placeholder/thumbhash shows. We assign the
	// real src after a short delay to simulate a slow connection, making the
	// blur-up → full-image transition easy to watch on load and on each reload.
	let srcA = $state('');
	let srcB = $state('');
	let n = 0;
	let timer;

	function reload() {
		n += 1;
		srcA = '';
		srcB = '';
		clearTimeout(timer);
		timer = setTimeout(() => {
			srcA = `${fullA}?n=${n}`;
			srcB = `${fullB}?n=${n}`;
		}, 1000);
	}

	onMount(() => {
		reload();
		return () => clearTimeout(timer);
	});
</script>

<div style="display: flex; flex-direction: column; gap: 1rem; width: 100%;">
	<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
		<div>
			<p style="font-size: 0.8rem; margin: 0 0 0.35rem; opacity: 0.7;">placeholder URL</p>
			<Image
				src={srcA}
				alt="Mountain lake"
				placeholder={placeholderUrl}
				lazy={false}
				aspect_ratio="16/10" />
		</div>
		<div>
			<p style="font-size: 0.8rem; margin: 0 0 0.35rem; opacity: 0.7;">thumbhash</p>
			<Image src={srcB} alt="Dog" thumbhash={thumb} lazy={false} aspect_ratio="16/10" />
		</div>
	</div>
	<Button outline dense size="0" onclick={reload}>Reload images</Button>
</div>
