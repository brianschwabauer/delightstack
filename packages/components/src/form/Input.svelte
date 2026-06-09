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
	import { scale } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { backOut, quintOut } from 'svelte/easing';
	import type { FormContext } from './Form.svelte';
	import Button from '../actions/Button.svelte';
	import List from '../display/List.svelte';
	import ListItem from '../display/ListItem.svelte';

	type InputValue =
		| string
		| number
		| boolean
		| string[]
		| File
		| File[]
		| null
		| undefined;

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
		show_counter = false,

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
		auto_resize = false,

		/* ---- Password ---- */
		/** Show password visibility toggle */
		show_toggle = false,

		/** Show password strength meter */
		strength_indicator = false,

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
		const el = input_element ?? textarea_element ?? file_input_element;
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

	/** Whether the input is effectively disabled (loading skeleton counts) */
	const effectively_disabled = $derived(
		disabled || skeleton || (form_ctx?.disabled ?? false),
	);

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
	/* Whether the panel flipped above the field, so it can expand from the edge
	   nearest the control (matching Select's panel). */
	let ac_above = $state(false);

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
	const is_datelike = $derived(
		type === 'date' || type === 'time' || type === 'datetime-local',
	);
	const has_autocomplete = $derived(!!(options || onfilter));

	/** A unique CSS anchor name for native anchor positioning of the panel. */
	const ac_anchor_name = $derived(
		`--ds-input-${String(id).replace(/[^a-zA-Z0-9_-]/g, '')}`,
	);

	/** Resolved HTML input type */
	const html_type = $derived.by(() => {
		if (is_password) return password_visible ? 'text' : 'password';
		if (type === 'datetime-local') return 'datetime-local';
		if (is_textarea || is_file || is_color) return 'text';
		return type;
	});

	/**
	 * Types that render their own intrinsic content — a colour swatch, the
	 * browser's native date format, a file button — and therefore can't use the
	 * label as an in-field placeholder. Their label stays pinned to the top.
	 */
	const always_float_type = $derived(is_color || is_file || is_datelike);

	/**
	 * A placeholder is "distinct" only when it differs from the label. A distinct
	 * placeholder pins the label to the top so the placeholder stays visible
	 * inside the field; otherwise the label animates and doubles as the
	 * placeholder (the legacy behaviour).
	 */
	const has_distinct_placeholder = $derived(!!placeholder && placeholder !== label);

	/**
	 * The placeholder handed to the native control. Suppressed while the label is
	 * acting as the in-field placeholder, so the two never overlap.
	 */
	const native_placeholder = $derived.by(() => {
		if (!label) return placeholder;
		if (has_distinct_placeholder) return placeholder;
		return undefined;
	});

	/** Whether the label should float (up position) */
	const label_floated = $derived.by(() => {
		if (!label) return false;
		/* Pinned to the top: a distinct placeholder, an always-visible prefix,
		   or a type that can't host the label as a placeholder. */
		if (has_distinct_placeholder) return true;
		if (always_float_type) return true;
		if (prefix) return true;
		/* Otherwise the label animates up on focus or once there's a value. */
		if (focused) return true;
		if (multiple && Array.isArray(value) && value.length > 0) return true;
		if (value !== undefined && value !== null && value !== '') return true;
		return false;
	});

	/** Whether there is a displayable error */
	const has_error = $derived(!!resolved_error);
	const error_message = $derived(
		typeof resolved_error === 'string' ? resolved_error : '',
	);

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
		if (!strength_indicator || type !== 'password' || typeof value !== 'string' || !value)
			return 0;
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
		/* The font drives the whole control's scale (see CSS --_height). The
		   per-size font comes from the shared --control-font-* tokens so Input,
		   Select and Button line up at the same height for a given size. */
		const configs: Record<string, { font: string; icon_size: number }> = {
			'0': { font: 'var(--control-font-0, 0.875rem)', icon_size: 15 },
			'1': { font: 'var(--control-font-1, 1rem)', icon_size: 17 },
			'2': { font: 'var(--control-font-2, 1.125rem)', icon_size: 19 },
			'3': { font: 'var(--control-font-3, 1.25rem)', icon_size: 21 },
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
		if (!auto_resize || !textarea_element) return;
		textarea_element.style.height = 'auto';
		textarea_element.style.height = textarea_element.scrollHeight + 'px';
	}

	$effect(() => {
		if (auto_resize && textarea_element && value !== undefined) {
			autoResizeTextarea();
		}
	});

	/* ------------------------------------------------------------------ */
	/*  Autocomplete                                                       */
	/* ------------------------------------------------------------------ */

	/* Mirror `ac_open` onto the native popover element, and detect whether the
	   browser flipped it above the field so the panel expands from the edge
	   nearest the control (matching Select's panel behaviour). */
	$effect(() => {
		const el = dropdown_element;
		if (!el) return;
		const shown = el.matches(':popover-open');
		if (ac_open && !shown) {
			try {
				el.showPopover();
				/* Measure synchronously — showPopover() has already placed the
				   popover (incl. any flip-block fallback), so the expand origin is
				   correct from the first frame. */
				if (wrapper_element) {
					const t = wrapper_element.getBoundingClientRect();
					const d = el.getBoundingClientRect();
					ac_above = d.top < t.top;
				}
			} catch {
				/* not connected yet */
			}
		} else if (!ac_open && shown) {
			try {
				el.hidePopover();
			} catch {
				/* already hidden */
			}
		}
	});

	function openAutocomplete() {
		if (!has_autocomplete || effectively_disabled || readonly) return;
		ac_open = true;
		// `ac_highlighted` is parked on the first selectable option by the effect
		// below, so pressing Enter selects the top match without arrowing first.
	}

	function closeAutocomplete() {
		ac_open = false;
		ac_highlighted = -1;
	}

	/* Keep the first selectable option highlighted whenever the panel opens or
	   the filtered list changes — one option is always active, so focusing the
	   field and pressing Enter selects the top match. */
	$effect(() => {
		const opts = ac_options;
		if (!ac_open) return;
		ac_highlighted = opts.findIndex((o) => !o.disabled);
	});

	/* The option rows are <button>s (ListItem), which would otherwise land in
	   the tab order — tabbing out of the field would dive into the panel and
	   lose focus when it closes. Pull them out so Tab moves to the next field;
	   they stay clickable (pointerdown is prevented, so a click never focuses
	   them). Re-runs when the rendered rows change. */
	$effect(() => {
		if (!dropdown_element || ac_options.length === 0) return;
		dropdown_element.querySelectorAll('button').forEach((btn) => {
			btn.tabIndex = -1;
		});
	});

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
		// Show the label in the input rather than the value — the value is
		// for the form payload, but the human-readable label is what the user
		// just clicked, so the displayed text should match.
		value = opt.label;
		closeAutocomplete();
		onchange?.({ value: opt.value });
	}

	function scrollAcHighlightedIntoView() {
		requestAnimationFrame(() => {
			if (!dropdown_element) return;
			const items = dropdown_element.querySelectorAll('.list-item');
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

		if (is_textarea && auto_resize) autoResizeTextarea();

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

	/**
	 * Mirror the component's file value back onto the native <input> via a
	 * DataTransfer, so dropped files and per-file removals still submit
	 * correctly when the input is inside a form.
	 */
	function syncFileInput(files: File[]) {
		if (!file_input_element || typeof DataTransfer === 'undefined') return;
		const dt = new DataTransfer();
		for (const f of files) dt.items.add(f);
		file_input_element.files = dt.files;
	}

	function commitFiles(next: File | File[] | null) {
		value = next;
		if (form_ctx && name) form_ctx.setValue(name, value);
		oninput?.({ value });
		onchange?.({ value });
	}

	function handleFileChange(e: Event) {
		const picked = (e.target as HTMLInputElement).files;
		if (!picked || picked.length === 0) return;
		if (multiple) {
			const merged = [...file_list, ...Array.from(picked)];
			syncFileInput(merged);
			commitFiles(merged);
		} else {
			commitFiles(picked[0]);
		}
	}

	function handleFileDrop(e: DragEvent) {
		e.preventDefault();
		if (effectively_disabled || readonly) return;
		const dropped = e.dataTransfer?.files;
		if (!dropped || dropped.length === 0) return;
		if (multiple) {
			const merged = [...file_list, ...Array.from(dropped)];
			syncFileInput(merged);
			commitFiles(merged);
		} else {
			syncFileInput([dropped[0]]);
			commitFiles(dropped[0]);
		}
	}

	function handleFileDragOver(e: DragEvent) {
		e.preventDefault();
	}

	/** Remove a single selected file by index. */
	function removeFile(index: number) {
		if (multiple) {
			const next = file_list.filter((_, i) => i !== index);
			syncFileInput(next);
			commitFiles(next);
		} else {
			if (file_input_element) file_input_element.value = '';
			commitFiles(null);
		}
	}

	/* ---- Chips / Multiple ---- */
	function handleChipKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			addChip();
		} else if (
			e.key === 'Backspace' &&
			chip_input_value === '' &&
			Array.isArray(value) &&
			value.length > 0
		) {
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

	/**
	 * Out transition for a chip. A plain `out:scale` keeps the leaving chip in
	 * the layout for the whole outro, so the surviving chips don't reflow into
	 * the gap until it finishes — `animate:flip` then measures no movement and
	 * they snap. Pinning the chip with `position: absolute` at its current spot
	 * pulls it out of flow immediately, so the others reflow now and flip slides
	 * them while this one scales + fades in place (same look as `out:scale`).
	 */
	function chipOut(node: HTMLElement, { duration = 150 } = {}) {
		const { offsetLeft, offsetTop, offsetWidth, offsetHeight } = node;
		node.style.position = 'absolute';
		node.style.left = `${offsetLeft}px`;
		node.style.top = `${offsetTop}px`;
		node.style.width = `${offsetWidth}px`;
		node.style.height = `${offsetHeight}px`;
		node.style.pointerEvents = 'none';
		return {
			duration,
			easing: quintOut,
			css: (t: number) => `opacity: ${t}; transform: scale(${0.6 + 0.4 * t});`,
		};
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
			case 'Tab': {
				/* Don't let the open panel capture Tab focus. Hide it
				   synchronously (so it leaves the top layer before the browser
				   resolves Tab navigation) and let the default Tab move focus on
				   to the next field — no preventDefault. */
				closeAutocomplete();
				try {
					dropdown_element?.hidePopover();
				} catch {
					/* already hidden */
				}
				break;
			}
		}
	}

	/* ---- File previews ---- */
	/** The selected files, normalised to an array regardless of `multiple`. */
	const file_list = $derived.by((): File[] => {
		if (!is_file) return [];
		if (Array.isArray(value)) return value.filter((f): f is File => f instanceof File);
		if (value instanceof File) return [value];
		return [];
	});

	/** Object-URL thumbnails for image files, revoked on change/unmount. */
	let file_previews = $state<{ name: string; url: string | null }[]>([]);
	$effect(() => {
		const created: string[] = [];
		file_previews = file_list.map((f) => {
			if (f.type.startsWith('image/')) {
				const url = URL.createObjectURL(f);
				created.push(url);
				return { name: f.name, url };
			}
			return { name: f.name, url: null };
		});
		return () => created.forEach((u) => URL.revokeObjectURL(u));
	});

	/** Whether the clear button should show */
	const show_clear = $derived.by(() => {
		if (!clearable || effectively_disabled || readonly) return false;
		if (multiple) return Array.isArray(value) && value.length > 0;
		/* File inputs carry their own per-file remove buttons. */
		if (is_file) return false;
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
		if (!show_counter || !maxlength) return 'normal';
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
	class={['input', `size-${size}`, class_name].filter(Boolean).join(' ')}
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
	class:has-icon={!!icon || is_search}
	class:is-textarea={is_textarea}
	class:is-file={is_file}
	class:is-color={is_color}
	class:multiple
	style:--input-font={size_config.font}
	style:--input-icon-size="{size_config.icon_size}px"
	{@attach tooltip_message ? tooltip(tooltip_message) : () => {}}>
	<!-- Main input wrapper -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="input-wrapper"
		class:focused
		class:has-error={has_error}
		bind:this={wrapper_element}
		style:anchor-name={has_autocomplete ? ac_anchor_name : undefined}
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

		<!-- Multiple chips -->
		{#if multiple && !is_file && Array.isArray(value)}
			<div class="chips-container">
				{#each value as chip, i (chip)}
					<span
						class="chip"
						in:scale={{ duration: 200, start: 0.6, easing: backOut }}
						out:chipOut={{ duration: 150 }}
						animate:flip={{ duration: 150, easing: quintOut }}>
						<span class="chip-text">{chip}</span>
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<span class="chip-remove" onclick={() => removeChip(i)}>
							<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
								<path
									d="M18 6L6 18M6 6l12 12"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									fill="none" />
							</svg>
						</span>
					</span>
				{/each}
				<input
					type="text"
					class="chip-input"
					bind:this={input_element}
					bind:value={chip_input_value}
					{id}
					placeholder={native_placeholder}
					disabled={effectively_disabled}
					{readonly}
					aria-label={label || placeholder || 'Add tag'}
					onfocus={handleFocus}
					onblur={handleBlur}
					onkeydown={handleChipKeyDown} />
			</div>
		{:else if is_textarea}
			<!-- Textarea -->
			<!-- svelte-ignore element_invalid_self_closing_tag -->
			<textarea
				bind:this={textarea_element}
				{id}
				{name}
				class="input-field"
				placeholder={native_placeholder}
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
				value={(value ?? '') as string} />
		{:else if is_file}
			<!-- File: hidden native input + visible preview list -->
			<input
				bind:this={file_input_element}
				type="file"
				{name}
				{accept}
				{multiple}
				disabled={effectively_disabled}
				class="file-native"
				aria-hidden="true"
				tabindex={-1}
				onchange={handleFileChange} />
			{#if file_list.length === 0}
				<button
					type="button"
					bind:this={input_element}
					{id}
					class="input-field file-trigger"
					disabled={effectively_disabled}
					aria-describedby={has_error
						? `${id}-error`
						: helper
							? `${id}-helper`
							: undefined}
					onfocus={handleFocus}
					onblur={handleBlur}
					onclick={handleFileClick}>
					<span class="file-placeholder">
						{native_placeholder ?? (multiple ? 'Choose files…' : 'Choose file…')}
					</span>
				</button>
			{:else}
				<div class="file-items">
					{#each file_previews as preview, i (preview.name + '-' + i)}
						<span class="file-item">
							<span class="file-thumb">
								{#if preview.url}
									<img src={preview.url} alt="" />
								{:else}
									<svg
										viewBox="0 0 24 24"
										width="100%"
										height="100%"
										fill="none"
										aria-hidden="true">
										<path
											d="M14 3v4a1 1 0 0 0 1 1h4"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round" />
										<path
											d="M5 3h9l5 5v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"
											stroke="currentColor"
											stroke-width="2"
											stroke-linejoin="round" />
									</svg>
								{/if}
							</span>
							<span class="file-item-name">{preview.name}</span>
							<Button
								icon
								dense
								transparent
								class="input-pill-btn"
								aria-label="Remove {preview.name}"
								disabled={effectively_disabled}
								onclick={() => removeFile(i)}>
								<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
									<path
										d="M18 6L6 18M6 6l12 12"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round" />
								</svg>
							</Button>
						</span>
					{/each}
					{#if multiple}
						<div class="file-add-row">
							<Button
								translucent
								dense
								full_width
								disabled={effectively_disabled}
								onclick={handleFileClick}>
								<svg
									viewBox="0 0 24 24"
									width="15"
									height="15"
									fill="none"
									aria-hidden="true">
									<path
										d="M12 5v14M5 12h14"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round" />
								</svg>
								Add files
							</Button>
						</div>
					{/if}
				</div>
			{/if}
		{:else if is_color}
			<!-- Colour: the swatch overlays the native picker; text shows the value -->
			<span class="color-control">
				<span
					class="color-swatch"
					style:background={typeof value === 'string' && value ? value : '#000000'}
					aria-hidden="true">
				</span>
				<input
					type="color"
					class="color-native"
					value={typeof value === 'string' && value ? value : '#000000'}
					disabled={effectively_disabled}
					aria-label={label || 'Choose colour'}
					oninput={(e) => {
						value = (e.target as HTMLInputElement).value;
						if (form_ctx && name) form_ctx.setValue(name, value);
						oninput?.({ value });
					}}
					onchange={(e) => {
						value = (e.target as HTMLInputElement).value;
						onchange?.({ value });
					}}
					onfocus={handleFocus}
					onblur={handleBlur} />
			</span>
			<input
				bind:this={input_element}
				{id}
				{name}
				type="text"
				class="input-field"
				placeholder={native_placeholder}
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
				placeholder={native_placeholder}
				disabled={effectively_disabled}
				{readonly}
				{required}
				{maxlength}
				{minlength}
				{pattern}
				{min}
				{max}
				step={is_number ? step : undefined}
				autocomplete={has_autocomplete ? 'off' : undefined}
				role={has_autocomplete ? 'combobox' : undefined}
				aria-expanded={has_autocomplete ? ac_open : undefined}
				aria-autocomplete={has_autocomplete ? 'list' : undefined}
				aria-controls={has_autocomplete ? `${id}-listbox` : undefined}
				aria-activedescendant={has_autocomplete && ac_highlighted >= 0
					? `${id}-option-${ac_highlighted}`
					: undefined}
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

		<!-- Floating label (notched-outline style) -->
		{#if label}
			<label class="input-label" class:floated={label_floated} for={id}>
				<span class="input-label-text">
					{label}{#if required}<span class="required-mark" aria-hidden="true">
							*
						</span>{/if}
				</span>
			</label>
		{/if}

		<!-- Suffix -->
		{#if suffix}
			<span class="input-suffix" aria-hidden="true">{suffix}</span>
		{/if}

		<!-- Number steppers -->
		{#if is_number}
			<div class="number-buttons">
				<Button
					icon
					transparent
					class="input-icon-btn"
					tabindex={-1}
					aria-label="Decrease"
					disabled={effectively_disabled ||
						(min !== undefined &&
							typeof min === 'number' &&
							typeof value === 'number' &&
							value <= min)}
					onclick={() => handleNumberIncrement(-1)}>
					<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path
							d="M5 12h14"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round" />
					</svg>
				</Button>
				<Button
					icon
					transparent
					class="input-icon-btn"
					tabindex={-1}
					aria-label="Increase"
					disabled={effectively_disabled ||
						(max !== undefined &&
							typeof max === 'number' &&
							typeof value === 'number' &&
							value >= max)}
					onclick={() => handleNumberIncrement(1)}>
					<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path
							d="M12 5v14M5 12h14"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round" />
					</svg>
				</Button>
			</div>
		{/if}

		<!-- Password toggle -->
		{#if is_password && show_toggle}
			<Button
				icon
				transparent
				class="input-icon-btn"
				tabindex={-1}
				aria-label={password_visible ? 'Hide password' : 'Show password'}
				onclick={handlePasswordToggle}>
				{#if password_visible}
					<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path
							d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round" />
						<line
							x1="1"
							y1="1"
							x2="23"
							y2="23"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round" />
					</svg>
				{:else}
					<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path
							d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round" />
						<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" />
					</svg>
				{/if}
			</Button>
		{/if}

		<!-- Search icon -->
		{#if is_search && !icon}
			<span class="input-icon search-icon" aria-hidden="true">
				<svg viewBox="0 0 24 24" width="16" height="16" fill="none">
					<circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2" />
					<path
						d="M21 21l-4.35-4.35"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round" />
				</svg>
			</span>
		{/if}

		<!-- Clear button -->
		{#if show_clear}
			<Button
				icon
				dense
				transparent
				class="input-icon-btn input-clear-btn"
				tabindex={-1}
				aria-label="Clear"
				onclick={handleClear}>
				<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
					<path
						d="M18 6L6 18M6 6l12 12"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round" />
				</svg>
			</Button>
		{/if}
	</div>

	<!-- Password strength indicator -->
	{#if is_password && strength_indicator && typeof value === 'string' && value.length > 0}
		<div class="strength-meter" aria-label="Password strength: {strength_label}">
			<div class="strength-track">
				{#each [1, 2, 3, 4] as segment}
					<div
						class="strength-segment"
						class:active={password_strength >= segment}
						style:background={password_strength >= segment ? strength_color : undefined}>
					</div>
				{/each}
			</div>
			<span class="strength-label" style:color={strength_color}>{strength_label}</span>
		</div>
	{/if}

	<!-- Footer row: error, helper, counter -->
	{#if has_error || helper || (show_counter && maxlength)}
		<div class="input-footer">
			{#if has_error && error_message}
				<span class="input-error" id="{id}-error" role="alert">{error_message}</span>
			{:else if helper}
				<span class="input-helper" id="{id}-helper">{helper}</span>
			{:else}
				<span></span>
			{/if}

			{#if show_counter && maxlength}
				<span
					class="input-counter"
					class:counter-warning={counter_state === 'warning'}
					class:counter-error={counter_state === 'error'}>
					{value_length}/{maxlength}
				</span>
			{/if}
		</div>
	{/if}

	<!-- Autocomplete dropdown — native popover, CSS anchor positioned (matches Select) -->
	{#if has_autocomplete}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="ac-dropdown"
			class:above={ac_above}
			popover="manual"
			bind:this={dropdown_element}
			role="listbox"
			id="{id}-listbox"
			style:position-anchor={ac_anchor_name}
			onpointerdown={(e) => e.preventDefault()}>
			{#if ac_loading}
				<div class="ac-status">
					<span class="ac-spinner" aria-hidden="true"></span>
					Loading...
				</div>
			{:else if ac_options.length === 0}
				<div class="ac-status">No results</div>
			{:else}
				<List dense>
					{#each ac_options as opt, i (opt.value)}
						<ListItem
							id="{id}-option-{i}"
							active={ac_highlighted === i}
							disabled={opt.disabled}
							onclick={() => selectAutocompleteOption(opt)}>
							{#if option_snippet}
								{@render option_snippet(opt)}
							{:else}
								<span class="ac-option">
									<span class="ac-option-label">{@html highlightMatch(opt.label)}</span>
									{#if opt.description}
										<span class="ac-option-desc">{opt.description}</span>
									{/if}
								</span>
							{/if}
						</ListItem>
					{/each}
				</List>
			{/if}
		</div>
	{/if}
</div>

<!-- Hidden native input for form submission (non-textarea, non-file types) -->
{#if name && !is_textarea && !is_file && !multiple}
	<input type="hidden" {name} value={value ?? ''} />
{/if}
{#if name && multiple && !is_file && Array.isArray(value)}
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

	.input {
		--_font: var(--input-font, var(--control-font-1, 1rem));
		--_icon-size: var(--input-icon-size, 17px);
		/* Height scales off --_font, so the whole control scales from one
		   number. The ratio is the SHARED --control-height-ratio (tokens.css),
		   so a row of controls — Input, Select, Button — lands on the same
		   height. --_font is a length the floated-label maths can divide by. */
		--_height: calc(var(--_font) * var(--control-height-ratio, 3));
		--_radius: var(--radius-lg, 10px);
		--_border: var(--color-border, light-dark(hsl(0 0% 78%), hsl(0 0% 32%)));
		--_border-hover: var(--color-border-active, light-dark(hsl(0 0% 60%), hsl(0 0% 48%)));
		--_border-focus: var(--color-action, hsl(217 75% 52%));
		--_border-error: var(--color-error, light-dark(#ef6262, #b04343));
		--_bg: var(--color-surface, light-dark(#fff, hsl(0 0% 9%)));
		--_panel: var(--color-surface, light-dark(#fff, hsl(0 0% 13%)));
		--_panel-hover: var(--color-bg-active, light-dark(hsl(0 0% 95%), hsl(0 0% 18%)));
		--_text: var(--color-text, inherit);
		--_text-muted: var(--color-text-muted, light-dark(hsl(0 0% 46%), hsl(0 0% 62%)));
		--_chip-bg: var(--color-action, hsl(217 75% 52%));
		--_chip-bg-hover: var(--color-action-active, hsl(217 80% 46%));
		--_chip-text: var(--color-action-text, #fff);
		--_duration: 150ms;
		--_ease: var(--ease-in-out, cubic-bezier(0.76, 0, 0.24, 1));
		/* The legacy label glide easing */
		--_ease-label: cubic-bezier(0, 0.54, 0.47, 1);
		/* Snappy ease-out for the panel's expand-in animation (matches Select) */
		--_ease-expand: cubic-bezier(0.16, 1, 0.3, 1);

		position: relative;
		width: 100%;
		font-size: var(--_font);
		text-align: left;
	}

	.input.disabled {
		opacity: 0.55;
		pointer-events: none;
	}

	/* Density modifiers swap the shared height ratio (see tokens.css), so a
	   dense Input/Select/Button row also lands on a single height. */
	.input.dense {
		--_height: calc(var(--_font) * var(--control-height-ratio-dense, 2.5));
	}
	.input.comfortable {
		--_height: calc(var(--_font) * var(--control-height-ratio-comfortable, 3.5));
	}

	/* ================================================================== */
	/*  SKELETON / LOADING                                                 */
	/* ================================================================== */

	/*
	 * The skeleton/loading state renders the real field (label and placeholder
	 * are known up front) so there's no layout shift when it resolves. It is
	 * disabled via `effectively_disabled`; a soft sweeping shimmer signals that
	 * the page isn't ready yet.
	 */
	.input.skeleton .input-wrapper::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: linear-gradient(
			100deg,
			transparent 30%,
			color-mix(in oklch, var(--_text, currentColor) 9%, transparent) 50%,
			transparent 70%
		);
		background-size: 220% 100%;
		background-position: 180% 0;
		animation: input-skeleton-sweep 1.5s ease-in-out infinite;
		pointer-events: none;
	}

	@keyframes input-skeleton-sweep {
		to {
			background-position: -180% 0;
		}
	}

	/* ================================================================== */
	/*  WRAPPER                                                            */
	/* ================================================================== */

	.input-wrapper {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.5em;
		min-height: var(--_height);
		/* No top margin: the bordered box IS the control's layout height, so a
		   row of Input/Select/Button top-aligns. The floating label is
		   absolutely positioned and straddles the top border out of flow — it
		   overflows ~0.4em above the box without adding to the layout height. */
		padding: 0 var(--control-pad-x, 1em);
		border-radius: var(--_radius);
		background: var(--_bg);
		cursor: text;
	}

	.input.dense .input-wrapper {
		padding: 0 var(--control-pad-x-dense, 0.75em);
	}
	.input.comfortable .input-wrapper {
		padding: 0 var(--control-pad-x-comfortable, 1.25em);
	}

	/* The outline is painted by a pseudo-element so the 1px -> 2px focus
	   transition never nudges the field's contents. */
	.input-wrapper::before {
		content: '';
		position: absolute;
		inset: 0;
		border: 1px solid var(--_border);
		border-radius: inherit;
		pointer-events: none;
		transition:
			border-color var(--_duration) var(--_ease),
			border-width var(--_duration) var(--_ease);
	}

	/* With a label present, the label itself paints the top edge (the notch) */
	.input.has-label .input-wrapper::before {
		border-top-color: transparent;
	}

	.input-wrapper:hover::before {
		border-color: var(--_border-hover);
		/* Snap the border color in on hover; the base rule eases it back out on leave. */
		transition: border-width var(--_duration) var(--_ease);
	}
	.input.has-label .input-wrapper:hover::before {
		border-top-color: transparent;
	}

	.input-wrapper.focused::before {
		border-color: var(--_border-focus);
		border-width: 2px;
	}
	.input.has-label .input-wrapper.focused::before {
		border-top-color: transparent;
	}

	.input-wrapper.has-error::before {
		border-color: var(--_border-error);
	}
	.input.has-label .input-wrapper.has-error::before {
		border-top-color: transparent;
	}

	.input.is-textarea .input-wrapper {
		align-items: stretch;
		min-height: auto;
	}

	/* ================================================================== */
	/*  INPUT FIELD                                                        */
	/* ================================================================== */

	.input-field {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		/* The wrapper outline is the focus indicator — neutralise any focus
		   ring a host app applies to bare controls (e.g. a global
		   `*:focus-visible { box-shadow }` rule). */
		box-shadow: none;
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
		opacity: 0.85;
	}

	/* Textarea specifics */
	textarea.input-field {
		height: auto;
		min-height: var(--_height);
		line-height: 1.5;
		resize: vertical;
		padding: 0.9em 0;
	}

	/* Number: hide native spinner */
	input[type='number'].input-field {
		appearance: textfield;
		-moz-appearance: textfield;
	}
	input[type='number'].input-field::-webkit-outer-spin-button,
	input[type='number'].input-field::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}

	/* Search: hide native clear */
	input[type='search'].input-field::-webkit-search-cancel-button {
		-webkit-appearance: none;
	}

	/* ================================================================== */
	/*  FLOATING LABEL  (notched outline, legacy-style)                    */
	/* ================================================================== */

	/*
	 * The label spans the full width of the wrapper and paints the top edge
	 * of the outline itself. At rest it is a single continuous border with the
	 * label text centred inside (acting as the placeholder). When floated, the
	 * label's own border disappears and two short "shoulder" segments
	 * (::before / ::after) light up instead, leaving a gap — the notch —
	 * exactly the width of the shrunken label text.
	 */
	.input-label {
		position: absolute;
		inset: 0 0 auto 0;
		display: flex;
		align-items: center;
		/* Fixed to the field's base height so the notch stays pinned to the
		   top edge even when the wrapper grows (wrapping chips, textarea). */
		height: var(--_height);
		margin: 0;
		padding: 0;
		box-sizing: border-box;
		border-top: 1px solid var(--_border);
		border-radius: var(--_radius);
		color: var(--_text-muted);
		pointer-events: none;
		transition:
			border-color var(--_duration) var(--_ease),
			color var(--_duration) var(--_ease);
	}

	/* Notch shoulders — short border runs either side of the label text,
	   pinned to the top edge regardless of where the label text sits. */
	.input-label::before,
	.input-label::after {
		content: '';
		display: block;
		box-sizing: border-box;
		flex: 0 0 auto;
		align-self: flex-start;
		width: 0;
		min-width: 1em;
		height: var(--_radius);
		border-top: 1px solid transparent;
		transition:
			border-color var(--_duration) var(--_ease),
			min-width 200ms var(--_ease-label);
	}
	.input-label::before {
		/* End the left border run 0.3em before the text so the notch has a small
		   gap on the left, matching the 0.3em the ::after leaves on the right.
		   The text's own margin-left keeps it aligned with the field contents. */
		min-width: 0.7em;
		border-top-left-radius: var(--_radius);
	}
	.input-label::after {
		flex: 1 1 auto;
		min-width: 0.5em;
		margin-left: 0.3em;
		border-top-right-radius: var(--_radius);
	}

	/* While resting, a leading icon widens the left shoulder so the label text
	   (acting as the placeholder) clears the icon. Once floated, the shoulder
	   returns to its base width so the notch always sits in the top-left
	   corner — even with an icon or prefix. */
	.input.has-icon .input-label:not(.floated)::before {
		min-width: calc(1em + var(--_icon-size) + 0.5em);
	}

	.input-label-text {
		display: flex;
		align-items: center;
		max-width: 100%;
		padding: 0;
		/* Small gap from the left notch shoulder (mirrors the ::after gap on the
		   right); the shoulder is shortened by the same amount so the text stays
		   aligned with the field contents. */
		margin-left: 0.3em;
		font-size: var(--_font);
		/* Roomier than 1 so the line box contains descenders (g, y, p): with
		   line-height 1 the box is exactly the font size and overflow:hidden
		   clips them. Half-leading is symmetric, so the glyph stays centred on
		   the border when floated — nothing shifts. */
		line-height: 1.4;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition:
			font-size 200ms var(--_ease-label),
			transform 200ms var(--_ease-label),
			padding 200ms var(--_ease-label);
	}

	/* --- Floated state ------------------------------------------------- */
	.input-label.floated {
		border-top-color: transparent;
	}
	.input-label.floated::before,
	.input-label.floated::after {
		border-top-color: var(--_border);
	}
	/* Glide from the vertically-centred resting spot up onto the top edge.
	   --_height is a plain length, so half of it lands the text exactly on
	   the outline — and transform + font-size both animate smoothly. */
	.input-label.floated .input-label-text {
		font-size: calc(var(--_font) * 0.8);
		transform: translateY(calc(var(--_height) / -2));
	}

	/* --- Textarea: rest the label at the top, straddle the edge on float - */
	.input.is-textarea .input-label {
		align-items: flex-start;
	}
	.input.is-textarea .input-label-text {
		padding-top: 0.9em;
	}
	.input.is-textarea .input-label.floated .input-label-text {
		padding-top: 0;
		transform: translateY(-50%);
	}

	/* --- Hover ---------------------------------------------------------- */
	.input-wrapper:hover .input-label {
		border-top-color: var(--_border-hover);
		/* Snap the notch color in on hover; the base rule eases it back out on leave. */
		transition: color var(--_duration) var(--_ease);
	}
	.input-wrapper:hover .input-label.floated {
		border-top-color: transparent;
	}
	.input-wrapper:hover .input-label.floated::before,
	.input-wrapper:hover .input-label.floated::after {
		border-top-color: var(--_border-hover);
		/* Snap the notch shoulders in on hover; the base rule eases them back out. */
		transition: min-width 200ms var(--_ease-label);
	}

	/* --- Focused -------------------------------------------------------- */
	/* The label's own border-top stays 1px on focus. A focused label is always
	   floated (its own border is then transparent), so thickening it here was
	   invisible yet still grew the label's content box — nudging the notch
	   shoulders and centred text down ~1px. The focus emphasis comes from the
	   notch shoulders (::before/::after) below, which thicken without moving. */
	.input-wrapper.focused .input-label {
		border-top-color: var(--_border-focus);
		color: var(--_border-focus);
	}
	.input-wrapper.focused .input-label.floated {
		border-top-color: transparent;
	}
	.input-wrapper.focused .input-label::before,
	.input-wrapper.focused .input-label::after {
		border-top-width: 2px;
	}
	.input-wrapper.focused .input-label.floated::before,
	.input-wrapper.focused .input-label.floated::after {
		border-top-color: var(--_border-focus);
	}

	/* --- Error ---------------------------------------------------------- */
	.input-wrapper.has-error .input-label {
		border-top-color: var(--_border-error);
		color: var(--_border-error);
	}
	.input-wrapper.has-error .input-label.floated {
		border-top-color: transparent;
	}
	.input-wrapper.has-error .input-label.floated::before,
	.input-wrapper.has-error .input-label.floated::after {
		border-top-color: var(--_border-error);
	}

	.required-mark {
		color: var(--_border-error);
		margin-left: 0.1em;
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
		transition: color var(--_duration) var(--_ease);
	}

	.input-wrapper.focused .input-icon {
		color: var(--_border-focus);
	}
	.input-wrapper.has-error .input-icon {
		color: var(--_border-error);
	}

	.search-icon {
		order: -1;
	}

	.input-prefix,
	.input-suffix {
		flex-shrink: 0;
		color: var(--_text-muted);
		font-size: 0.92em;
		user-select: none;
		white-space: nowrap;
	}

	.input-suffix {
		order: 1;
	}

	/* ================================================================== */
	/*  IN-FIELD BUTTONS  (@delightstack Button, scaled to fit)            */
	/* ================================================================== */

	/*
	 * The clear, password-toggle, stepper and remove controls are all
	 * <Button> instances. Button's icon mode is sized in `em` (4em square),
	 * so a font-size keyed off --_font scales them to fit the field without
	 * reaching into Button's internals.
	 */
	.input :global(.button.input-icon-btn) {
		font-size: calc(var(--_font) * 0.5);
		flex-shrink: 0;
		/* Pin to the legacy 4em square (relative to the reduced font above) so
		   the in-field buttons stay sized to the field, independent of the
		   control-height-based default for standalone icon buttons. */
		width: 4em;
		height: 4em;
	}
	.input :global(.button.input-pill-btn) {
		font-size: calc(var(--_font) * 0.35);
		flex-shrink: 0;
		width: 4em;
		height: 4em;
	}

	/* The clear button fades in on hover/focus of the field. */
	.input :global(.button.input-clear-btn) {
		opacity: 0;
		transition: opacity var(--_duration) var(--_ease);
	}
	.input-wrapper:hover :global(.button.input-clear-btn),
	.input-wrapper.focused :global(.button.input-clear-btn) {
		opacity: 1;
	}

	/* ================================================================== */
	/*  NUMBER STEPPERS                                                    */
	/* ================================================================== */

	/* The stepper pair sits after the suffix. */
	.number-buttons {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.1em;
		flex-shrink: 0;
		order: 2;
		margin-right: -0.35em;
	}

	/* A thin divider sets the steppers off from the suffix — only needed when
	   a suffix is present; without one the field reads cleaner divider-free. */
	.input.has-suffix .number-buttons::before {
		content: '';
		align-self: center;
		width: 1px;
		height: 1.5em;
		margin-right: 0.35em;
		background: var(--_border);
	}

	/* ================================================================== */
	/*  COLOR INPUT                                                        */
	/* ================================================================== */

	.color-control {
		position: relative;
		display: inline-flex;
		flex-shrink: 0;
		width: 1.6em;
		height: 1.6em;
	}

	.color-swatch {
		width: 100%;
		height: 100%;
		border-radius: var(--radius-md, 5px);
		border: 1px solid var(--_border);
		pointer-events: none;
	}

	/* The real <input type=color> sits invisibly over the swatch, so a click
	   anywhere on it opens the native picker anchored at the swatch. */
	.color-native {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		padding: 0;
		border: none;
		opacity: 0;
		cursor: pointer;
	}
	.color-native:disabled {
		cursor: not-allowed;
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

	.file-trigger {
		cursor: pointer;
		text-align: left;
	}

	.file-placeholder {
		color: var(--_text-muted);
		opacity: 0.85;
	}

	.file-items {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4em;
		flex: 1;
		min-width: 0;
		padding: 0.4em 0;
	}
	.input.has-label .file-items {
		padding-top: 0.6em;
	}

	.file-item {
		display: inline-flex;
		align-items: center;
		gap: 0.5em;
		max-width: 100%;
		padding: 0.25em 0.3em;
		border-radius: var(--radius-md, 6px);
		background: var(--_panel-hover);
	}

	.file-thumb {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2em;
		height: 2em;
		flex-shrink: 0;
		overflow: hidden;
		border-radius: var(--radius-sm, 4px);
		background: var(--_bg);
		color: var(--_text-muted);
	}
	.file-thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.file-thumb svg {
		width: 62%;
		height: 62%;
	}

	.file-item-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.92em;
	}

	/* The "Add files" Button takes a full-width row of its own. */
	.file-add-row {
		flex-basis: 100%;
		width: 100%;
		margin-top: 0.1em;
	}

	/* ================================================================== */
	/*  CHIPS (Multiple mode)                                              */
	/* ================================================================== */

	.chips-container {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4em;
		flex: 1;
		min-width: 0;
		padding: 0.45em 0;
	}

	/* Keep chips clear of the floated label straddling the top edge */
	.input.has-label .chips-container {
		padding-top: 0.7em;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35em;
		padding: 0.2em 0.3em 0.2em 0.7em;
		border-radius: var(--radius-full, 999px);
		background: var(--_chip-bg);
		color: var(--_chip-text);
		font-size: 0.85em;
		max-width: 100%;
		line-height: 1.4;
		transition:
			background var(--_duration) var(--_ease),
			scale 150ms var(--_ease);
	}

	.chip:active {
		scale: 0.96;
	}

	.chip-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chip-remove {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.3em;
		height: 1.3em;
		padding: 0;
		border: none;
		border-radius: var(--radius-full, 999px);
		background: none;
		color: inherit;
		cursor: pointer;
		opacity: 0.75;
		flex-shrink: 0;
		transition:
			opacity var(--_duration) var(--_ease),
			background var(--_duration) var(--_ease);
	}

	/* Invisible hit area extending ~10px past the icon on every side so the
	   button is easy to tap. The visible hover feedback stays the size of the
	   element itself (above), not the touch target. */
	.chip-remove::before {
		content: '';
		position: absolute;
		inset: -10px;
	}

	.chip-remove:hover {
		opacity: 1;
		background: color-mix(in oklch, currentColor 22%, transparent);
		/* Snap the tint in on hover; keep the opacity reveal eased both ways. */
		transition: opacity var(--_duration) var(--_ease);
	}

	.chip-remove svg {
		width: 0.85em;
		height: 0.85em;
	}

	.chip-input {
		flex: 1;
		min-width: 5em;
		border: none;
		outline: none;
		box-shadow: none;
		background: transparent;
		font: inherit;
		font-size: var(--_font);
		color: var(--_text);
		padding: 0;
		height: 1.9em;
	}

	.chip-input::placeholder {
		color: var(--_text-muted);
		opacity: 0.85;
	}

	/* ================================================================== */
	/*  PASSWORD STRENGTH                                                  */
	/* ================================================================== */

	.strength-meter {
		display: flex;
		align-items: center;
		gap: 0.5em;
		margin-top: 0.4em;
		padding: 0 0.4em;
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
		gap: 0.5em;
		margin-top: 0.35em;
		padding: 0 0.5em;
		min-height: 1.2em;
	}

	.input-error {
		font-size: 0.78em;
		color: var(--_border-error);
		animation: input-error-in 200ms var(--_ease);
	}

	@keyframes input-error-in {
		from {
			opacity: 0;
			transform: translateY(-3px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.input-helper {
		font-size: 0.78em;
		color: var(--_text-muted);
	}

	.input-counter {
		font-size: 0.74em;
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
	/*  AUTOCOMPLETE DROPDOWN  (native popover, CSS anchor positioned)     */
	/* ================================================================== */

	/*
	 * The panel is a native `popover` element placed with CSS anchor
	 * positioning relative to the field — it renders in the top layer (no
	 * clipping, no z-index juggling, no Portal) and matches the Select
	 * component's panel: same width as the field, the same expand-from-the-edge
	 * animation, and the same flip-when-no-room-below behaviour. The rows
	 * themselves are List/ListItem.
	 */
	.ac-dropdown {
		position: fixed;
		top: anchor(bottom);
		bottom: auto;
		left: anchor(left);
		right: auto;
		width: anchor-size(width);
		margin: 0.4em 0 0 0;
		/* Slim padding — the List/ListItem rows carry their own insets, so the
		   panel only needs a hairline gutter around them. */
		padding: 0.25em;
		box-sizing: border-box;
		max-height: 18em;
		overflow-y: auto;
		border: none;
		background: var(--_panel);
		color: var(--_text);
		border-radius: var(--radius-xl, 16px);
		box-shadow: var(--shadow-md, 0 8px 28px -8px rgb(0 0 0 / 0.3));
		scrollbar-width: thin;
		/* Flip above the field when there is no room below */
		position-try-fallbacks: flip-block;
		/* Expand-in from the edge closest to the field — origin flips to
		   `bottom` when the panel is placed above the control (`.above`). */
		transform-origin: center top;
		opacity: 1;
		transform: scaleY(1);
		transition:
			opacity 200ms var(--_ease-expand),
			transform 200ms var(--_ease-expand),
			display 200ms allow-discrete,
			overlay 200ms allow-discrete;
	}
	.ac-dropdown.above {
		transform-origin: center bottom;
	}
	/* Collapsed state — drives both the open (@starting-style) and close
	   transitions, so the panel expands/collapses toward the field. */
	.ac-dropdown:not(:popover-open) {
		opacity: 0;
		transform: scaleY(0.6);
	}
	@starting-style {
		.ac-dropdown:popover-open {
			opacity: 0;
			transform: scaleY(0.6);
		}
	}

	/* Option content rendered inside each ListItem. ListItem renders a native
	   <button>, whose UA `text-align: center` would otherwise centre the label
	   once `.ac-option` fills the row — pin it back to the start. */
	.ac-option {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
		text-align: left;
	}
	.ac-option-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* Emphasise the matched substring (from highlightMatch) */
	.ac-option-label :global(strong) {
		color: var(--_border-focus);
		font-weight: 700;
	}
	.ac-option-desc {
		font-size: 0.8em;
		color: var(--_text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Loading / empty status row */
	.ac-status {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5em;
		padding: 0.85em;
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
		animation: input-spin 0.6s linear infinite;
		flex-shrink: 0;
	}

	@keyframes input-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ================================================================== */
	/*  SIZE                                                               */
	/* ================================================================== */

	/*
	 * Sizes 0–3 only set --input-font (inline, from size_config). Because the
	 * field height, padding, icon gap and label are all em-based, the whole
	 * component scales from that single font-size — no per-size overrides
	 * needed.
	 */

	/* ================================================================== */
	/*  READONLY                                                           */
	/* ================================================================== */

	.input.readonly .input-wrapper {
		background: var(--color-bg-disabled, light-dark(hsl(0 0% 96%), hsl(0 0% 13%)));
		cursor: default;
	}
</style>
