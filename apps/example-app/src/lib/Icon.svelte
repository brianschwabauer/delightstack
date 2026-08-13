<script lang="ts">
	type IconName =
		| 'home'
		| 'family'
		| 'gallery'
		| 'members'
		| 'billing'
		| 'settings'
		| 'search'
		| 'plus'
		| 'arrow-left'
		| 'edit'
		| 'trash'
		| 'share'
		| 'tag'
		| 'calendar'
		| 'sparkles'
		| 'eye'
		| 'check'
		| 'flask';

	interface Props {
		name: IconName;
		size?: number | string;
		class?: string;
	}

	let { name, size = 20, class: class_name = '' }: Props = $props();
</script>

<svg
	class={class_name}
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false">
	{#if name === 'home'}
		<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
	{:else if name === 'family'}
		<circle cx="8" cy="8" r="3" />
		<circle cx="17" cy="9" r="2.2" />
		<path d="M2 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
		<path d="M14 20c0-2.6 1.5-4.8 3.8-5.7" />
	{:else if name === 'gallery'}
		<rect x="3" y="4" width="18" height="16" rx="2" />
		<circle cx="9" cy="10" r="1.75" />
		<path d="m21 16-4.5-4.5a1.5 1.5 0 0 0-2.2.1L4 22" />
	{:else if name === 'members'}
		<circle cx="10" cy="8" r="3.5" />
		<path d="M3 20c0-3.9 3.1-7 7-7s7 3.1 7 7" />
		<path d="M19 9v6M16 12h6" />
	{:else if name === 'billing'}
		<rect x="2.5" y="5" width="19" height="14" rx="2" />
		<path d="M2.5 10h19" />
		<path d="M6 15h3M13 15h2" />
	{:else if name === 'settings'}
		<circle cx="12" cy="12" r="3" />
		<path
			d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h0a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5h0a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v0a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
	{:else if name === 'search'}
		<circle cx="11" cy="11" r="7" />
		<path d="m20 20-3.5-3.5" />
	{:else if name === 'plus'}
		<path d="M12 5v14M5 12h14" />
	{:else if name === 'arrow-left'}
		<path d="M19 12H5M12 19l-7-7 7-7" />
	{:else if name === 'edit'}
		<path d="M12 20h9" />
		<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
	{:else if name === 'trash'}
		<path d="M3 6h18" />
		<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
		<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
		<path d="M10 11v6M14 11v6" />
	{:else if name === 'share'}
		<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
		<path d="M16 6l-4-4-4 4" />
		<path d="M12 2v13" />
	{:else if name === 'tag'}
		<path
			d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2a2 2 0 0 1-.6-1.4V4a1 1 0 0 1 1-1h8a2 2 0 0 1 1.4.6l7.4 7.4a2 2 0 0 1 0 2.4z" />
		<circle cx="7.5" cy="7.5" r="1.2" />
	{:else if name === 'calendar'}
		<rect x="3" y="5" width="18" height="16" rx="2" />
		<path d="M3 10h18M8 3v4M16 3v4" />
	{:else if name === 'sparkles'}
		<path d="M12 3l1.8 4.5L18 9l-4.2 1.5L12 15l-1.8-4.5L6 9l4.2-1.5z" />
		<path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
	{:else if name === 'eye'}
		<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
		<circle cx="12" cy="12" r="3" />
	{:else if name === 'check'}
		<path d="M5 13l4 4L19 7" />
	{:else if name === 'flask'}
		<path d="M9 3h6" />
		<path d="M10 3v6.5L4.6 18a2 2 0 0 0 1.7 3h11.4a2 2 0 0 0 1.7-3L14 9.5V3" />
		<path d="M7 15h10" />
	{/if}
</svg>
