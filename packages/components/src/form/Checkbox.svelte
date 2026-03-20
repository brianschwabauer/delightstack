<script lang="ts">
	import { ripple, tooltip } from '@delightstack/utilities';

	const propId = $props.id();
	let {
		/** Whether the checkbox is checked */
		checked = $bindable(false),

		/** Whether the checkbox is in an indeterminate state */
		indeterminate = false,

		/** The value submitted with form data */
		value = '',

		/** Whether the checkbox is disabled */
		disabled = false,

		/** The size of the checkbox. 0=16px, 1=20px, 2=24px, 3=28px */
		size = '1' as '0' | '1' | '2' | '3',

		/** The label text for the checkbox */
		label = '',

		/** A description shown below the label */
		description = '',

		/** An error message shown below the checkbox */
		error = '',

		/** Whether the checkbox is required */
		required = false,

		/** The tooltip message shown on hover */
		tooltip: tooltipMessage = '',

		/** Whether the checkbox should display in a condensed view */
		dense = false,

		/** Whether the checkbox should display in an expanded view */
		comfortable = false,

		/** The ID of the checkbox element */
		id = propId,

		/** The name attribute for the hidden input */
		name = '',

		/** Specifies a custom class name for the container element */
		class: className = '',

		/** Called when the checked state changes */
		onchange = undefined as
			| ((detail: { checked: boolean; value: string }) => void)
			| undefined,
	} = $props();

	const sizes: Record<string, number> = { '0': 16, '1': 20, '2': 24, '3': 28 };
	const px = $derived(sizes[size] ?? 20);

	let animation = $state<'none' | 'check' | 'uncheck'>('none');

	function toggle() {
		if (disabled) return;
		checked = !checked;
		animation = checked ? 'check' : 'uncheck';
		setTimeout(() => (animation = 'none'), checked ? 350 : 50);
		onchange?.({ checked, value });
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === ' ') {
			e.preventDefault();
			toggle();
		}
	}
</script>

