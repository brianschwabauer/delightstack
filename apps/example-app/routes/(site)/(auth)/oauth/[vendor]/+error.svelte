<script lang="ts">
	import { page } from '$app/state';

	const message = $derived(page.error?.message);
</script>

<article>
	<h1>Uh oh, an error occured</h1>
	<p>{message}</p>
</article>
