<script lang="ts" module>
	export type InputType =
		| 'text'
		| 'email'
		| 'password'
		| 'url'
		| 'tel'
		| 'search'
		| 'number'
		| 'textarea'
		| 'date'
		| 'time'
		| 'datetime-local'
		| 'color'
		| 'file';

	export interface InputOption {
		value: string;
		label: string;
		disabled?: boolean;
		description?: string;
	}
</script>

<script lang="ts">
	import { tooltip } from '@delightstack/utilities';
	import { getContext, type Component, type Snippet } from 'svelte';
	import type { FormContext } from './Form.svelte';
	import Popover from '../actions/Popover.svelte';

	type InputValue = string | number | boolean | string[] | File | File[] | null | undefined;

	const propId = $props.id();
	let {
		/* ---- Core ---- */
		/** Input type */
		type = 'text' as InputType,

		/** Current value (bindable) */
		value = $bindable() as InputValue,

		/** Floating label text */
		label = undefined as string | undefined,

		/** Placeholder text */
		placeholder = undefined as string | undefined,

		/** Whether the input is disabled */
		disabled = false,

		/** Whether the input is read-only */
		readonly = false,

		/** Whether the input is required */
		required = false,

		/** Form field name (used for Form context registration) */
		name = undefined as string | undefined,

		/** Show skeleton loading state */
		skeleton = false,

		/** Tooltip text */
		tooltip: tooltip_message = undefined as string | undefined,

		/* ---- Validation ---- */
		/** Error message or boolean error state */
		error = undefined as string | boolean | undefined,

		/** Regex pattern for validation */
		pattern = undefined as string | undefined,

		/** Minimum length */
		minlength = undefined as number | undefined,

		/** Maximum length */
		maxlength = undefined as number | undefined,

		/** Minimum value (number/date) */
		min = undefined as number | string | undefined,

		/** Maximum value (number/date) */
		max = undefined as number | string | undefined,

		/** Step value for number inputs */
		step = undefined as number | undefined,

		/* ---- Visual Options ---- */
		/** Input size */
		size = '1' as '0' | '1' | '2' | '3',

		/** Text displayed before the input */
		prefix = undefined as string | undefined,

		/** Text displayed after the input */
		suffix = undefined as string | undefined,

		/** Leading icon component */
		icon = undefined as Component | undefined,

		/** Show clear button when value is present */
		clearable = false,

		/** Show character count */
		showCounter = false,

		/** Helper text displayed below the input */
		helper = undefined as string | undefined,

		/** Tighter internal spacing */
		dense = false,

		/** More internal spacing */
		comfortable = false,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: class_name = '',

		/* ---- Autocomplete ---- */
		/** Suggestion options for autocomplete */
		options = undefined as InputOption[] | undefined,

		/** Async filter callback for loading suggestions */
		onfilter = undefined as ((query: string) => Promise<InputOption[]>) | undefined,

		/* ---- Multiple/Chips ---- */
		/** Enable chips/tags mode (value becomes string[]) */
		multiple = false,

		/* ---- Textarea ---- */
		/** Initial rows for textarea */
		rows = 3,

		/** Auto-grow textarea to fit content */
		autoResize = false,

		/* ---- Password ---- */
		/** Show password visibility toggle */
		showToggle = false,

		/** Show password strength meter */
		strengthIndicator = false,

		/* ---- Mask ---- */
		/** Input mask pattern (#=digit, A=letter, *=any) */
		mask = undefined as string | undefined,

		/* ---- File ---- */
		/** Accepted file types */
		accept = undefined as string | undefined,

		/* ---- Autocomplete option snippet ---- */
		/** Custom snippet for rendering an autocomplete option */
		option: option_snippet = undefined as Snippet<[InputOption]> | undefined,

		/* ---- Events ---- */
		/** Called when value is changing */
		oninput = undefined as ((detail: { value: InputValue }) => void) | undefined,

		/** Called when value is committed */
		onchange = undefined as ((detail: { value: InputValue }) => void) | undefined,

		/** Called when input is focused */
		onfocus = undefined as (() => void) | undefined,

		/** Called when input is blurred */
		onblur = undefined as (() => void) | undefined,
	} = $props();

	/* ------------------------------------------------------------------ */
	/*  Form context integration                                           */
	/* ------------------------------------------------------------------ */

	const form_ctx = getContext<FormContext | undefined>('form');

	$effect(() => {
		if (!form_ctx || !name) return;
		const el = input_element ?? textarea_element;
		if (el) form_ctx.register(name, el);
		return () => {
			if (name) form_ctx.unregister(name);
		};
	});

	/** Error from form context or local prop */
	const resolved_error = $derived.by(() => {
		if (error !== undefined) return error;
		if (form_ctx && name && form_ctx.errors[name]) return form_ctx.errors[name];
		return undefined;
	});

	/** Whether the input is effectively disabled */
	const effectively_disabled = $derived(disabled || (form_ctx?.disabled ?? false));

	/* ------------------------------------------------------------------ */
	/*  Internal state                                                     */
	/* ------------------------------------------------------------------ */

	let input_element = $state<HTMLInputElement | HTMLButtonElement | undefined>(undefined);
	let textarea_element = $state<HTMLTextAreaElement | undefined>(undefined);
	let wrapper_element = $state<HTMLElement | undefined>(undefined);
	let focused = $state(false);
	let password_visible = $state(false);
	let chip_input_value = $state('');

	/* Autocomplete state */
	let ac_open = $state(false);
	let ac_highlighted = $state(-1);
	let ac_loading = $state(false);
	let ac_filtered = $state<InputOption[]>([]);
	let ac_debounce_timer: ReturnType<typeof setTimeout> | undefined;
	let dropdown_element = $state<HTMLElement | undefined>(undefined);

	/* File state */
	let file_input_element = $state<HTMLInputElement | undefined>(undefined);

	/* ------------------------------------------------------------------ */
	/*  Derived values                                                     */
	/* ------------------------------------------------------------------ */

	const is_textarea = $derived(type === 'textarea');
	const is_password = $derived(type === 'password');
	const is_number = $derived(type === 'number');
	const is_search = $derived(type === 'search');
	const is_file = $derived(type === 'file');
	const is_color = $derived(type === 'color');
	const has_autocomplete = $derived(!!(options || onfilter));

	/** Resolved HTML input type */
	const html_type = $derived.by(() => {
		if (is_password) return password_visible ? 'text' : 'password';
		if (type === 'datetime-local') return 'datetime-local';
		if (is_textarea || is_file || is_color) return 'text';
		return type;
	});

	/** Whether the label should float (up position) */
	const label_floated = $derived.by(() => {
		if (!label) return false;
		if (focused) return true;
		if (multiple && Array.isArray(value) && value.length > 0) return true;
		if (is_file && value) return true;
		if (is_color) return true;
		if (value !== undefined && value !== null && value !== '') return true;
		if (placeholder) return true;
		return false;
	});

	/** Whether there is a displayable error */
	const has_error = $derived(!!resolved_error);
	const error_message = $derived(typeof resolved_error === 'string' ? resolved_error : '');

	/** Display string for value length */
	const value_length = $derived.by(() => {
		if (typeof value === 'string') return value.length;
		return 0;
	});

	/** Visible autocomplete options */
	const ac_options = $derived.by((): InputOption[] => {
		if (onfilter) return ac_filtered;
		if (!options) return [];
		const q = typeof value === 'string' ? value.toLowerCase().trim() : '';
		if (!q) return options;
		return options.filter((o) => o.label.toLowerCase().includes(q));
	});

	/** Password strength (0-4) */
	const password_strength = $derived.by((): number => {
		if (!strengthIndicator || type !== 'password' || typeof value !== 'string' || !value) return 0;
		let score = 0;
		if (value.length >= 8) score++;
		if (value.length >= 12) score++;
		if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score++;
		if (/[0-9]/.test(value)) score++;
		if (/[^A-Za-z0-9]/.test(value)) score++;
		return Math.min(score, 4);
	});

	const strength_label = $derived.by(() => {
		const labels = ['', 'Weak', 'Fair', 'Strong', 'Very strong'];
		return labels[password_strength] ?? '';
	});

	const strength_color = $derived.by(() => {
		const colors = [
			'var(--color-border, hsl(0 0% 80%))',
			'var(--color-error, #d32f2f)',
			'var(--color-warning, #f59e0b)',
			'var(--color-success, #16a34a)',
			'var(--color-success, #16a34a)',
		];
		return colors[password_strength] ?? colors[0];
	});

	/** Size config */
	const size_config = $derived.by(() => {
		const configs: Record<string, { height: string; font: string; icon_size: number }> = {
			'0': { height: '28px', font: '13px', icon_size: 14 },
			'1': { height: '36px', font: '15px', icon_size: 16 },
			'2': { height: '44px', font: '17px', icon_size: 18 },
			'3': { height: '52px', font: '19px', icon_size: 20 },
		};
		return configs[size] ?? configs['1'];
	});

	/* ------------------------------------------------------------------ */
	/*  Mask logic                                                         */
	/* ------------------------------------------------------------------ */

	function applyMask(raw: string): string {
		if (!mask) return raw;
		let result = '';
		let raw_idx = 0;
		for (let i = 0; i < mask.length && raw_idx < raw.length; i++) {
			const m = mask[i];
			if (m === '#') {
				/* digit */
				while (raw_idx < raw.length && !/\d/.test(raw[raw_idx])) raw_idx++;
				if (raw_idx < raw.length) {
					result += raw[raw_idx];
					raw_idx++;
				} else break;
			} else if (m === 'A') {
				/* letter */
				while (raw_idx < raw.length && !/[a-zA-Z]/.test(raw[raw_idx])) raw_idx++;
				if (raw_idx < raw.length) {
					result += raw[raw_idx];
					raw_idx++;
				} else break;
			} else if (m === '*') {
				/* any */
				result += raw[raw_idx];
				raw_idx++;
			} else {
				/* literal */
				result += m;
			}
		}
		return result;
	}

	function stripMask(masked: string): string {
		if (!mask) return masked;
		let result = '';
		for (let i = 0; i < masked.length && i < mask.length; i++) {
			const m = mask[i];
			if (m === '#' || m === 'A' || m === '*') {
				result += masked[i];
			}
		}
		return result;
	}

	/* ------------------------------------------------------------------ */
	/*  Textarea auto-resize                                               */
	/* ------------------------------------------------------------------ */

	function autoResizeTextarea() {
		if (!autoResize || !textarea_element) return;
		textarea_element.style.height = 'auto';
		textarea_element.style.height = textarea_element.scrollHeight + 'px';
	}

	$effect(() => {
		if (autoResize && textarea_element && value !== undefined) {
			autoResizeTextarea();
		}
	});

	/* ------------------------------------------------------------------ */
	/*  Autocomplete                                                       */
	/* ------------------------------------------------------------------ */

	function openAutocomplete() {
		if (!has_autocomplete || effectively_disabled || readonly) return;
		ac_open = true;
		ac_highlighted = -1;
	}

	function closeAutocomplete() {
		ac_open = false;
		ac_highlighted = -1;
	}

	async function filterAutocomplete(query: string) {
		if (!onfilter) return;
		ac_loading = true;
		try {
			ac_filtered = await onfilter(query);
		} finally {
			ac_loading = false;
		}
	}

	function selectAutocompleteOption(opt: InputOption) {
		if (opt.disabled) return;
		value = opt.value;
		closeAutocomplete();
		onchange?.({ value });
	}

	function scrollAcHighlightedIntoView() {
		requestAnimationFrame(() => {
			if (!dropdown_element) return;
			const items = dropdown_element.querySelectorAll('[role="option"]');
			const item = items[ac_highlighted];
			if (item) item.scrollIntoView({ block: 'nearest' });
		});
	}

	/* ------------------------------------------------------------------ */
	/*  Event handlers                                                     */
	/* ------------------------------------------------------------------ */

	function handleFocus() {
		focused = true;
		if (has_autocomplete) openAutocomplete();
		onfocus?.();
	}

	function handleBlur() {
		focused = false;
		if (form_ctx && name) form_ctx.setTouched(name);
		/* Delay close so click on option registers */
		setTimeout(() => {
			if (!focused) closeAutocomplete();
		}, 200);
		onblur?.();
	}

	function handleInput(e: Event) {
		const target = e.target as HTMLInputElement | HTMLTextAreaElement;
		let new_value: string | number | null = target.value;

		if (mask) {
			const masked = new_value as string;
			const raw = stripMask(masked) + masked.slice((value as string)?.length ?? 0);
			new_value = applyMask(raw.replace(/[^a-zA-Z0-9]/g, ''));
			target.value = new_value as string;
		}

		if (is_number) {
			new_value = target.value === '' ? null : Number(target.value);
		}

		value = new_value;

		if (form_ctx && name) form_ctx.setValue(name, value);
		oninput?.({ value });

		if (is_textarea && autoResize) autoResizeTextarea();

		/* Autocomplete filtering */
		if (has_autocomplete && typeof new_value === 'string') {
			openAutocomplete();
			if (onfilter) {
				clearTimeout(ac_debounce_timer);
				ac_debounce_timer = setTimeout(() => filterAutocomplete(new_value), 300);
			}
		}
	}

	function handleChange(e: Event) {
		const target = e.target as HTMLInputElement;
		if (is_number) {
			value = target.value === '' ? null : Number(target.value);
		}
		if (form_ctx && name) form_ctx.setValue(name, value);
		onchange?.({ value });
	}

	function handleClear() {
		if (multiple) {
			value = [];
		} else if (is_number) {
			value = null;
		} else if (is_file) {
			value = null;
			if (file_input_element) file_input_element.value = '';
		} else {
			value = '';
		}
		if (form_ctx && name) form_ctx.setValue(name, value);
		oninput?.({ value });
		onchange?.({ value });

		const el = input_element ?? textarea_element;
		el?.focus();
	}

	function handleNumberIncrement(delta: number) {
		if (effectively_disabled || readonly) return;
		const current = typeof value === 'number' ? value : 0;
		const s = step ?? 1;
		let next = current + delta * s;
		if (min !== undefined && typeof min === 'number') next = Math.max(min, next);
		if (max !== undefined && typeof max === 'number') next = Math.min(max, next);
		/* Round to step precision to avoid float issues */
		const precision = String(s).includes('.') ? String(s).split('.')[1].length : 0;
		value = Number(next.toFixed(precision));
		if (form_ctx && name) form_ctx.setValue(name, value);
		oninput?.({ value });
		onchange?.({ value });
	}

	function handlePasswordToggle() {
		password_visible = !password_visible;
		input_element?.focus();
	}

	function handleFileClick() {
		file_input_element?.click();
	}

	function handleFileChange(e: Event) {
		const target = e.target as HTMLInputElement;
		const files = target.files;
		if (!files || files.length === 0) {
			value = null;
		} else if (multiple) {
			value = Array.from(files);
		} else {
			value = files[0];
		}
		if (form_ctx && name) form_ctx.setValue(name, value);
		onchange?.({ value });
	}

	function handleFileDrop(e: DragEvent) {
		e.preventDefault();
		if (effectively_disabled || readonly) return;
		const files = e.dataTransfer?.files;
		if (!files || files.length === 0) return;
		if (multiple) {
			value = Array.from(files);
		} else {
			value = files[0];
		}
		if (form_ctx && name) form_ctx.setValue(name, value);
		onchange?.({ value });
	}

	function handleFileDragOver(e: DragEvent) {
		e.preventDefault();
	}

	/* ---- Chips / Multiple ---- */
	function handleChipKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			addChip();
		} else if (e.key === 'Backspace' && chip_input_value === '' && Array.isArray(value) && value.length > 0) {
			removeChip(value.length - 1);
		}
	}

	function addChip() {
		const trimmed = chip_input_value.trim();
		if (!trimmed) return;
		if (!Array.isArray(value)) value = [];
		const chips = value as string[];
		if (!chips.includes(trimmed)) {
			value = [...chips, trimmed];
			if (form_ctx && name) form_ctx.setValue(name, value);
			oninput?.({ value });
			onchange?.({ value });
		}
		chip_input_value = '';
	}

	function removeChip(index: number) {
		if (!Array.isArray(value)) return;
		const chips = value as string[];
		value = chips.filter((_, i) => i !== index);
		if (form_ctx && name) form_ctx.setValue(name, value);
		oninput?.({ value });
		onchange?.({ value });
	}

	/* ---- Autocomplete keyboard ---- */
	function handleKeyDown(e: KeyboardEvent) {
		if (!has_autocomplete || !ac_open) return;

		switch (e.key) {
			case 'ArrowDown': {
				e.preventDefault();
				const opts = ac_options;
				if (opts.length === 0) break;
				ac_highlighted = ac_highlighted < opts.length - 1 ? ac_highlighted + 1 : 0;
				/* Skip disabled */
				let attempts = 0;
				while (opts[ac_highlighted]?.disabled && attempts < opts.length) {
					ac_highlighted = ac_highlighted < opts.length - 1 ? ac_highlighted + 1 : 0;
					attempts++;
				}
				scrollAcHighlightedIntoView();
				break;
			}
			case 'ArrowUp': {
				e.preventDefault();
				const opts = ac_options;
				if (opts.length === 0) break;
				ac_highlighted = ac_highlighted > 0 ? ac_highlighted - 1 : opts.length - 1;
				let attempts = 0;
				while (opts[ac_highlighted]?.disabled && attempts < opts.length) {
					ac_highlighted = ac_highlighted > 0 ? ac_highlighted - 1 : opts.length - 1;
					attempts++;
				}
				scrollAcHighlightedIntoView();
				break;
			}
			case 'Enter': {
				e.preventDefault();
				if (ac_highlighted >= 0 && ac_highlighted < ac_options.length) {
					selectAutocompleteOption(ac_options[ac_highlighted]);
				}
				break;
			}
			case 'Escape': {
				e.preventDefault();
				closeAutocomplete();
				break;
			}
		}
	}

	/* ---- Display values ---- */
	const file_display = $derived.by(() => {
		if (!is_file || !value) return '';
		if (Array.isArray(value)) {
			return (value as File[]).map((f) => f.name).join(', ');
		}
		if (value instanceof File) return value.name;
		return '';
	});

	/** Whether the clear button should show */
	const show_clear = $derived.by(() => {
		if (!clearable || effectively_disabled || readonly) return false;
		if (multiple) return Array.isArray(value) && value.length > 0;
		if (is_file) return !!value;
		if (is_number) return value !== null && value !== undefined;
		return value !== undefined && value !== null && value !== '';
	});

	/** Highlight matching text in autocomplete option */
	function highlightMatch(text: string): string {
		const q = typeof value === 'string' ? value.trim() : '';
		if (!q) return text;
		const idx = text.toLowerCase().indexOf(q.toLowerCase());
		if (idx === -1) return text;
		const before = text.slice(0, idx);
		const match = text.slice(idx, idx + q.length);
		const after = text.slice(idx + q.length);
		return `${before}<strong>${match}</strong>${after}`;
	}

	/** Counter warning state */
	const counter_state = $derived.by((): 'normal' | 'warning' | 'error' => {
		if (!showCounter || !maxlength) return 'normal';
		const ratio = value_length / maxlength;
		if (ratio >= 1) return 'error';
		if (ratio >= 0.8) return 'warning';
		return 'normal';
	});