<div
	class={['ds-checkbox', className].filter(Boolean).join(' ')}
	class:dense
	class:comfortable
	class:disabled
	class:has-error={!!error}
	{@attach tooltip(tooltipMessage)}
	style:--size="{px}px">
	<!-- Hidden native input for form submission -->
	<input
		type="checkbox"
		class="native-input"
		{id}
		{name}
		{value}
		{required}
		{disabled}
		{checked}
		{indeterminate}
		tabindex={-1}
		aria-hidden="true" />

	<div
		class="indicator-wrapper"
		class:checked
		class:indeterminate
		role="checkbox"
		tabindex={disabled ? -1 : 0}
		aria-checked={indeterminate ? 'mixed' : checked}
		aria-disabled={disabled}
		aria-labelledby={label ? `${id}-label` : undefined}
		{@attach ripple({ enabled: !disabled, centered: true, opacity: 0.15 })}
		onclick={toggle}
		onkeydown={onKeyDown}>
		<svg
			class="indicator"
			class:checked
			class:indeterminate
			class:animating-check={animation === 'check'}
			class:animating-uncheck={animation === 'uncheck'}
			viewBox="0 0 24 24"
			width={px}
			height={px}
			fill="none">
			<rect class="box" x="2" y="2" width="20" height="20" rx="3" stroke-width="2" />
			{#if indeterminate}
				<line
					class="dash"
					x1="7"
					y1="12"
					x2="17"
					y2="12"
					stroke-width="2.5"
					stroke-linecap="round" />
			{:else}
				<path
					class="check"
					d="M6 12.5 L10 16.5 L18 8"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round" />
			{/if}
		</svg>
	</div>

	{#if label || description}
		<div class="content">
			{#if label}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<label id="{id}-label" for={id} class="label" onclick={toggle}>{label}</label>
			{/if}
			{#if description}
				<span class="description">{description}</span>
			{/if}
		</div>
	{/if}

	{#if error}
		<span class="error-text">{error}</span>
	{/if}
</div>

<style>
	.ds-checkbox {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 0.5em;
		cursor: default;
		position: relative;

		&.dense {
			gap: 0.25em;
		}
		&.comfortable {
			gap: 0.75em;
		}
		&.disabled {
			opacity: 0.5;
			pointer-events: none;
		}
		&.has-error {
			.indicator .box {
				stroke: var(--color-error, #d32f2f);
			}
			.error-text {
				display: block;
			}
		}

		/* Hover: circular background tint on indicator (triggers from label hover too) */
		&:not(.disabled):hover > .indicator-wrapper {
			background: var(--hover-tint);
			transition: none;
		}

		/* Active: press scale on indicator (triggers from label click too) */
		&:not(.disabled):active > .indicator-wrapper {
			transform: scale(0.9);
			transition:
				transform 80ms ease,
				background 200ms ease;
		}
	}

	.native-input {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
		padding: 0;
		margin: -1px;
	}

	.indicator-wrapper {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: calc(var(--size) + 20px);
		height: calc(var(--size) + 20px);
		border-radius: 50%;
		cursor: pointer;
		flex-shrink: 0;
		overflow: hidden;
		outline: none;
		-webkit-tap-highlight-color: transparent;
		--hover-tint: color-mix(in srgb, var(--color-text, currentColor) 12%, transparent);
		transition:
			background 200ms ease,
			transform 150ms ease;

		/* Accent-tinted hover when checked or indeterminate */
		&.checked,
		&.indeterminate {
			--hover-tint: color-mix(in srgb, var(--color-accent, #1976d2) 16%, transparent);
		}

		&:focus-visible {
			box-shadow: 0 0 0 2px var(--color-text, currentColor);
			border-radius: 50%;
		}
	}

	.indicator {
		flex-shrink: 0;

		.box {
			stroke: var(--color-text-disabled, #999);
			fill: transparent;
			transition:
				stroke 150ms ease,
				fill 150ms ease;
		}

		.check {
			stroke: transparent;
			fill: none;
			stroke-dasharray: 28;
			stroke-dashoffset: 28;
			transition:
				stroke-dashoffset 250ms ease,
				stroke 150ms ease;
		}

		.dash {
			stroke: transparent;
			transition: stroke 150ms ease;
		}

		&.checked {
			.box {
				stroke: var(--color-accent, #1976d2);
				fill: var(--color-accent, #1976d2);
			}
			.check {
				stroke: var(--color-accent-text, #fff);
				stroke-dashoffset: 0;
			}
		}

		&.indeterminate {
			.box {
				stroke: var(--color-accent, #1976d2);
				fill: var(--color-accent, #1976d2);
			}
			.dash {
				stroke: var(--color-accent-text, #fff);
			}
		}

		/* Check-in: elastic checkmark draw with overshoot + scale pulse */
		&.animating-check {
			animation: box-pulse 350ms cubic-bezier(0.34, 1.56, 0.64, 1);

			.check {
				stroke-dashoffset: 0;
				transition: stroke-dashoffset 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
			}
		}

		/* Uncheck: visible stroke retraction, box holds fill then fades */
		&.animating-uncheck {
			.check {
				stroke: var(--color-accent-text, #fff);
				stroke-dashoffset: 28;
				transition: stroke-dashoffset 50ms cubic-bezier(0.4, 0, 0.2, 1);
			}
			.box {
				stroke: var(--color-accent, #1976d2);
				fill: var(--color-accent, #1976d2);
			}
		}
	}

	@keyframes box-pulse {
		0% {
			transform: scale(1);
		}
		40% {
			transform: scale(1.1);
		}
		100% {
			transform: scale(1);
		}
	}

	.content {
		display: flex;
		flex-direction: column;
		gap: 0.1em;
		padding-top: calc((var(--size) + 20px) / 2 - 0.7em);
		margin-left: -8px;
	}

	.label {
		cursor: pointer;
		user-select: none;
		line-height: 1.4;
		color: var(--color-text, inherit);
	}

	.description {
		font-size: 0.85em;
		color: var(--color-text-disabled, #888);
		line-height: 1.3;
	}

	.error-text {
		display: none;
		width: 100%;
		font-size: 0.8em;
		color: var(--color-error, #d32f2f);
		margin-top: -0.25em;
	}
</style>
