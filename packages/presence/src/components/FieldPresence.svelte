<script lang="ts" module>
	import type { Snippet } from 'svelte';

	export interface FieldPresenceProps {
		/** Stable id shared across clients (e.g. field name or cell id). */
		anchor: string;
		/** Human-readable label for the field. */
		label?: string;
		/** Draw a colored ring when a peer is focused here. @default true */
		ring?: boolean;
		/** Show a name badge at the top-right. @default true */
		badge?: boolean;
		/** Additional CSS classes for the wrapper. */
		class?: string;
		/** The wrapped field/cell. */
		children: Snippet;
	}
</script>

<script lang="ts">
	import { fieldPresence } from '../client/field-presence.attachment.svelte';

	let {
		anchor,
		label,
		ring = true,
		badge = true,
		class: class_name = '',
		children,
	}: FieldPresenceProps = $props();
</script>

<!--
	Convenience wrapper. For form inputs, prefer the `fieldPresence` attachment
	directly on the input for a pixel-precise ring. This wrapper is handy for
	containers like table cells or list rows.
-->
<div
	class="field-presence {class_name}"
	{@attach fieldPresence(anchor, { label, ring, badge })}>
	{@render children()}
</div>

<style>
	.field-presence {
		border-radius: inherit;
		transition: box-shadow 0.15s ease;
	}
</style>
