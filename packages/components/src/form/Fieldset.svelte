<script lang="ts">
	import { type Snippet } from 'svelte';
	import Expand from '../display/Expand.svelte';

	const propId = $props.id();
	let {
		/** Legend text for the fieldset */
		legend = undefined as string | undefined,

		/** Description text shown below the legend */
		description = undefined as string | undefined,

		/** Show a subtle border around the fieldset */
		bordered = false,

		/** Elevated card style */
		card = false,

		/** Filled background style */
		filled = false,

		/** Whether the fieldset and all child inputs are disabled */
		disabled = false,

		/** Error message displayed below the fieldset */
		error = undefined as string | undefined,

		/** Whether the fieldset is required (shows asterisk after legend) */
		required = false,

		/** Whether the fieldset can be collapsed */
		collapsible = false,

		/** Whether the fieldset is currently collapsed (only when collapsible) */
		collapsed = $bindable(false),

		/** Lay out children in a CSS grid */
		grid = false,

		/** Number of grid columns when grid is true */
		columns = 2,

		/** Whether to show a skeleton loading state */
		skeleton = false,

		/** Whether the fieldset uses dense spacing */
		dense = false,

		/** Whether the fieldset uses comfortable spacing */
		comfortable = false,

		/** The id of the fieldset element */
		id = propId,

		/** Custom class name */
		class: class_name = '',

		/** Child elements rendered inside the fieldset */
		children = undefined as Snippet | undefined,
	} = $props();

	const description_id = `${id}-desc`;
	const error_id = `${id}-error`;

	function toggleCollapsed() {
		if (!collapsible) return;
		collapsed = !collapsed;
	}

	function onKeyDown(e: KeyboardEvent) {
		if (!collapsible) return;
		if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault();
			toggleCollapsed();
		}
	}
</script>

<fieldset
	{id}
	{disabled}
	class={['fieldset', class_name].filter(Boolean).join(' ')}
	class:bordered
	class:card
	class:filled
	class:dense
	class:comfortable
	class:has-error={!!error}
	class:skeleton
	class:disabled
	aria-describedby={description ? description_id : error ? error_id : undefined}>
	{#if legend}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<legend
			class="legend"
			class:collapsible
			role={collapsible ? 'button' : undefined}
			tabindex={collapsible ? 0 : undefined}
			aria-expanded={collapsible ? !collapsed : undefined}
			onclick={collapsible ? toggleCollapsed : undefined}
			onkeydown={collapsible ? onKeyDown : undefined}>
			<span class="legend-text">
				{legend}
				{#if required}
					<span class="required-mark" aria-hidden="true">*</span>
				{/if}
			</span>
			{#if collapsible}
				<svg
					class="collapse-icon"
					class:rotated={!collapsed}
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true">
					<polyline points="6 9 12 15 18 9"></polyline>
				</svg>
			{/if}
		</legend>
	{/if}

	{#if description}
		<p class="description" id={description_id}>{description}</p>
	{/if}

	{#if collapsible}
		<Expand show={!collapsed}>
			<div
				class="content"
				class:grid
				style:--columns={grid ? columns : undefined}>
				{#if children}
					{@render children()}
				{/if}
			</div>
		</Expand>
	{:else}
		<div
			class="content"
			class:grid
			style:--columns={grid ? columns : undefined}>
			{#if children}
				{@render children()}
			{/if}
		</div>
	{/if}

	{#if error}
		<p class="error-message" id={error_id} role="alert">{error}</p>
	{/if}
</fieldset>

<style>
	.fieldset {
		border: none;
		margin: 0;
		padding: 1em;
		min-inline-size: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75em;
		border-radius: var(--radius-3, 8px);
		position: relative;
	}

	.fieldset.dense {
		padding: 0.5em;
		gap: 0.5em;
	}
	.fieldset.comfortable {
		padding: 1.5em;
		gap: 1em;
	}

	/* Bordered style */
	.fieldset.bordered {
		border: 1px solid var(--c-outline, hsl(0 0% 80%));
	}

	/* Card style */
	.fieldset.card {
		background: var(--c-bg-card, var(--c-bg, white));
		box-shadow: var(--shadow-2, 0 1px 3px rgb(0 0 0 / 0.1));
		border: 1px solid var(--c-outline, hsl(0 0% 90%));
	}

	/* Filled style */
	.fieldset.filled {
		background: var(--c-bg-2, hsl(0 0% 96%));
	}

	/* Error state */
	.fieldset.has-error {
		border-color: var(--c-error, hsl(0 70% 55%));
	}

	/* Disabled */
	.fieldset.disabled {
		opacity: 0.6;
	}

	/* Skeleton */
	.fieldset.skeleton {
		pointer-events: none;
	}
	.fieldset.skeleton .legend-text,
	.fieldset.skeleton .description,
	.fieldset.skeleton .content {
		background: var(--c-bg-4, hsl(0 0% 90%));
		color: transparent;
		border-radius: var(--radius-2, 4px);
		animation: skeleton-pulse 1.5s ease-in-out infinite;
	}
	@keyframes skeleton-pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
	}

	/* Legend */
	.legend {
		display: flex;
		align-items: center;
		gap: 0.5em;
		font-weight: 600;
		font-size: 1em;
		color: var(--c-text, inherit);
		padding: 0;
		line-height: 1.4;
		border: none;
		background: none;
	}

	.legend.collapsible {
		cursor: pointer;
		user-select: none;
		-webkit-tap-highlight-color: transparent;
		border-radius: var(--radius-2, 4px);
	}
	.legend.collapsible:hover {
		color: var(--c-action, hsl(220 70% 55%));
	}
	.legend.collapsible:focus-visible {
		outline: 2px solid var(--c-outline-active, currentColor);
		outline-offset: 2px;
	}

	.legend-text {
		display: inline;
	}

	.required-mark {
		color: var(--c-error, hsl(0 70% 55%));
		margin-left: 0.125em;
		font-weight: 700;
	}

	.collapse-icon {
		flex-shrink: 0;
		transition: transform 250ms ease;
		transform: rotate(-90deg);
	}
	.collapse-icon.rotated {
		transform: rotate(0deg);
	}

	/* Description */
	.description {
		margin: 0;
		font-size: 0.875em;
		color: var(--c-text-2, hsl(0 0% 45%));
		line-height: 1.5;
	}

	/* Content */
	.content {
		display: flex;
		flex-direction: column;
		gap: 0.75em;
	}
	.dense .content {
		gap: 0.5em;
	}
	.comfortable .content {
		gap: 1em;
	}

	.content.grid {
		display: grid;
		grid-template-columns: repeat(var(--columns, 2), 1fr);
	}

	/* Error message */
	.error-message {
		margin: 0;
		font-size: 0.8em;
		color: var(--c-error, hsl(0 70% 55%));
		line-height: 1.4;
	}
</style>
