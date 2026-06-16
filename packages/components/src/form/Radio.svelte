<script lang="ts" module>
	export { default as RadioGroup } from './Radio.svelte';

	export interface RadioGroupContext {
		/** The shared `name` attribute for all radios in the group */
		name: string;
		/** The currently selected value */
		value: string;
		/** Whether the whole group is disabled */
		disabled: boolean;
		/** The size applied to all radios in the group */
		size: '0' | '1' | '2' | '3';
		/** Selects the radio with the given value */
		select: (value: string) => void;
	}
</script>

<script lang="ts">
	import { ripple, tooltip } from '@delightstack/utilities';
	import { getContext, setContext, type Snippet } from 'svelte';
	import type { FormContext } from './Form.svelte';

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
		tooltip: tooltip_message = '',

		/** Whether to display in a condensed view */
		dense = false,

		/** Whether to display in an expanded view */
		comfortable = false,

		/** The ID of the radio element */
		id = propId,

		/** The name attribute for the radio group / hidden input */
		name = '',

		/** Specifies a custom class name */
		class: class_name = '',

		/* --- RadioGroup-only props --- */
		/** Whether the radios should lay out horizontally */
		horizontal = false,

		/** An error message (RadioGroup only) */
		error = '',

		/** Whether the field is required (RadioGroup only) */
		required = false,

		/** Parses & validates the value (e.g. a database table form field's
		 *  `parse`). Inside a Form it is registered with the form, which runs it
		 *  on the form's validation timing. RadioGroup only. */
		parse = undefined as ((value: unknown) => unknown) | undefined,

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

	/* ------------------------------------------------------------------ */
	/*  Form context integration (RadioGroup only)                         */
	/* ------------------------------------------------------------------ */

	const form_ctx = getContext<FormContext | undefined>('form');
	let group_element = $state<HTMLElement | undefined>(undefined);

	/** Disabled merges the parent form's disabled/submitting state */
	const effectively_disabled = $derived(disabled || (form_ctx?.disabled ?? false));

	/** Group error from the local prop or the parent form context */
	const resolved_error = $derived.by(() => {
		if (error) return error;
		if (form_ctx && name && form_ctx.errors[name]) return form_ctx.errors[name];
		return '';
	});

	// Group context
	if (isGroup) {
		const ctx = $state<RadioGroupContext>({
			name: name || id,
			value,
			disabled,
			size,
			select(val: string) {
				value = val;
				if (form_ctx && name) {
					form_ctx.setValue(name, val);
					form_ctx.setTouched(name);
				}
				onchange?.({ value: val });
			},
		});
		setContext<RadioGroupContext>('radio-group', ctx);

		// Keep context in sync with props
		$effect(() => {
			ctx.name = name || id;
			ctx.value = value;
			ctx.disabled = effectively_disabled;
			ctx.size = size;
		});

		// Register the group with a parent Form (focus-on-error + field validator)
		$effect(() => {
			if (!form_ctx || !name) return;
			if (group_element) form_ctx.register(name, group_element, parse);
			return () => form_ctx.unregister(name);
		});

		// Context-driven: drive the selected value from the form data when the
		// group lives inside a Form and has a name — no bind:value needed.
		$effect(() => {
			if (!form_ctx || !name) return;
			const ctx_value = form_ctx.getValue(name);
			const next = ctx_value == null ? '' : String(ctx_value);
			if (next !== value) value = next;
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

	let animating = $state(false);

	function select() {
		if (isDisabled) return;
		const wasSelected = isSelected;
		if (group) {
			group.select(value);
		} else {
			checked = true;
			onchange?.({ value });
		}
		if (!wasSelected) {
			animating = true;
			setTimeout(() => (animating = false), 350);
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
		const groupEl = current.closest('.radio-group');
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
		bind:this={group_element}
		class={['radio-group', class_name].filter(Boolean).join(' ')}
		class:horizontal
		class:dense
		class:comfortable
		class:disabled={effectively_disabled}
		class:has-error={!!resolved_error}
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
		{#if resolved_error}
			<span class="error-text">{resolved_error}</span>
		{/if}
	</div>
{:else}
	<!-- Individual Radio -->
	<!-- The whole container is the click target so the hit area matches the
	     hover/press feedback (which keys off `.radio`). Keyboard activation and
	     arrow-key navigation stay on the focusable role="radio" indicator. -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class={['radio', class_name].filter(Boolean).join(' ')}
		class:dense
		class:comfortable
		class:disabled={isDisabled}
		{@attach tooltip(tooltip_message)}
		style:--size="{px}px"
		style:font-size={`var(--control-font-${effectiveSize})`}
		onclick={select}>
		<!-- Hidden native input for form submission -->
		<input
			type="radio"
			id="{id}-input"
			name={effectiveName}
			{value}
			checked={isSelected}
			disabled={isDisabled}
			{required}
			tabindex={-1}
			aria-hidden="true" />

		<div
			class="indicator-wrapper"
			class:selected={isSelected}
			role="radio"
			tabindex={isDisabled ? -1 : 0}
			aria-checked={isSelected}
			aria-disabled={isDisabled}
			aria-labelledby={label ? `${id}-label` : undefined}
			{@attach ripple({ enabled: !isDisabled, centered: true, opacity: 0.15 })}
			onkeydown={onKeyDown}>
			<svg
				class="indicator"
				class:selected={isSelected}
				class:animating
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
					<span id="{id}-label" class="label">{label}</span>
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
	.radio-group {
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
	.radio {
		display: flex;
		align-items: flex-start;
		gap: 0.5em;
		/* The whole container is clickable, so the pointer cursor and the
		   hover/press feedback now line up with the actual hit area. Bound it
		   to its content so it can't stretch the hit area across the full group
		   width (align-items: stretch in .group-items would otherwise do so). */
		width: fit-content;
		cursor: pointer;
		user-select: none;
		position: relative;
		perspective: 100px;
		transition: translate 200ms ease;

		&:not(.disabled):active {
			translate: 0px 3px clamp(-10px, calc(0.2em - 12px), -2px);
		}

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

	/* Hidden native radio, kept for form submission */
	input {
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

		/* Accent-tinted hover when selected */
		&.selected {
			--hover-tint: color-mix(in srgb, var(--color-accent, #1976d2) 16%, transparent);
		}

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

		/* Select animation: elastic dot scale + ring pulse */
		&.animating {
			animation: ring-pulse 350ms cubic-bezier(0.34, 1.56, 0.64, 1);

			.dot {
				transition:
					fill 150ms ease,
					transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
			}
		}
	}

	@keyframes ring-pulse {
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
</style>
