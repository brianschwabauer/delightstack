<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * A modal dialog for displaying important information or getting user input.
	 */
	let {
		/** Additional props to pass to the modal parent element */
		...rest
	} = $props();
</script>

<pre>
	Confirmation Modal: Asks user to confirm an action.

Information Modal: Displays important info.

Form Modal: Contains a form for input.

Image Viewer Modal: Displays an image larger.

Video Player Modal: Embedded video.

Full-screen Modal: Takes over the entire screen.


https://www.shadcn-svelte.com/docs/components/alert-dialog
</pre>
