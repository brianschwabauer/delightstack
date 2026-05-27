<script lang="ts">
	import { Gallery } from '@delightstack/components';
	import { demoImages } from './_gallery-images';
</script>

<div class="full-width">
	<Gallery items={demoImages} sizing="small" />
</div>

<style>
	.full-width {
		width: 100%;
		display: block;
	}
</style>
