<script lang="ts" module>
	export { default as RadioGroup } from './Radio.svelte';

	export interface RadioGroupContext {
		name: string;
		value: string;
		disabled: boolean;
		size: '0' | '1' | '2' | '3';
		select: (value: string) => void;
	}
</script>

<script lang="ts">
	import { ripple, tooltip } from '@delightstack/utilities';
	import { getContext, setContext, type Snippet } from 'svelte';

	const propId = $props.id();

	/* ------------------------------------------------------------------ */
	/*  Determine whether this instance is a RadioGroup or a Radio        */
	/* ------------------------------------------------------------------ */
	let {
		/* --- Radio props --- */
		/** The value of this radio option (required for Radio) */
		value = $bindable(''),

		/** Whether this individual radio is checked (bindable, for standalone use) */
		checked = $bindable(false),

		/** Whether the radio is disabled */
		disabled = false,

		/** The size of the radio. 0=16px, 1=20px, 2=24px, 3=28px */
		size = '1' as '0' | '1' | '2' | '3',

		/** The label text for the radio */
		label = '',

		/** A description shown below the label */
		description = '',

		/** The tooltip message shown on hover */
		tooltip: tooltipMessage = '',

		/** Whether to display in a condensed view */
		dense = false,

		/** Whether to display in an expanded view */
		comfortable = false,

		/** The ID of the radio element */
		id = propId,

		/** The name attribute for the radio group / hidden input */
		name = '',

		/** Specifies a custom class name */
		class: className = '',

		/* --- RadioGroup-only props --- */
		/** Whether the radios should lay out horizontally */
		horizontal = false,

		/** An error message (RadioGroup only) */
		error = '',

		/** Whether the field is required (RadioGroup only) */
		required = false,

		/** Child snippet (RadioGroup renders children; Radio does not) */
		children = undefined as undefined | Snippet,

		/** Called when the selected value changes */
		onchange = undefined as ((detail: { value: string }) => void) | undefined,
	} = $props();

	/* ------------------------------------------------------------------ */
	/*  RadioGroup behaviour (when children are provided)                 */
	/* ------------------------------------------------------------------ */
	// svelte-ignore state_referenced_locally
	const isGroup = !!children;

	const sizes: Record<string, number> = { '0': 16, '1': 20, '2': 24, '3': 28 };

	// Group context
	if (isGroup) {
		const ctx = $state<RadioGroupContext>({
			name: name || id,
			value,
			disabled,
			size,
			select(val: string) {
				value = val;
				onchange?.({ value: val });
			},
		});
		setContext<RadioGroupContext>('radio-group', ctx);

		// Keep context in sync with props
		$effect(() => {
			ctx.name = name || id;
			ctx.value = value;
			ctx.disabled = disabled;
			ctx.size = size;
		});
	}

	/* ------------------------------------------------------------------ */
	/*  Radio (leaf) behaviour                                            */
	/* ------------------------------------------------------------------ */
	const group = getContext<RadioGroupContext | undefined>('radio-group');

	const isSelected = $derived(group ? group.value === value : checked);
	const isDisabled = $derived(group ? group.disabled || disabled : disabled);
	const effectiveSize = $derived(group ? group.size : size);
	const effectiveName = $derived(group ? group.name : name);
	const px = $derived(sizes[effectiveSize] ?? 20);

	function select() {
		if (isDisabled) return;
		if (group) {
			group.select(value);
		} else {
			checked = true;
			onchange?.({ value });
		}
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === ' ') {
			e.preventDefault();
			select();
			return;
		}
		// Arrow key navigation within a group
		if (group && (e.key === 'ArrowDown' || e.key === 'ArrowRight')) {
			e.preventDefault();
			focusSibling(e.currentTarget as HTMLElement, 1);
		}
		if (group && (e.key === 'ArrowUp' || e.key === 'ArrowLeft')) {
			e.preventDefault();
			focusSibling(e.currentTarget as HTMLElement, -1);
		}
	}

	function focusSibling(current: HTMLElement, direction: number) {
		const groupEl = current.closest('.ds-radio-group');
		if (!groupEl) return;
		const radios = Array.from(
			groupEl.querySelectorAll<HTMLElement>('[role="radio"]:not([aria-disabled="true"])'),
		);
		const idx = radios.indexOf(current);
		if (idx === -1) return;
		const next = radios[(idx + direction + radios.length) % radios.length];
		if (next) {
			next.focus();
			next.click();
		}
	}
