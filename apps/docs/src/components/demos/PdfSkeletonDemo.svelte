<script lang="ts">
	import { Button } from '@delightstack/components';
	import PDF from '@delightstack/components/pdf';

	let loading = $state(true);
</script>

<div style="display: flex; flex-direction: column; gap: 0.75rem;">
	<div style="height: 420px; border-radius: 0.5rem; overflow: hidden;">
		<PDF skeleton={loading} height="100%" src="" showToolbar={false} />
	</div>
	<Button outline dense size="0" onclick={() => (loading = !loading)}>
		Toggle skeleton ({loading ? 'on' : 'off'})
	</Button>
</div>