</script>

<!-- ================================================================== -->
<!--  TEMPLATE                                                           -->
<!-- ================================================================== -->

<div
	class={['ds-input', `ds-input-size-${size}`, class_name].filter(Boolean).join(' ')}
	class:focused
	class:disabled={effectively_disabled}
	class:readonly
	class:has-error={has_error}
	class:skeleton
	class:dense
	class:comfortable
	class:has-label={!!label}
	class:has-prefix={!!prefix}
	class:has-suffix={!!suffix}
	class:has-icon={!!icon}
	class:is-textarea={is_textarea}
	class:is-file={is_file}
	class:is-color={is_color}
	class:multiple
	style:--input-height={size_config.height}
	style:--input-font={size_config.font}
	style:--input-icon-size="{size_config.icon_size}px"
	{@attach tooltip_message ? tooltip(tooltip_message) : () => {}}>

	{#if skeleton}
		<!-- Skeleton loading state -->
		<div class="input-skeleton">
			{#if label}
				<div class="skeleton-label"></div>
			{/if}
			<div class="skeleton-field"></div>
		</div>
	{:else}
		<!-- Main input wrapper -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="input-wrapper"
			class:focused
			class:has-error={has_error}
			bind:this={wrapper_element}
			ondrop={is_file ? handleFileDrop : undefined}
			ondragover={is_file ? handleFileDragOver : undefined}>

			<!-- Leading icon -->
			{#if icon}
				<span class="input-icon" aria-hidden="true">
					{@render iconRender(icon)}
				</span>
			{/if}

			<!-- Prefix -->
			{#if prefix}
				<span class="input-prefix" aria-hidden="true">{prefix}</span>
			{/if}

			<!-- Color swatch -->
			{#if is_color}
				<span
					class="color-swatch"
					style:background={typeof value === 'string' && value ? value : '#000000'}
					aria-hidden="true"></span>
			{/if}

			<!-- Multiple chips -->
			{#if multiple && Array.isArray(value)}
				<div class="chips-container">
					{#each value as chip, i (chip + '-' + i)}
						<span class="chip">
							<span class="chip-text">{chip}</span>
							<button
								type="button"
								class="chip-remove"
								aria-label="Remove {chip}"
								tabindex={-1}
								onclick={() => removeChip(i)}
								disabled={effectively_disabled}>
								<!-- close icon -->
								<svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
									<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
								</svg>
							</button>
						</span>
					{/each}
					<input
						type="text"
						class="chip-input"
						bind:this={input_element}
						bind:value={chip_input_value}
						{id}
						{placeholder}
						disabled={effectively_disabled}
						{readonly}
						aria-label={label || placeholder || 'Add tag'}
						onfocus={handleFocus}
						onblur={handleBlur}
						onkeydown={handleChipKeyDown} />
				</div>
			{:else if is_textarea}
				<!-- Textarea -->
				<textarea
					bind:this={textarea_element}
					{id}
					{name}
					class="input-field"
					{placeholder}
					disabled={effectively_disabled}
					{readonly}
					{required}
					{rows}
					{maxlength}
					{minlength}
					aria-invalid={has_error || undefined}
					aria-required={required || undefined}
					aria-describedby={has_error ? `${id}-error` : helper ? `${id}-helper` : undefined}
					onfocus={handleFocus}
					onblur={handleBlur}
					oninput={handleInput}
					onchange={handleChange}
					value={(value ?? '') as string}></textarea>
			{:else if is_file}
				<!-- File input: hidden native + visible display -->
				<input
					bind:this={file_input_element}
					type="file"
					{name}
					{accept}
					multiple={multiple}
					disabled={effectively_disabled}
					class="file-native"
					aria-hidden="true"
					tabindex={-1}
					onchange={handleFileChange} />
				<button
					type="button"
					bind:this={input_element}
					{id}
					class="input-field file-display"
					disabled={effectively_disabled}
					aria-describedby={has_error ? `${id}-error` : helper ? `${id}-helper` : undefined}
					onfocus={handleFocus}
					onblur={handleBlur}
					onclick={handleFileClick}>
					{#if file_display}
						<span class="file-name">{file_display}</span>
					{:else}
						<span class="file-placeholder">{placeholder ?? 'Choose file...'}</span>
					{/if}
				</button>
			{:else if is_color}
				<!-- Color: native picker + text display -->
				<input
					type="color"
					class="color-native"
					value={typeof value === 'string' && value ? value : '#000000'}
					disabled={effectively_disabled}
					oninput={(e) => {
						value = (e.target as HTMLInputElement).value;
						if (form_ctx && name) form_ctx.setValue(name, value);
						oninput?.({ value });
					}}
					onchange={(e) => {
						value = (e.target as HTMLInputElement).value;
						onchange?.({ value });
					}}
					aria-hidden="true"
					tabindex={-1} />
				<input
					bind:this={input_element}
					{id}
					{name}
					type="text"
					class="input-field"
					{placeholder}
					disabled={effectively_disabled}
					{readonly}
					{required}
					value={value ?? ''}
					aria-invalid={has_error || undefined}
					aria-required={required || undefined}
					aria-describedby={has_error ? `${id}-error` : helper ? `${id}-helper` : undefined}
					onfocus={handleFocus}
					onblur={handleBlur}
					oninput={handleInput}
					onchange={handleChange} />
			{:else}
				<!-- Standard input -->
				<input
					bind:this={input_element}
					{id}
					{name}
					type={html_type}
					class="input-field"
					class:has-autocomplete={has_autocomplete}
					{placeholder}
					disabled={effectively_disabled}
					{readonly}
					{required}
					{maxlength}
					{minlength}
					{pattern}
					min={min}
					max={max}
					step={is_number ? step : undefined}
					autocomplete={has_autocomplete ? 'off' : undefined}
					role={has_autocomplete ? 'combobox' : undefined}
					aria-expanded={has_autocomplete ? ac_open : undefined}
					aria-autocomplete={has_autocomplete ? 'list' : undefined}
					aria-controls={has_autocomplete ? `${id}-listbox` : undefined}
					aria-activedescendant={has_autocomplete && ac_highlighted >= 0 ? `${id}-option-${ac_highlighted}` : undefined}
					aria-invalid={has_error || undefined}
					aria-required={required || undefined}
					aria-describedby={has_error ? `${id}-error` : helper ? `${id}-helper` : undefined}
					value={is_number ? (value ?? '') : (value ?? '')}
					onfocus={handleFocus}
					onblur={handleBlur}
					oninput={handleInput}
					onchange={handleChange}
					onkeydown={has_autocomplete ? handleKeyDown : undefined} />
			{/if}

			<!-- Floating label -->
			{#if label}
				<label class="input-label" class:floated={label_floated} for={id}>
					{label}{#if required}<span class="required-mark" aria-hidden="true"> *</span>{/if}
				</label>
			{/if}

			<!-- Suffix -->
			{#if suffix}
				<span class="input-suffix" aria-hidden="true">{suffix}</span>
			{/if}

			<!-- Number buttons -->
			{#if is_number}
				<div class="number-buttons">
					<button
						type="button"
						class="number-btn"
						tabindex={-1}
						aria-label="Decrease"
						disabled={effectively_disabled || (min !== undefined && typeof min === 'number' && typeof value === 'number' && value <= min)}
						onclick={() => handleNumberIncrement(-1)}>
						<!-- minus icon -->
						<svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
							<path d="M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
						</svg>
					</button>
					<button
						type="button"
						class="number-btn"
						tabindex={-1}
						aria-label="Increase"
						disabled={effectively_disabled || (max !== undefined && typeof max === 'number' && typeof value === 'number' && value >= max)}
						onclick={() => handleNumberIncrement(1)}>
						<!-- plus icon -->
						<svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
							<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
						</svg>
					</button>
				</div>
			{/if}

			<!-- Password toggle -->
			{#if is_password && showToggle}
				<button
					type="button"
					class="input-action-btn"
					tabindex={-1}
					aria-label={password_visible ? 'Hide password' : 'Show password'}
					onclick={handlePasswordToggle}>
					{#if password_visible}
						<!-- eye-off icon -->
						<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
							<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
							<line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
						</svg>
					{:else}
						<!-- eye icon -->
						<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
							<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
							<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
						</svg>
					{/if}
				</button>
			{/if}

			<!-- Search icon -->
			{#if is_search && !icon}
				<span class="input-icon search-icon" aria-hidden="true">
					<svg viewBox="0 0 24 24" width="16" height="16" fill="none">
						<circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
						<path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
					</svg>
				</span>
			{/if}

			<!-- Clear button -->
			{#if show_clear}
				<button
					type="button"
					class="input-action-btn clear-btn"
					tabindex={-1}
					aria-label="Clear"
					onclick={handleClear}>
					<svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
						<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
					</svg>
				</button>
			{/if}
		</div>

		<!-- Password strength indicator -->
		{#if is_password && strengthIndicator && typeof value === 'string' && value.length > 0}
			<div class="strength-meter" aria-label="Password strength: {strength_label}">
				<div class="strength-track">
					{#each [1, 2, 3, 4] as segment}
						<div
							class="strength-segment"
							class:active={password_strength >= segment}
							style:background={password_strength >= segment ? strength_color : undefined}></div>
					{/each}
				</div>
				<span class="strength-label" style:color={strength_color}>{strength_label}</span>
			</div>
		{/if}

		<!-- Footer row: error, helper, counter -->
		{#if has_error || helper || (showCounter && maxlength)}
			<div class="input-footer">
				{#if has_error && error_message}
					<span class="input-error" id="{id}-error" role="alert">{error_message}</span>
				{:else if helper}
					<span class="input-helper" id="{id}-helper">{helper}</span>
				{:else}
					<span></span>
				{/if}

				{#if showCounter && maxlength}
					<span class="input-counter" class:counter-warning={counter_state === 'warning'} class:counter-error={counter_state === 'error'}>
						{value_length}/{maxlength}
					</span>
				{/if}
			</div>
		{/if}

		<!-- Autocomplete dropdown -->
		{#if has_autocomplete}
			<Popover
				refElement={wrapper_element}
				bind:opened={ac_open}
				openOnClick={false}
				arrow={false}
				placement="bottom"
				closeOnOutsideClick
				closeOnEscapeKey
				closeOnInsideClick={false}
				disableInitialFocus>

				<div
					class="ac-dropdown"
					bind:this={dropdown_element}
					role="listbox"
					id="{id}-listbox">

					{#if ac_loading}
						<div class="ac-loading">
							<span class="ac-spinner" aria-hidden="true"></span>
							Loading...
						</div>
					{:else if ac_options.length === 0}
						<div class="ac-empty">No results</div>
					{:else}
						{#each ac_options as opt, i (opt.value)}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<div
								id="{id}-option-{i}"
								class="ac-option"
								class:highlighted={ac_highlighted === i}
								class:disabled={opt.disabled}
								role="option"
								tabindex={-1}
								aria-selected={value === opt.value}
								aria-disabled={opt.disabled || undefined}
								onpointerdown={(e) => e.preventDefault()}
								onclick={() => selectAutocompleteOption(opt)}
								onpointerenter={() => { if (!opt.disabled) ac_highlighted = i; }}>
								{#if option_snippet}
									{@render option_snippet(opt)}
								{:else}
									<span class="ac-option-content">
										<span class="ac-option-label">{@html highlightMatch(opt.label)}</span>
										{#if opt.description}
											<span class="ac-option-desc">{opt.description}</span>
										{/if}
									</span>
								{/if}
							</div>
						{/each}
					{/if}
				</div>
			</Popover>
		{/if}
	{/if}
</div>

<!-- Hidden native input for form submission (non-textarea, non-file types) -->
{#if name && !is_textarea && !is_file && !multiple}
	<input type="hidden" {name} value={value ?? ''} />
{/if}
{#if name && multiple && Array.isArray(value)}
	{#each value as v (v)}
		<input type="hidden" {name} value={v} />
	{/each}
{/if}

{#snippet iconRender(IconComponent: Component)}
	<IconComponent />
{/snippet}

<style>
	/* ================================================================== */
	/*  ROOT                                                               */
	/* ================================================================== */

	.ds-input {
		--_height: var(--input-height, 36px);
		--_font: var(--input-font, 15px);
		--_icon-size: var(--input-icon-size, 16px);
		--_border: var(--color-border, hsl(0 0% 80%));
		--_border-focus: var(--color-action, hsl(220 70% 55%));
		--_border-error: var(--color-error, #d32f2f);
		--_bg: light-dark(white, var(--color-surface, hsl(0 0% 10%)));
		--_text: var(--color-text, inherit);
		--_text-muted: var(--color-text-muted, hsl(0 0% 55%));
		--_focus-ring: var(--color-focus-ring, color-mix(in oklch, var(--color-action, hsl(220 70% 55%)) 20%, transparent));
		--_radius: var(--radius-md, 6px);
		--_duration: var(--duration-fast, 150ms);
		--_ease: var(--ease-default, ease);

		position: relative;
		width: 100%;
		font-size: var(--_font);
	}

	.ds-input.disabled {
		opacity: 0.5;
		pointer-events: none;
	}

	.ds-input.dense .input-wrapper {
		padding: 0 0.5rem;
	}
	.ds-input.comfortable .input-wrapper {
		padding: 0 1rem;
	}

	/* ================================================================== */
	/*  SKELETON                                                           */
	/* ================================================================== */

	.input-skeleton {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.skeleton-label {
		width: 30%;
		height: 0.75em;
		border-radius: var(--radius-sm, 4px);
		background: var(--color-bg-muted, hsl(0 0% 90%));
		animation: input-skeleton-pulse 1.5s ease-in-out infinite;
	}

	.skeleton-field {
		width: 100%;
		height: var(--_height);
		border-radius: var(--_radius);
		background: var(--color-bg-muted, hsl(0 0% 90%));
		animation: input-skeleton-pulse 1.5s ease-in-out infinite;
	}

	@keyframes input-skeleton-pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
	}

	/* ================================================================== */
	/*  WRAPPER                                                            */
	/* ================================================================== */

	.input-wrapper {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: var(--_height);
		padding: 0 0.75rem;
		border: 1px solid var(--_border);
		border-radius: var(--_radius);
		background: var(--_bg);
		transition:
			border-color var(--_duration) var(--_ease),
			box-shadow var(--_duration) var(--_ease);
		cursor: text;
	}

	.ds-input.is-textarea .input-wrapper {
		align-items: flex-start;
		min-height: auto;
	}

	.input-wrapper.focused {
		border-color: var(--_border-focus);
		box-shadow: 0 0 0 2px var(--_focus-ring);
	}

	.input-wrapper.has-error {
		border-color: var(--_border-error);
		animation: input-shake 300ms ease;
	}

	.input-wrapper.has-error.focused {
		box-shadow: 0 0 0 2px color-mix(in oklch, var(--_border-error) 20%, transparent);
	}

	@keyframes input-shake {
		0%, 100% { transform: translateX(0); }
		20% { transform: translateX(-4px); }
		40% { transform: translateX(4px); }
		60% { transform: translateX(-2px); }
		80% { transform: translateX(2px); }
	}

	/* ================================================================== */
	/*  INPUT FIELD                                                        */
	/* ================================================================== */

	.input-field {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: transparent;
		font: inherit;
		font-size: var(--_font);
		color: var(--_text);
		padding: 0;
		height: var(--_height);
		line-height: var(--_height);
	}

	.input-field::placeholder {
		color: var(--_text-muted);
		opacity: 0.7;
	}

	/* With floating label, shift the input down slightly */
	.ds-input.has-label .input-field {
		padding-top: 0.625em;
	}

	.ds-input.has-label.ds-input-size-0 .input-field {
		padding-top: 0.5em;
	}

	/* Textarea specifics */
	textarea.input-field {
		height: auto;
		line-height: 1.5;
		resize: vertical;
		padding-top: 0.75rem;
	}

	.ds-input.has-label textarea.input-field {
		padding-top: 1.25rem;
	}

	/* Number: hide native spinner */
	input[type="number"].input-field {
		appearance: textfield;
		-moz-appearance: textfield;
	}
	input[type="number"].input-field::-webkit-outer-spin-button,
	input[type="number"].input-field::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}

	/* Search: hide native clear */
	input[type="search"].input-field::-webkit-search-cancel-button {
		-webkit-appearance: none;
	}

	/* ================================================================== */
	/*  FLOATING LABEL                                                     */
	/* ================================================================== */

	.input-label {
		position: absolute;
		left: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		font-size: var(--_font);
		color: var(--_text-muted);
		pointer-events: none;
		transition:
			top 200ms var(--_ease),
			font-size 200ms var(--_ease),
			color var(--_duration) var(--_ease);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: calc(100% - 1.5rem);
		line-height: 1;
	}

	.ds-input.has-icon .input-label {
		left: calc(0.75rem + var(--_icon-size) + 0.5rem);
	}
	.ds-input.has-prefix .input-label {
		left: auto;
	}

	.ds-input.is-textarea .input-label {
		top: 0.875rem;
		transform: none;
	}

	.input-label.floated {
		top: 0.25rem;
		font-size: calc(var(--_font) * 0.7);
		transform: none;
	}

	.ds-input.is-textarea .input-label.floated {
		top: 0.25rem;
	}

	.ds-input-size-0 .input-label.floated {
		top: 0.125rem;
		font-size: calc(var(--_font) * 0.75);
	}

	.ds-input.focused .input-label {
		color: var(--_border-focus);
	}

	.ds-input.has-error .input-label {
		color: var(--_border-error);
	}

	.required-mark {
		color: var(--_border-error);
	}

	/* ================================================================== */
	/*  ICONS & PREFIX / SUFFIX                                            */
	/* ================================================================== */

	.input-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--_text-muted);
		flex-shrink: 0;
		width: var(--_icon-size);
		height: var(--_icon-size);
	}

	.search-icon {
		order: -1;
	}

	.input-prefix,
	.input-suffix {
		flex-shrink: 0;
		color: var(--_text-muted);
		font-size: 0.9em;
		user-select: none;
		white-space: nowrap;
	}

	.input-suffix {
		order: 1;
	}

	/* ================================================================== */
	/*  ACTION BUTTONS (clear, toggle, etc.)                               */
	/* ================================================================== */

	.input-action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.125rem;
		border: none;
		background: transparent;
		color: var(--_text-muted);
		cursor: pointer;
		border-radius: var(--radius-sm, 4px);
		flex-shrink: 0;
		transition: color var(--_duration) var(--_ease), opacity var(--_duration) var(--_ease);
		opacity: 0.5;
	}

	.input-action-btn:hover {
		opacity: 1;
		color: var(--_text);
	}

	.clear-btn {
		opacity: 0;
		transition: opacity var(--_duration) var(--_ease);
	}
	.input-wrapper:hover .clear-btn,
	.input-wrapper.focused .clear-btn {
		opacity: 0.5;
	}
	.input-wrapper:hover .clear-btn:hover,
	.input-wrapper.focused .clear-btn:hover {
		opacity: 1;
	}

	/* ================================================================== */
	/*  NUMBER INCREMENT / DECREMENT                                       */
	/* ================================================================== */

	.number-buttons {
		display: flex;
		flex-direction: column;
		gap: 1px;
		flex-shrink: 0;
		margin: -0.25rem 0;
	}

	.number-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		width: 1.25rem;
		height: calc(var(--_height) / 2 - 2px);
		border: none;
		background: transparent;
		color: var(--_text-muted);
		cursor: pointer;
		border-radius: var(--radius-sm, 4px);
		transition: background var(--_duration) var(--_ease), color var(--_duration) var(--_ease);
	}

	.number-btn:hover:not(:disabled) {
		background: light-dark(var(--color-bg-muted, hsl(0 0% 93%)), var(--color-bg-muted, hsl(0 0% 20%)));
		color: var(--_text);
	}

	.number-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	/* ================================================================== */
	/*  COLOR INPUT                                                        */
	/* ================================================================== */

	.color-swatch {
		width: 1.25rem;
		height: 1.25rem;
		border-radius: var(--radius-sm, 4px);
		border: 1px solid var(--_border);
		flex-shrink: 0;
	}

	.color-native {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		border: 0;
		padding: 0;
		margin: -1px;
	}

	/* ================================================================== */
	/*  FILE INPUT                                                         */
	/* ================================================================== */

	.file-native {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		border: 0;
		padding: 0;
		margin: -1px;
	}

	.file-display {
		cursor: pointer;
		text-align: left;
		font: inherit;
	}

	.file-placeholder {
		color: var(--_text-muted);
		opacity: 0.7;
	}

	.file-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* ================================================================== */
	/*  CHIPS (Multiple mode)                                              */
	/* ================================================================== */

	.chips-container {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
		flex: 1;
		min-width: 0;
		padding: 0.25rem 0;
	}

	.ds-input.has-label .chips-container {
		padding-top: 0.875rem;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.125rem;
		padding: 0.0625rem 0.375rem;
		border-radius: var(--radius-sm, 4px);
		background: light-dark(var(--color-bg-muted, hsl(0 0% 91%)), var(--color-bg-muted, hsl(0 0% 22%)));
		font-size: 0.85em;
		max-width: 100%;
		line-height: 1.5;
	}

	.chip-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chip-remove {
		display: flex;
		align-items: center;
		padding: 0;
		border: none;
		background: none;
		color: inherit;
		cursor: pointer;
		opacity: 0.5;
		flex-shrink: 0;
		transition: opacity var(--_duration) var(--_ease);
	}

	.chip-remove:hover {
		opacity: 1;
	}

	.chip-input {
		flex: 1;
		min-width: 4rem;
		border: none;
		outline: none;
		background: transparent;
		font: inherit;
		font-size: var(--_font);
		color: var(--_text);
		padding: 0;
		height: 1.75em;
	}

	.chip-input::placeholder {
		color: var(--_text-muted);
		opacity: 0.7;
	}

	/* ================================================================== */
	/*  PASSWORD STRENGTH                                                  */
	/* ================================================================== */

	.strength-meter {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.375rem;
	}

	.strength-track {
		display: flex;
		gap: 3px;
		flex: 1;
	}

	.strength-segment {
		height: 3px;
		flex: 1;
		border-radius: 2px;
		background: var(--_border);
		transition: background 300ms var(--_ease);
	}

	.strength-label {
		font-size: 0.75em;
		white-space: nowrap;
		transition: color 300ms var(--_ease);
	}

	/* ================================================================== */
	/*  FOOTER (error, helper, counter)                                    */
	/* ================================================================== */

	.input-footer {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
		margin-top: 0.25rem;
		min-height: 1.25em;
	}

	.input-error {
		font-size: 0.8em;
		color: var(--_border-error);
		animation: input-error-in 200ms var(--_ease);
	}

	@keyframes input-error-in {
		from { opacity: 0; transform: translateY(-4px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.input-helper {
		font-size: 0.8em;
		color: var(--_text-muted);
	}

	.input-counter {
		font-size: 0.75em;
		color: var(--_text-muted);
		margin-left: auto;
		font-variant-numeric: tabular-nums;
		transition: color var(--_duration) var(--_ease);
	}

	.input-counter.counter-warning {
		color: var(--color-warning, #f59e0b);
	}

	.input-counter.counter-error {
		color: var(--_border-error);
		font-weight: 600;
	}

	/* ================================================================== */
	/*  AUTOCOMPLETE DROPDOWN                                              */
	/* ================================================================== */

	.ac-dropdown {
		min-width: 100%;
		max-height: 240px;
		overflow-y: auto;
		padding: 0.25rem;
	}

	.ac-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-sm, 4px);
		cursor: pointer;
		transition: background 100ms;
		user-select: none;
	}

	.ac-option:hover,
	.ac-option.highlighted {
		background: light-dark(var(--color-bg-subtle, hsl(0 0% 96%)), var(--color-bg-subtle, hsl(0 0% 18%)));
	}

	.ac-option.disabled {
		opacity: 0.5;
		pointer-events: none;
	}

	.ac-option-content {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}

	.ac-option-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ac-option-desc {
		font-size: 0.8em;
		color: var(--_text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ac-loading {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem;
		color: var(--_text-muted);
		font-size: 0.9em;
	}

	.ac-spinner {
		display: inline-block;
		width: 14px;
		height: 14px;
		border: 2px solid var(--_border);
		border-top-color: var(--_border-focus);
		border-radius: 50%;
		animation: input-ac-spin 0.6s linear infinite;
		flex-shrink: 0;
	}

	@keyframes input-ac-spin {
		to { transform: rotate(360deg); }
	}

	.ac-empty {
		padding: 0.75rem;
		text-align: center;
		color: var(--_text-muted);
		font-size: 0.9em;
	}

	/* ================================================================== */
	/*  SIZE OVERRIDES                                                     */
	/* ================================================================== */

	.ds-input-size-0 .input-wrapper {
		min-height: 28px;
		padding: 0 0.5rem;
		gap: 0.375rem;
	}
	.ds-input-size-0 .input-field {
		height: 28px;
		line-height: 28px;
	}
	.ds-input-size-0 .input-label {
		left: 0.5rem;
	}

	.ds-input-size-2 .input-wrapper {
		min-height: 44px;
		padding: 0 0.875rem;
	}
	.ds-input-size-2 .input-field {
		height: 44px;
		line-height: 44px;
	}
	.ds-input-size-2 .input-label {
		left: 0.875rem;
	}

	.ds-input-size-3 .input-wrapper {
		min-height: 52px;
		padding: 0 1rem;
	}
	.ds-input-size-3 .input-field {
		height: 52px;
		line-height: 52px;
	}
	.ds-input-size-3 .input-label {
		left: 1rem;
	}

	/* ================================================================== */
	/*  READONLY                                                           */
	/* ================================================================== */

	.ds-input.readonly .input-wrapper {
		background: light-dark(var(--color-bg-muted, hsl(0 0% 96%)), var(--color-bg-muted, hsl(0 0% 14%)));
		cursor: default;
	}
</style>