</script>

{#if isGroup}
	<!-- RadioGroup wrapper -->
	<div
		class={['ds-radio-group', className].filter(Boolean).join(' ')}
		class:horizontal
		class:dense
		class:comfortable
		class:disabled
		class:has-error={!!error}
		role="radiogroup"
		aria-labelledby={label ? `${id}-group-label` : undefined}
		aria-required={required || undefined}
		{id}>
		{#if label}
			<span id="{id}-group-label" class="group-label">{label}</span>
		{/if}
		<div class="group-items" class:horizontal>
			{@render children?.()}
		</div>
		{#if error}
			<span class="error-text">{error}</span>
		{/if}
	</div>
{:else}
	<!-- Individual Radio -->
	<div
		class={['ds-radio', className].filter(Boolean).join(' ')}
		class:dense
		class:comfortable
		class:disabled={isDisabled}
		{@attach tooltip(tooltipMessage)}>
		<!-- Hidden native input for form submission -->
		<input
			type="radio"
			id="{id}-input"
			class="native-input"
			name={effectiveName}
			{value}
			checked={isSelected}
			disabled={isDisabled}
			{required}
			tabindex={-1}
			aria-hidden="true" />

		<div
			class="indicator-wrapper"
			role="radio"
			tabindex={isDisabled ? -1 : 0}
			aria-checked={isSelected}
			aria-disabled={isDisabled}
			aria-labelledby={label ? `${id}-label` : undefined}
			{@attach ripple({ enabled: !isDisabled, centered: true, opacity: 0.15 })}
			onclick={select}
			onkeydown={onKeyDown}
			style:--size="{px}px">
			<svg
				class="indicator"
				class:selected={isSelected}
				viewBox="0 0 24 24"
				width={px}
				height={px}
				fill="none">
				<circle class="ring" cx="12" cy="12" r="10" stroke-width="2" />
				<circle class="dot" cx="12" cy="12" r="5" />
			</svg>
		</div>

		{#if label || description}
			<div class="content">
				{#if label}
					<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions a11y_label_has_associated_control -->
					<label id="{id}-label" for="{id}-input" class="label" onclick={select}>{label}</label>
				{/if}
				{#if description}
					<span class="description">{description}</span>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	/* ========== RadioGroup ========== */
	.ds-radio-group {
		display: flex;
		flex-direction: column;
		gap: 0.25em;

		&.disabled {
			opacity: 0.5;
			pointer-events: none;
		}
		&.has-error {
			.error-text {
				display: block;
			}
		}
	}

	.group-label {
		font-size: 0.85em;
		color: var(--color-text-disabled, #888);
		margin-bottom: 0.25em;
	}

	.group-items {
		display: flex;
		flex-direction: column;
		gap: 0.25em;

		&.horizontal {
			flex-direction: row;
			flex-wrap: wrap;
			gap: 1em;
		}
	}

	.error-text {
		display: none;
		font-size: 0.8em;
		color: var(--color-error, #d32f2f);
		margin-top: 0.25em;
	}

	/* ========== Radio ========== */
	.ds-radio {
		display: flex;
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
		width: calc(var(--size) + 12px);
		height: calc(var(--size) + 12px);
		border-radius: 50%;
		cursor: pointer;
		flex-shrink: 0;
		overflow: hidden;
		outline: none;
		-webkit-tap-highlight-color: transparent;

		&:focus-visible {
			box-shadow: 0 0 0 2px var(--color-text, currentColor);
		}
	}

	.indicator {
		flex-shrink: 0;

		.ring {
			stroke: var(--color-text-disabled, #999);
			fill: transparent;
			transition: stroke 150ms ease;
		}

		.dot {
			fill: transparent;
			transform-origin: center;
			transform: scale(0);
			transition:
				fill 150ms ease,
				transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
		}

		&.selected {
			.ring {
				stroke: var(--color-accent, #1976d2);
			}
			.dot {
				fill: var(--color-accent, #1976d2);
				transform: scale(1);
			}
		}
	}

	.content {
		display: flex;
		flex-direction: column;
		gap: 0.1em;
		padding-top: 0.4em;
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
</style>
