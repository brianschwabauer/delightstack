<script lang="ts">
	import { type Snippet } from 'svelte';
	import Expand from '../display/Expand.svelte';
	import Button from '../actions/Button.svelte';

	const propId = $props.id();
	let {
		/** Label text for the fieldset (rendered in the legend slot) */
		label = undefined as string | undefined,

		/** Description text shown below the label */
		description = undefined as string | undefined,

		/** Show a subtle border around the fieldset */
		bordered = false,

		/** Whether the fieldset and all child inputs are disabled */
		disabled = false,

		/** Error message displayed below the fieldset */
		error = undefined as string | undefined,

		/** Whether the fieldset is required (shows asterisk after label) */
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

	const description_id = $derived(`${id}-desc`);
	const error_id = $derived(`${id}-error`);

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

	function expandIfCollapsed() {
		if (collapsible && collapsed) collapsed = false;
	}
</script>

<fieldset
	{id}
	{disabled}
	class={['fieldset', class_name].filter(Boolean).join(' ')}
	class:bordered
	class:dense
	class:comfortable
	class:has-error={!!error}
	class:skeleton
	class:disabled
	class:collapsed={collapsible && collapsed}
	aria-describedby={description ? description_id : error ? error_id : undefined}>
	{#if label}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<legend
			class:collapsible
			role={collapsible ? 'button' : undefined}
			tabindex={collapsible ? 0 : undefined}
			aria-expanded={collapsible ? !collapsed : undefined}
			onclick={collapsible ? toggleCollapsed : undefined}
			onkeydown={collapsible ? onKeyDown : undefined}>
			<span class="legend-text">
				{label}
				{#if required}
					<span class="required-mark" aria-hidden="true">*</span>
				{/if}
			</span>
			{#if collapsible}
				<svg
					class="collapse-icon"
					class:rotated={!collapsed}
					width="18"
					height="18"
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
		<div class="expand-container">
			{#if collapsed}
				<!-- The collapsed body is a single full-width transparent Button, so a
			     click anywhere in the fieldset body expands it. -->
				<Button
					transparent
					full_width
					class="expand-button"
					onclick={expandIfCollapsed}
					aria-label="Expand">
					<span class="expand-label">Show more</span>
					<svg
						class="expand-chevron"
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
				</Button>
			{/if}
			<Expand show={!collapsed}>
				<div class="content" class:grid style:--columns={grid ? columns : undefined}>
					{#if children}
						{@render children()}
					{/if}
				</div>
			</Expand>
		</div>
	{:else}
		<div class="content" class:grid style:--columns={grid ? columns : undefined}>
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
		padding: 0.5em 1em 1em 1em;
		min-inline-size: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75em;
		border-radius: var(--radius-lg, 8px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-lg, 8px) * var(--squircle-ratio, 2));
		}
		position: relative;

		&.dense {
			padding: 0.25em 0.5em 0.5em 0.5em;
			gap: 0.5em;
		}
		&.comfortable {
			padding: 1em 1.5em 1.5em 1.5em;
			gap: 1em;
		}

		/* Bordered style */
		&.bordered {
			border: 1px solid var(--color-border, hsl(0 0% 80%));
		}

		/* Error state */
		&.has-error {
			border-color: var(--color-error, hsl(0 70% 55%));

			.legend-text {
				color: var(--color-error, hsl(0 70% 55%));
			}
		}

		/* Disabled */
		&.disabled {
			opacity: 0.6;
		}

		/* Skeleton — the legend keeps its real layout but its text turns
		   transparent, and a text-height pill is painted over the label's own box.
		   Anchoring to the real legend text means the bar is always exactly where
		   (and as wide as) the label, at every density — no offset guesswork. The
		   child fields render their own skeleton states, so the real form shape
		   shows through with no layout shift when it resolves. */
		&.skeleton {
			pointer-events: none;

			legend {
				color: transparent;
			}
			.description {
				visibility: hidden;
			}
			/* The pill is a pseudo-element (it can't host its own ::after), so the
			   sweep is emulated with background-position using the same geometry and
			   timing as the global delight-skeleton-shimmer. */
			.legend-text {
				position: relative;

				&::before {
					content: '';
					position: absolute;
					top: 50%;
					left: 0;
					right: 0;
					height: 0.7em;
					transform: translateY(-50%);
					border-radius: var(--radius-full, 1e5px);
					background-color: var(
						--skeleton-bg,
						rgb(from var(--color-text, #888) r g b / 0.1)
					);
					background-image: linear-gradient(
						105deg,
						transparent 37.5%,
						var(--skeleton-sheen, rgb(from var(--color-text, #888) r g b / 0.12)) 50%,
						transparent 62.5%
					);
					background-size: 200% 100%;
					background-repeat: no-repeat;
					background-position: 150% 0;
					animation: fieldset-skeleton-sweep var(--skeleton-duration, 2.4s) ease-in-out
						infinite;
				}
			}
		}
	}
	/* background-position twin of delight-skeleton-shimmer: a 200%-wide image
	   whose centered band spans half the box, travelling the same
	   -100% → +100% distance with the same rest beat. */
	@keyframes fieldset-skeleton-sweep {
		0% {
			background-position: 150% 0;
		}
		55%,
		100% {
			background-position: -50% 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.fieldset.skeleton .legend-text::before {
			animation: none;
		}
	}

	/* Legend — native <legend> breaks the bordered outline at its position,
	 * so a few extra pixels of horizontal padding gives the border breathing
	 * room around the text. */
	legend {
		display: flex;
		align-items: center;
		gap: 0.5em;
		font-weight: 600;
		font-size: 1em;
		color: var(--color-text, inherit);
		padding: 0 0.4em;
		line-height: 1.4;
		/* A flex fieldset drops the legend below the top border (it no longer
		   notches the outline), so it sits entirely inside the content box. The
		   first row's child inputs float their own labels up above their top
		   edge — without this gap a floated child label collides with the
		   legend's descenders. Reserve room for that rise. */
		margin-bottom: 0.45em;
		border: none;
		background: none;
		transition: color 200ms ease;

		&.collapsible {
			cursor: pointer;
			user-select: none;
			-webkit-tap-highlight-color: transparent;
			border-radius: var(--radius-md, 4px);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--radius-md, 4px) * var(--squircle-ratio, 2));
			}

			&:hover {
				color: var(--color-action, hsl(220 70% 55%));
				/* Snap the color in on hover; the base rule eases it back out on leave. */
				transition: none;
			}
			&:focus-visible {
				outline: 2px solid var(--color-border-active, currentColor);
				outline-offset: 2px;
			}
		}
	}

	.legend-text {
		display: inline;
		transition: color 200ms ease;
	}

	.required-mark {
		color: var(--color-error, hsl(0 70% 55%));
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
		color: var(--color-text-muted, hsl(0 0% 45%));
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

	/* Expand button — fills the collapsed body so a click anywhere on it (the
	   whole fieldset body) expands the section. */
	.fieldset :global(.button.expand-button) {
		width: 100%;
		--color-text: var(--color-text-muted, hsl(0 0% 45%));
	}
	.fieldset :global(.button.expand-button button) {
		justify-content: space-between;
		min-height: 3em;
		gap: 0.4em;
		font-size: 0.9em;
	}
	.fieldset.dense :global(.button.expand-button button) {
		min-height: 2.25em;
	}
	.fieldset.comfortable :global(.button.expand-button button) {
		min-height: 3.5em;
	}
	.fieldset :global(.button.expand-button:hover) {
		--color-text: var(--color-action, hsl(220 70% 55%));
	}
	.expand-chevron {
		flex-shrink: 0;
	}

	/* Error message */
	.error-message {
		margin: 0;
		font-size: 0.8em;
		color: var(--color-error, hsl(0 70% 55%));
		line-height: 1.4;
	}
</style>
