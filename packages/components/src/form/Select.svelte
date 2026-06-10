<script lang="ts" module>
	export interface SelectOption {
		value: unknown;
		label: string;
		disabled?: boolean;
		description?: string;
		group?: string;
	}
</script>

<script lang="ts">
	import { tooltip, ripple } from '@delightstack/utilities';
	import { type Snippet } from 'svelte';
	import { scale } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { backOut, quintOut } from 'svelte/easing';

	const propId = $props.id();
	let {
		/** The current value (single) or values (multi) */
		value = $bindable() as unknown,

		/** The list of options to choose from */
		options = [] as SelectOption[],

		/** Whether multiple values can be selected */
		multiple = false,

		/** Whether the dropdown includes a search input */
		searchable = false,

		/** Whether the value can be cleared */
		clearable = false,

		/** Whether the user can create new options from the search query */
		creatable = false,

		/** Whether the component is in a loading state */
		loading = false,

		/** Whether the component is disabled */
		disabled = false,

		/**
		 * Placeholder text shown in the trigger when there is no value. Only
		 * visible when the label has floated to the top, or there is no label
		 * (when a label is present and no distinct placeholder is set, the
		 * label itself acts as the placeholder, legacy-style).
		 */
		placeholder = undefined as string | undefined,

		/** The label text above the trigger */
		label = undefined as string | undefined,

		/** An error message shown below the trigger */
		error = undefined as string | undefined,

		/** Whether the field is required */
		required = false,

		/** Size preset */
		size = '1' as '0' | '1' | '2' | '3',

		/** Whether to show a skeleton loading state */
		skeleton = false,

		/** Tooltip message shown on hover */
		tooltip: tooltip_message = undefined as string | undefined,

		/** Whether the component uses dense spacing */
		dense = false,

		/** Whether the component uses comfortable spacing */
		comfortable = false,

		/** The id of the select element */
		id = propId,

		/** The name attribute for hidden form input(s) */
		name = undefined as string | undefined,

		/** Custom class name */
		class: class_name = '',

		/** Called when the value changes */
		onchange = undefined as ((detail: { value: unknown }) => void) | undefined,

		/** Called when the search query changes (debounced 300ms) */
		onsearch = undefined as ((detail: { query: string }) => void) | undefined,

		/**
		 * Called when the user tries to create a new option. Return `false` to
		 * reject it; return the created `SelectOption` to have the Select select
		 * it immediately (otherwise the search text is selected as the value).
		 */
		oncreate = undefined as
			| ((detail: { value: string }) => boolean | void | SelectOption)
			| undefined,

		/** Called when the dropdown opens */
		onopen = undefined as (() => void) | undefined,

		/** Called when the dropdown closes */
		onclose = undefined as (() => void) | undefined,

		/** Custom snippet for rendering the selected value in the trigger */
		render_value = undefined as Snippet<[SelectOption | SelectOption[]]> | undefined,

		/** Custom snippet for rendering an option in the dropdown */
		option: optionSnippet = undefined as Snippet<[SelectOption]> | undefined,
	} = $props();

	let open = $state(false);
	let focused = $state(false);
	let searchQuery = $state('');
	let highlightedIndex = $state(-1);
	let selectElement = $state<HTMLElement | undefined>(undefined);
	let triggerElement = $state<HTMLElement | undefined>(undefined);
	let searchInputElement = $state<HTMLInputElement | undefined>(undefined);
	let dropdownElement = $state<HTMLElement | undefined>(undefined);
	let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
	let typeAheadBuffer = $state('');
	let typeAheadTimer: ReturnType<typeof setTimeout> | undefined;

	// Whether the dropdown was flipped above the trigger, so it can expand
	// from the edge nearest the control.
	let dropdownAbove = $state(false);

	/* Per-size font from the shared --control-font-* tokens so Select lines up
	   at the same height as Input and Button for a given size. */
	const sizeMap: Record<string, string> = {
		'0': 'var(--control-font-0, 0.875rem)',
		'1': 'var(--control-font-1, 1rem)',
		'2': 'var(--control-font-2, 1.125rem)',
		'3': 'var(--control-font-3, 1.25rem)',
	};

	/** The currently selected option(s) based on value */
	const selectedOptions = $derived.by(() => {
		if (multiple) {
			const values = Array.isArray(value) ? value : [];
			return options.filter((opt) => values.includes(opt.value));
		}
		return options.find((opt) => opt.value === value) ?? null;
	});

	/** Filtered options based on search query */
	const filteredOptions = $derived.by(() => {
		if (!searchable || !searchQuery.trim()) return options;
		const q = searchQuery.toLowerCase().trim();
		return options.filter((opt) => opt.label.toLowerCase().includes(q));
	});

	/** Group the filtered options by their group property */
	const groupedOptions = $derived.by(() => {
		const groups = new Map<string, SelectOption[]>();
		const ungrouped: SelectOption[] = [];

		for (const opt of filteredOptions) {
			if (opt.group) {
				const list = groups.get(opt.group);
				if (list) {
					list.push(opt);
				} else {
					groups.set(opt.group, [opt]);
				}
			} else {
				ungrouped.push(opt);
			}
		}

		return { groups, ungrouped };
	});

	/** Flat list of selectable (non-disabled) option indices for keyboard navigation */
	const flatSelectableOptions = $derived.by(() => {
		const result: SelectOption[] = [];
		// Add ungrouped first, then grouped (in order)
		for (const opt of groupedOptions.ungrouped) {
			result.push(opt);
		}
		for (const [, opts] of groupedOptions.groups) {
			for (const opt of opts) {
				result.push(opt);
			}
		}
		return result;
	});

	/** Whether to show "Create" option */
	const showCreateOption = $derived(
		creatable && searchQuery.trim() && filteredOptions.length === 0,
	);

	/** Whether no results exist */
	const showEmpty = $derived(
		filteredOptions.length === 0 && !showCreateOption && !loading,
	);

	/** Whether an option value is selected */
	function isSelected(optValue: unknown): boolean {
		if (multiple) {
			return Array.isArray(value) && value.includes(optValue);
		}
		return value === optValue;
	}

	/** Select or toggle an option */
	function selectOption(opt: SelectOption) {
		if (opt.disabled) return;

		if (multiple) {
			const current = Array.isArray(value) ? [...value] : [];
			const idx = current.indexOf(opt.value);
			if (idx >= 0) {
				current.splice(idx, 1);
			} else {
				current.push(opt.value);
			}
			value = current;
		} else {
			value = opt.value;
			closeDropdown();
		}
		onchange?.({ value });
	}

	/** Remove a value from multi-select */
	function removeValue(optValue: unknown, e: Event) {
		e.stopPropagation();
		if (disabled) return;
		if (!multiple || !Array.isArray(value)) return;
		value = value.filter((v: unknown) => v !== optValue);
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

	/** Clear the value entirely */
	function clearValue(e: Event) {
		e.stopPropagation();
		if (disabled) return;
		value = multiple ? [] : undefined;
		onchange?.({ value });
	}

	/** Open the dropdown */
	function openDropdown() {
		if (disabled || open) return;
		open = true;
		highlightedIndex = -1;
		searchQuery = '';
	}

	/** Close the dropdown */
	function closeDropdown() {
		if (!open) return;
		open = false;
	}

	/** Toggle the dropdown */
	function toggleDropdown() {
		if (open) {
			closeDropdown();
		} else {
			openDropdown();
		}
	}

	/** Handle search input changes */
	function onSearchInput(e: Event) {
		const target = e.target as HTMLInputElement;
		searchQuery = target.value;
		highlightedIndex = -1;

		if (onsearch) {
			clearTimeout(searchDebounceTimer);
			searchDebounceTimer = setTimeout(() => {
				onsearch?.({ query: searchQuery });
			}, 300);
		}
	}

	/** Select a value directly (single) or add it to the selection (multi). */
	function selectByValue(optValue: unknown) {
		if (multiple) {
			const current = Array.isArray(value) ? [...value] : [];
			if (!current.includes(optValue)) current.push(optValue);
			value = current;
		} else {
			value = optValue;
		}
		onchange?.({ value });
	}

	/** Handle creating a new option */
	function handleCreate() {
		const trimmed = searchQuery.trim();
		if (!trimmed) return;
		const result = oncreate?.({ value: trimmed });
		if (result === false) return;
		// Select the freshly created option so the user doesn't have to reopen
		// the dropdown. `oncreate` may hand back the created option (with its
		// real value); otherwise fall back to selecting the search text.
		const createdValue =
			result && typeof result === 'object' && 'value' in result
				? (result as SelectOption).value
				: trimmed;
		selectByValue(createdValue);
		searchQuery = '';
		if (!multiple) closeDropdown();
	}

	/** Scroll the highlighted option into view */
	function scrollHighlightedIntoView() {
		requestAnimationFrame(() => {
			if (!dropdownElement) return;
			const items = dropdownElement.querySelectorAll('[role="option"]');
			const item = items[highlightedIndex];
			if (item) {
				item.scrollIntoView({ block: 'nearest', inline: 'nearest' });
			}
		});
	}

	/** Get the next non-disabled index in a given direction */
	function getNextIndex(current: number, direction: 1 | -1): number {
		const total = flatSelectableOptions.length;
		if (total === 0) return -1;

		let next = current;
		for (let i = 0; i < total; i++) {
			next = (((next + direction) % total) + total) % total;
			if (!flatSelectableOptions[next].disabled) return next;
		}
		return -1;
	}

	/**
	 * Whether the closed trigger should cycle the value directly on arrow keys
	 * (native `<select>` feel). Only single, non-searchable selects — multi and
	 * searchable selects open the panel instead, where direct cycling makes no
	 * sense.
	 */
	const arrowCyclesValue = $derived(!multiple && !searchable);

	/**
	 * Move the single value to the next/prev selectable option without opening
	 * the panel. Clamps at the ends (no wrap), matching native selects. With no
	 * current value, the first arrow lands on the first/last option.
	 */
	function cycleValue(direction: 1 | -1) {
		const opts = flatSelectableOptions;
		if (opts.length === 0) return;
		const currentIdx = opts.findIndex((o) => o.value === value);
		let nextIdx: number;
		if (currentIdx === -1) {
			nextIdx = direction === 1 ? 0 : opts.length - 1;
		} else {
			nextIdx = currentIdx + direction;
			if (nextIdx < 0 || nextIdx >= opts.length) return;
		}
		value = opts[nextIdx].value;
		onchange?.({ value });
	}

	/** Handle keyboard navigation on the trigger */
	function onTriggerKeyDown(e: KeyboardEvent) {
		switch (e.key) {
			case 'ArrowDown': {
				e.preventDefault();
				if (!open) {
					if (arrowCyclesValue) {
						cycleValue(1);
					} else {
						openDropdown();
						highlightedIndex = getNextIndex(-1, 1);
					}
				} else {
					highlightedIndex = getNextIndex(highlightedIndex, 1);
					scrollHighlightedIntoView();
				}
				break;
			}
			case 'ArrowUp': {
				e.preventDefault();
				if (!open) {
					if (arrowCyclesValue) {
						cycleValue(-1);
					} else {
						openDropdown();
						highlightedIndex = getNextIndex(flatSelectableOptions.length, -1);
					}
				} else {
					highlightedIndex = getNextIndex(highlightedIndex, -1);
					scrollHighlightedIntoView();
				}
				break;
			}
			case 'Enter': {
				e.preventDefault();
				if (!open) {
					openDropdown();
				} else if (
					showCreateOption &&
					(highlightedIndex === -1 || highlightedIndex >= flatSelectableOptions.length)
				) {
					handleCreate();
				} else if (
					highlightedIndex >= 0 &&
					highlightedIndex < flatSelectableOptions.length
				) {
					selectOption(flatSelectableOptions[highlightedIndex]);
				}
				break;
			}
			case 'Escape': {
				e.preventDefault();
				closeDropdown();
				triggerElement?.focus();
				break;
			}
			case 'Home': {
				if (open) {
					e.preventDefault();
					highlightedIndex = getNextIndex(-1, 1);
					scrollHighlightedIntoView();
				}
				break;
			}
			case 'End': {
				if (open) {
					e.preventDefault();
					highlightedIndex = getNextIndex(flatSelectableOptions.length, -1);
					scrollHighlightedIntoView();
				}
				break;
			}
			default: {
				// Type-ahead in non-searchable mode
				if (
					!searchable &&
					!open &&
					e.key.length === 1 &&
					!e.ctrlKey &&
					!e.metaKey &&
					!e.altKey
				) {
					clearTimeout(typeAheadTimer);
					typeAheadBuffer += e.key.toLowerCase();
					typeAheadTimer = setTimeout(() => {
						typeAheadBuffer = '';
					}, 500);

					const match = options.find(
						(opt) => !opt.disabled && opt.label.toLowerCase().startsWith(typeAheadBuffer),
					);
					if (match) {
						if (multiple) {
							// In multi-select type-ahead doesn't auto-select
						} else {
							value = match.value;
							onchange?.({ value });
						}
					}
				}
				break;
			}
		}
	}

	/** Handle keyboard navigation within the search input */
	function onSearchKeyDown(e: KeyboardEvent) {
		switch (e.key) {
			case 'ArrowDown': {
				e.preventDefault();
				highlightedIndex = getNextIndex(highlightedIndex, 1);
				scrollHighlightedIntoView();
				break;
			}
			case 'ArrowUp': {
				e.preventDefault();
				highlightedIndex = getNextIndex(highlightedIndex, -1);
				scrollHighlightedIntoView();
				break;
			}
			case 'Enter': {
				e.preventDefault();
				if (
					showCreateOption &&
					(highlightedIndex === -1 || highlightedIndex >= flatSelectableOptions.length)
				) {
					handleCreate();
				} else if (
					highlightedIndex >= 0 &&
					highlightedIndex < flatSelectableOptions.length
				) {
					selectOption(flatSelectableOptions[highlightedIndex]);
				}
				break;
			}
			case 'Escape': {
				e.preventDefault();
				closeDropdown();
				triggerElement?.focus();
				break;
			}
			case 'Home': {
				e.preventDefault();
				highlightedIndex = getNextIndex(-1, 1);
				scrollHighlightedIntoView();
				break;
			}
			case 'End': {
				e.preventDefault();
				highlightedIndex = getNextIndex(flatSelectableOptions.length, -1);
				scrollHighlightedIntoView();
				break;
			}
		}
	}

	/** Whether the trigger has a value to display */
	const hasValue = $derived.by(() => {
		if (multiple) {
			return Array.isArray(value) && value.length > 0;
		}
		/* Treat empty string as "no value" so a `let value = $state('')`
		   binding leaves the label resting as the in-field placeholder (and
		   floating only on open/focus/selection), matching <Input>. */
		return value !== undefined && value !== null && value !== '';
	});

	/** A distinct placeholder is one that differs from the label. */
	const hasDistinctPlaceholder = $derived(!!placeholder && placeholder !== label);

	/** Whether the floating label sits in its raised (notched) position. */
	const labelFloated = $derived.by(() => {
		if (!label) return false;
		if (hasDistinctPlaceholder) return true;
		if (open || focused) return true;
		return hasValue;
	});

	/** Whether placeholder text should be shown inside the trigger. */
	const showPlaceholder = $derived(
		!hasValue && !!placeholder && (!label || hasDistinctPlaceholder),
	);

	/** A unique CSS anchor name, used for native anchor positioning. */
	const anchorName = $derived(`--ds-select-${String(id).replace(/[^a-zA-Z0-9_-]/g, '')}`);

	/** Run open/close side effects when the dropdown state changes. */
	let previousOpen = false;
	$effect(() => {
		if (open && !previousOpen) {
			onopen?.();
			if (searchable) {
				requestAnimationFrame(() => {
					searchInputElement?.focus();
				});
			}
		} else if (!open && previousOpen) {
			searchQuery = '';
			highlightedIndex = -1;
			onclose?.();
		}
		previousOpen = open;
	});

	/* Mirror `open` onto the native popover element, and detect whether the
	   browser flipped it above the trigger so the panel expands from the edge
	   nearest the control. */
	$effect(() => {
		const el = dropdownElement;
		if (!el) return;
		const shown = el.matches(':popover-open');
		if (open && !shown) {
			try {
				el.showPopover();
				/* Measure synchronously — `showPopover()` has already placed the
				   popover (incl. any `flip-block` fallback), and reading layout
				   here keeps the result in the same frame as the open
				   transition, so the expand origin is correct from frame one. */
				if (triggerElement) {
					const t = triggerElement.getBoundingClientRect();
					const d = el.getBoundingClientRect();
					dropdownAbove = d.top < t.top;
				}
			} catch {
				/* not connected yet */
			}
		} else if (!open && shown) {
			try {
				el.hidePopover();
			} catch {
				/* already hidden */
			}
		}
	});

	/* Close when a pointer goes down outside the component while open. */
	$effect(() => {
		if (!open) return;
		function onDocPointerDown(e: PointerEvent) {
			if (selectElement && !selectElement.contains(e.target as Node)) {
				closeDropdown();
			}
		}
		document.addEventListener('pointerdown', onDocPointerDown, true);
		return () => document.removeEventListener('pointerdown', onDocPointerDown, true);
	});

	/** Get the flat index offset for options within a group */
	function getFlatGroupIndex(groupName: string, indexInGroup: number): number {
		let offset = 0;
		for (const [name, opts] of groupedOptions.groups) {
			if (name === groupName) return offset + indexInGroup;
			offset += opts.length;
		}
		return offset + indexInGroup;
	}
</script>

<div
	class={['select', `size-${size}`, class_name].filter(Boolean).join(' ')}
	class:dense
	class:comfortable
	class:disabled
	class:skeleton
	class:open
	class:has-label={!!label}
	class:has-error={!!error}
	bind:this={selectElement}
	style:--select-font={sizeMap[size] ?? sizeMap['1']}
	onfocusin={() => (focused = true)}
	onfocusout={(e) => {
		if (!selectElement?.contains(e.relatedTarget as Node)) focused = false;
	}}
	{@attach tooltip_message ? tooltip(tooltip_message) : () => {}}>
	<!-- Trigger button -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		bind:this={triggerElement}
		{id}
		class="select-trigger"
		class:open
		class:error={!!error}
		class:disabled
		role="combobox"
		aria-expanded={open}
		aria-haspopup="listbox"
		aria-controls="{id}-listbox"
		aria-disabled={disabled || undefined}
		tabindex={disabled ? -1 : 0}
		style:anchor-name={anchorName}
		onclick={toggleDropdown}
		onkeydown={onTriggerKeyDown}>
		<div class="select-value">
			{#if hasValue && render_value}
				{@render render_value(selectedOptions as SelectOption | SelectOption[])}
			{:else if multiple && Array.isArray(selectedOptions) && selectedOptions.length > 0}
				{#each selectedOptions as opt (opt.value)}
					<span
						class="select-chip"
						in:scale={{ duration: 200, start: 0.6, easing: backOut }}
						out:chipOut={{ duration: 150 }}
						animate:flip={{ duration: 150, easing: quintOut }}>
						<span>{opt.label}</span>
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<span class="select-chip-remove" onclick={(e) => removeValue(opt.value, e)}>
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
			{:else if !multiple && selectedOptions && !Array.isArray(selectedOptions)}
				<span class="select-single-value">{selectedOptions.label}</span>
			{:else if showPlaceholder}
				<span class="select-placeholder">{placeholder}</span>
			{/if}
		</div>

		<!-- Floating notched-outline label -->
		{#if label}
			<label class="select-label" class:floated={labelFloated} for={id}>
				<span class="select-label-text">
					{label}{#if required}<span class="select-required" aria-hidden="true">
							*
						</span>{/if}
				</span>
			</label>
		{/if}

		{#if loading}
			<span class="select-spinner" aria-hidden="true"></span>
		{/if}

		{#if clearable && hasValue && !disabled}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span class="select-clear" onclick={clearValue} aria-label="Clear selection">
				<svg viewBox="0 0 24 24" width="16" height="16">
					<path
						d="M18 6L6 18M6 6l12 12"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						fill="none" />
				</svg>
			</span>
		{/if}

		<span class="select-chevron" class:open aria-hidden="true">
			<svg viewBox="0 0 24 24" width="18" height="18">
				<path
					d="M6 9l6 6 6-6"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					fill="none" />
			</svg>
		</span>
	</div>

	<!-- Dropdown — native popover, positioned with CSS anchor positioning -->
	<div
		class="select-dropdown"
		class:above={dropdownAbove}
		popover="manual"
		bind:this={dropdownElement}
		role="listbox"
		id="{id}-listbox"
		aria-multiselectable={multiple || undefined}
		style:position-anchor={anchorName}>
		{#if searchable}
			<div class="select-search">
				<input
					bind:this={searchInputElement}
					type="text"
					placeholder="Search..."
					value={searchQuery}
					oninput={onSearchInput}
					onkeydown={onSearchKeyDown}
					aria-label="Search options"
					autocomplete="off" />
			</div>
		{/if}

		{#if loading}
			<div class="select-empty">Loading...</div>
		{:else}
			<!-- Ungrouped options -->
			{#each groupedOptions.ungrouped as opt, i (opt.value)}
				{@const flatIndex = i}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					class="select-option"
					class:selected={isSelected(opt.value)}
					class:highlighted={highlightedIndex === flatIndex}
					class:disabled={opt.disabled}
					role="option"
					tabindex="-1"
					aria-selected={isSelected(opt.value)}
					aria-disabled={opt.disabled || undefined}
					onpointerdown={(e) => e.preventDefault()}
					onclick={() => selectOption(opt)}
					onpointerenter={() => {
						if (!opt.disabled) highlightedIndex = flatIndex;
					}}
					{@attach ripple({ enabled: !opt.disabled, zIndex: 1 })}>
					{#if multiple}
						<span class="select-check" aria-hidden="true">
							{#if isSelected(opt.value)}
								<svg viewBox="0 0 24 24" width="16" height="16">
									<path
										d="M5 13l4 4L19 7"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										fill="none" />
								</svg>
							{/if}
						</span>
					{/if}
					{#if optionSnippet}
						{@render optionSnippet(opt)}
					{:else}
						<span class="select-option-content">
							<span class="select-option-label">{opt.label}</span>
							{#if opt.description}
								<span class="select-option-description">{opt.description}</span>
							{/if}
						</span>
					{/if}
					{#if !multiple && isSelected(opt.value)}
						<span class="select-check-single" aria-hidden="true">
							<svg viewBox="0 0 24 24" width="16" height="16">
								<path
									d="M5 13l4 4L19 7"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									fill="none" />
							</svg>
						</span>
					{/if}
				</div>
			{/each}

			<!-- Grouped options -->
			{#each [...groupedOptions.groups] as [groupName, groupOpts] (groupName)}
				<div class="select-group-label">{groupName}</div>
				{#each groupOpts as opt, gi (opt.value)}
					{@const flatIndex =
						groupedOptions.ungrouped.length + getFlatGroupIndex(groupName, gi)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<div
						class="select-option"
						class:selected={isSelected(opt.value)}
						class:highlighted={highlightedIndex === flatIndex}
						class:disabled={opt.disabled}
						role="option"
						tabindex="-1"
						aria-selected={isSelected(opt.value)}
						aria-disabled={opt.disabled || undefined}
						onpointerdown={(e) => e.preventDefault()}
						onclick={() => selectOption(opt)}
						onpointerenter={() => {
							if (!opt.disabled) highlightedIndex = flatIndex;
						}}
						{@attach ripple({ enabled: !opt.disabled, zIndex: 1 })}>
						{#if multiple}
							<span class="select-check" aria-hidden="true">
								{#if isSelected(opt.value)}
									<svg viewBox="0 0 24 24" width="16" height="16">
										<path
											d="M5 13l4 4L19 7"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
											fill="none" />
									</svg>
								{/if}
							</span>
						{/if}
						{#if optionSnippet}
							{@render optionSnippet(opt)}
						{:else}
							<span class="select-option-content">
								<span class="select-option-label">{opt.label}</span>
								{#if opt.description}
									<span class="select-option-description">{opt.description}</span>
								{/if}
							</span>
						{/if}
						{#if !multiple && isSelected(opt.value)}
							<span class="select-check-single" aria-hidden="true">
								<svg viewBox="0 0 24 24" width="16" height="16">
									<path
										d="M5 13l4 4L19 7"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										fill="none" />
								</svg>
							</span>
						{/if}
					</div>
				{/each}
			{/each}

			<!-- Creatable option -->
			{#if showCreateOption}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					class="select-option select-create"
					class:highlighted={highlightedIndex === flatSelectableOptions.length ||
						highlightedIndex === -1}
					role="option"
					tabindex="-1"
					aria-selected={false}
					onpointerdown={(e) => e.preventDefault()}
					onclick={handleCreate}
					onpointerenter={() => {
						highlightedIndex = flatSelectableOptions.length;
					}}
					{@attach ripple()}>
					Create '{searchQuery.trim()}'
				</div>
			{/if}

			<!-- Empty state -->
			{#if showEmpty}
				<div class="select-empty">No options</div>
			{/if}
		{/if}
	</div>

	<!-- Hidden input(s) for form submission -->
	{#if name}
		{#if multiple && Array.isArray(value)}
			{#each value as v (v)}
				<input type="hidden" {name} value={v} />
			{/each}
		{:else if value !== undefined && value !== null}
			<input type="hidden" {name} {value} />
		{/if}
	{/if}
</div>

<!-- Error message -->
{#if error}
	<span class="select-error">{error}</span>
{/if}

<style>
	/* ================================================================== */
	/*  ROOT                                                               */
	/* ================================================================== */

	.select {
		--_font: var(--select-font, var(--control-font-1, 1rem));
		/* Height scales off the font so the whole control scales from one
		   number. The ratio is the SHARED --control-height-ratio (tokens.css),
		   so Input, Select and Button land on the same height. */
		--_height: calc(var(--_font) * var(--control-height-ratio, 3));
		--_radius: var(--radius-lg, 10px);
		--_border: var(--color-border, light-dark(hsl(0 0% 78%), hsl(0 0% 32%)));
		--_border-hover: var(--color-border-active, light-dark(hsl(0 0% 60%), hsl(0 0% 48%)));
		--_border-focus: var(--color-action, hsl(217 75% 52%));
		--_border-error: var(--color-error, light-dark(#ef6262, #b04343));
		--_bg: var(--color-surface, light-dark(#fff, hsl(0 0% 9%)));
		--_panel: var(--color-surface, light-dark(#fff, hsl(0 0% 13%)));
		--_panel-hover: var(--color-bg-active, light-dark(hsl(0 0% 95%), hsl(0 0% 18%)));
		/* Row highlight — the same 6% text-color tint ListItem uses for its
		   hover/active fill (and its hairline separators), so this panel and the
		   Input autocomplete panel light up identically. */
		--_option-hover: color-mix(
			in oklch,
			var(--color-text, light-dark(#000, #fff)) 6%,
			transparent
		);
		/* The persistent selected tint — an action-color wash, so the current
		   selection is clearly visible at rest and reads as "selected" (matching
		   the row's accent text/checkmark) rather than as a weak gray hover. */
		--_option-selected: color-mix(in oklch, var(--_border-focus) 10%, transparent);
		/* A hovered/highlighted selected row deepens the same wash, so pointing
		   at the selection never makes it LESS prominent than its resting state. */
		--_option-selected-hover: color-mix(in oklch, var(--_border-focus) 16%, transparent);
		--_text: var(--color-text, inherit);
		--_text-muted: var(--color-text-muted, light-dark(hsl(0 0% 46%), hsl(0 0% 62%)));
		--_chip-bg: var(--color-action, hsl(217 75% 52%));
		--_chip-text: var(--color-action-text, #fff);
		--_duration: 150ms;
		--_ease: var(--ease-in-out, cubic-bezier(0.76, 0, 0.24, 1));
		--_ease-label: cubic-bezier(0, 0.54, 0.47, 1);
		/* Snappy ease-out for the dropdown's expand-in animation */
		--_ease-expand: cubic-bezier(0.16, 1, 0.3, 1);
		/* Back-out easing — overshoots the target so the chevron flip has a
		   little bounce. */
		--_ease-back: var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));

		position: relative;
		width: 100%;
		font-size: var(--_font);
		text-align: left;
	}

	.select.dense {
		--_height: calc(var(--_font) * var(--control-height-ratio-dense, 2.5));
	}
	.select.comfortable {
		--_height: calc(var(--_font) * var(--control-height-ratio-comfortable, 3.5));
	}

	.select.disabled {
		opacity: 0.55;
		pointer-events: none;
	}

	/* ================================================================== */
	/*  SKELETON / LOADING                                                 */
	/* ================================================================== */

	/* The skeleton renders the real trigger (non-interactive) with a soft
	   sweeping shimmer — no layout shift when it resolves. */
	.select.skeleton {
		pointer-events: none;
	}
	.select.skeleton .select-trigger::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		@supports (corner-shape: squircle) {
			corner-shape: inherit;
		}
		background: linear-gradient(
			100deg,
			transparent 30%,
			color-mix(in oklch, var(--_text, currentColor) 9%, transparent) 50%,
			transparent 70%
		);
		background-size: 220% 100%;
		background-position: 180% 0;
		animation: select-skeleton-sweep 1.5s ease-in-out infinite;
		pointer-events: none;
	}
	@keyframes select-skeleton-sweep {
		to {
			background-position: -180% 0;
		}
	}

	/* ================================================================== */
	/*  TRIGGER                                                            */
	/* ================================================================== */

	.select-trigger {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.5em;
		box-sizing: border-box;
		min-height: var(--_height);
		/* No top margin: the bordered box IS the control's layout height, so a
		   row of Input/Select/Button top-aligns. The floating label is
		   absolutely positioned and straddles the top border out of flow — it
		   overflows ~0.4em above the box without adding to the layout height.
		   Vertical padding keeps wrapped chips off the rounded outline; the
		   trigger grows past `min-height` when chips span multiple rows. */
		padding: 0.5em var(--control-pad-x, 1em);
		border-radius: var(--_radius);
		/* Squircle + a rounder radius. The notch shoulders (.select-label ::before/::after)
		   draw the top corners, so the radius is doubled like elsewhere but CAPPED at the
		   label's left content offset (1em) — past that the corner would crowd the floated
		   label. --_cr is the shared corner radius; the shoulders scale to it (height +
		   floated width) so the squircle seam stays aligned with the side borders. */
		@supports (corner-shape: squircle) {
			--_cr: min(calc(var(--_radius) * var(--squircle-ratio, 2)), 1em);
			corner-shape: squircle;
			border-radius: var(--_cr);
		}
		background: var(--_bg);
		cursor: pointer;
		width: 100%;
		font: inherit;
		font-size: var(--_font);
		color: var(--_text);
		text-align: left;
		outline: none;
	}

	.select.dense .select-trigger {
		padding: 0.4em var(--control-pad-x-dense, 0.75em);
	}
	.select.comfortable .select-trigger {
		padding: 0.6em var(--control-pad-x-comfortable, 1.25em);
	}

	/* The outline is painted by a pseudo-element so the 1px -> 2px focus
	   transition never nudges the trigger's contents. */
	.select-trigger::before {
		content: '';
		position: absolute;
		inset: 0;
		border: 1px solid var(--_border);
		border-radius: inherit;
		@supports (corner-shape: squircle) {
			corner-shape: inherit;
		}
		pointer-events: none;
		/* Width is NOT transitioned: the top edge (notch shoulders) thickens
		   instantly on focus, so the sides/bottom must snap too or the box
		   visibly thickens at two different rates. */
		transition: border-color var(--_duration) var(--_ease);
	}

	/* With a label present, the label paints the top edge (the notch) */
	.select.has-label .select-trigger::before {
		border-top-color: transparent;
	}

	.select-trigger:hover::before {
		border-color: var(--_border-hover);
		/* Snap the border color in on hover; the base rule eases it back out on leave. */
		transition: none;
	}
	.select.has-label .select-trigger:hover::before {
		border-top-color: transparent;
	}

	.select-trigger.open::before,
	.select-trigger:focus-within::before {
		border-color: var(--_border-focus);
		border-width: 2px;
	}
	.select.has-label .select-trigger.open::before,
	.select.has-label .select-trigger:focus-within::before {
		border-top-color: transparent;
	}

	.select.has-error .select-trigger::before {
		border-color: var(--_border-error);
	}
	.select.has-error .select-trigger.open::before,
	.select.has-error .select-trigger:focus-within::before {
		border-color: var(--_border-error);
	}
	.select.has-error.has-label .select-trigger::before {
		border-top-color: transparent;
	}

	/* ================================================================== */
	/*  FLOATING LABEL  (notched outline, legacy-style)                    */
	/* ================================================================== */

	.select-label {
		position: absolute;
		inset: 0 0 auto 0;
		display: flex;
		align-items: center;
		height: var(--_height);
		margin: 0;
		padding: 0;
		box-sizing: border-box;
		border-top: 1px solid var(--_border);
		/* Invisible counterweight to the top border: with border-box sizing the
		   1px top border alone would push the flex-centred resting text 0.5px
		   below the trigger's true centre. */
		border-bottom: 1px solid transparent;
		border-radius: var(--_radius);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: var(--_cr);
		}
		color: var(--_text-muted);
		pointer-events: none;
		transition:
			border-color var(--_duration) var(--_ease),
			color var(--_duration) var(--_ease);
	}

	/* Notch shoulders — short border runs either side of the label text */
	.select-label::before,
	.select-label::after {
		content: '';
		display: block;
		box-sizing: border-box;
		flex: 0 0 auto;
		align-self: flex-start;
		width: 0;
		min-width: 1em;
		height: var(--_radius);
		@supports (corner-shape: squircle) {
			height: var(--_cr);
		}
		border-top: 1px solid transparent;
		transition:
			border-color var(--_duration) var(--_ease),
			min-width 200ms var(--_ease-label);
	}
	.select-label::before {
		/* End the left border run 0.3em before the text so the notch has a small
		   gap on the left, matching the 0.3em the ::after leaves on the right.
		   The text's own margin-left keeps it aligned with the trigger value. */
		min-width: 0.7em;
		border-top-left-radius: var(--_radius);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-top-left-radius: var(--_cr);
		}
	}
	.select-label::after {
		flex: 1 1 auto;
		min-width: 0.5em;
		margin-left: 0.3em;
		border-top-right-radius: var(--_radius);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-top-right-radius: var(--_cr);
			/* Room for the bigger corner when a long label squeezes the shoulder,
			   so the curve never gets scaled down (which would break the seam). */
			min-width: 1em;
		}
	}

	.select-label-text {
		display: flex;
		align-items: center;
		max-width: 100%;
		/* Small gap from the left notch shoulder (mirrors the ::after gap on the
		   right); the shoulder is shortened by the same amount so the text stays
		   aligned with the trigger value. */
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
			margin-left 200ms var(--_ease-label);
	}

	/* Floated: hide the label's own edge, light the notch shoulders, and
	   glide the shrunken text up onto the outline. */
	.select-label.floated {
		border-top-color: transparent;
	}
	.select-label.floated::before,
	.select-label.floated::after {
		border-top-color: var(--_border);
	}
	.select-label.floated .select-label-text {
		font-size: calc(var(--_font) * 0.8);
		transform: translateY(calc(var(--_height) / -2));
		@supports (corner-shape: squircle) {
			/* The floated left shoulder is widened to the 1em label offset below, so
			   drop the text's own gap to keep it landing at the same spot (the
			   ::before min-width and this margin animate together → no horizontal shift). */
			margin-left: 0;
		}
	}
	/* Floated: widen the left shoulder to the label's 1em content offset so the
	   (now larger, capped) squircle corner has room and its seam meets the side. */
	@supports (corner-shape: squircle) {
		.select-label.floated::before {
			min-width: 1em;
			/* Trim the trailing 0.3em of the shoulder so the line stops short of
			   the text — the same gap the ::after's margin leaves on the right.
			   A squircle is dead flat over its last third, so only the straight
			   tail of the corner falls in the trimmed region; the curve itself
			   still reads complete. */
			mask-image: linear-gradient(to right, #000 calc(100% - 0.3em), #0000 0);
		}
	}

	.select-trigger:hover .select-label {
		border-top-color: var(--_border-hover);
		/* Snap the notch color in on hover; the base rule eases it back out on leave. */
		transition: color var(--_duration) var(--_ease);
	}
	.select-trigger:hover .select-label.floated {
		border-top-color: transparent;
	}
	.select-trigger:hover .select-label.floated::before,
	.select-trigger:hover .select-label.floated::after {
		border-top-color: var(--_border-hover);
		/* Snap the notch color in on hover; the base rule eases it back out.
		   Keep min-width animating — the label floats while hovered (opening is
		   a click), so dropping it here would snap the shoulder mid-float. */
		transition: min-width 200ms var(--_ease-label);
	}

	/* The label's own border-top stays 1px on focus/open — an open/focused label
	   is always floated (its own border is then transparent), so thickening it
	   here was invisible yet grew the label's content box, nudging the notch
	   shoulders and centred text down ~1px. The focus emphasis comes from the
	   notch shoulders (::before/::after) below, which thicken without moving. */
	.select-trigger.open .select-label,
	.select-trigger:focus-within .select-label {
		border-top-color: var(--_border-focus);
		color: var(--_border-focus);
	}
	.select-trigger.open .select-label.floated,
	.select-trigger:focus-within .select-label.floated {
		border-top-color: transparent;
	}
	.select-trigger.open .select-label::before,
	.select-trigger.open .select-label::after,
	.select-trigger:focus-within .select-label::before,
	.select-trigger:focus-within .select-label::after {
		border-top-width: 2px;
	}
	.select-trigger.open .select-label.floated::before,
	.select-trigger.open .select-label.floated::after,
	.select-trigger:focus-within .select-label.floated::before,
	.select-trigger:focus-within .select-label.floated::after {
		border-top-color: var(--_border-focus);
	}

	.select.has-error .select-label {
		border-top-color: var(--_border-error);
		color: var(--_border-error);
	}
	.select.has-error .select-label.floated {
		border-top-color: transparent;
	}
	.select.has-error .select-label.floated::before,
	.select.has-error .select-label.floated::after {
		border-top-color: var(--_border-error);
	}

	.select-required {
		color: var(--_border-error);
		margin-left: 0.15em;
	}

	/* ================================================================== */
	/*  VALUE / CHIPS                                                      */
	/* ================================================================== */

	.select-value {
		flex: 1;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35em;
		min-width: 0;
		/* Kept visible so each chip's enlarged (overflowing) remove-button
		   touch target isn't clipped. Single value / placeholder truncate
		   themselves below. */
		overflow: visible;
	}

	.select-single-value,
	.select-placeholder {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.select-placeholder {
		color: var(--_text-muted);
	}

	.select-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3em;
		padding: 0.2em 0.3em 0.2em 0.7em;
		border-radius: var(--radius-full, 999px);
		background: var(--_chip-bg);
		color: var(--_chip-text);
		font-size: 0.82em;
		max-width: 100%;
		line-height: 1.45;
	}
	.select-chip > span:first-child {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.select-chip-remove {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.35em;
		height: 1.35em;
		flex-shrink: 0;
		border-radius: var(--radius-full, 999px);
		color: inherit;
		cursor: pointer;
		opacity: 0.75;
		transition:
			opacity var(--_duration) var(--_ease),
			background var(--_duration) var(--_ease);
	}
	/* Invisible hit area extending ~10px past the icon on every side so the
	   button is easy to tap. The visible hover feedback stays the size of the
	   element itself (above), not the touch target. */
	.select-chip-remove::before {
		content: '';
		position: absolute;
		inset: -10px;
	}
	.select-chip-remove:hover {
		opacity: 1;
		background: color-mix(in oklch, currentColor 22%, transparent);
		/* Snap the tint in on hover; keep the opacity reveal eased both ways. */
		transition: opacity var(--_duration) var(--_ease);
	}

	/* Clear button */
	.select-clear {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		padding: 0.35em;
		border-radius: var(--radius-full, 999px);
		color: var(--_text-muted);
		cursor: pointer;
		opacity: 0.7;
		transition:
			opacity var(--_duration) var(--_ease),
			background var(--_duration) var(--_ease);
	}
	.select-clear:hover {
		opacity: 1;
		background: var(--_panel-hover);
		/* Snap the tint in on hover; keep the opacity reveal eased both ways. */
		transition: opacity var(--_duration) var(--_ease);
	}

	/* Chevron */
	.select-chevron {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		color: var(--_text-muted);
		transition:
			transform 300ms var(--_ease-back),
			color var(--_duration) var(--_ease);
	}
	.select-chevron.open {
		transform: rotate(180deg);
	}
	.select-trigger.open .select-chevron,
	.select-trigger:focus-within .select-chevron {
		color: var(--_border-focus);
	}

	/* Spinner */
	.select-spinner {
		display: inline-block;
		width: 1.05em;
		height: 1.05em;
		border: 2px solid var(--_border);
		border-top-color: var(--_border-focus);
		border-radius: 50%;
		animation: select-spin 0.6s linear infinite;
		flex-shrink: 0;
	}
	@keyframes select-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ================================================================== */
	/*  DROPDOWN  (native popover, CSS anchor positioned)                  */
	/* ================================================================== */

	/*
	 * The dropdown is a native `popover` element — it renders in the top
	 * layer (no clipping, no z-index juggling, no Portal) and is placed with
	 * CSS anchor positioning relative to the trigger. `position-anchor` is set
	 * inline to a per-instance anchor name.
	 */
	.select-dropdown {
		position: fixed;
		top: anchor(bottom);
		bottom: auto;
		left: anchor(left);
		right: auto;
		width: anchor-size(width);
		margin: 0.4em 0 0 0;
		padding: 0.3em;
		box-sizing: border-box;
		max-height: 18em;
		overflow-y: auto;
		/* Border + shadow together: in light mode the shadow lifts the panel and
		   the border is a faint edge; in dark mode --shadow-md is transparent, so
		   the border is what separates the panel from the page. */
		border: 1px solid var(--_border);
		background: var(--_panel);
		color: var(--_text);
		border-radius: var(--radius-xl, 16px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-xl, 16px) * var(--squircle-ratio, 2));
		}
		box-shadow: var(--shadow-md, 0 8px 28px -8px rgb(0 0 0 / 0.3));
		scrollbar-width: thin;
		/* Flip above the trigger when there is no room below */
		position-try-fallbacks: flip-block;
		/* Expand-in from the edge closest to the trigger — origin flips to
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
	.select-dropdown.above {
		transform-origin: center bottom;
	}
	/* Collapsed state — drives both the open (@starting-style) and close
	   transitions, so the panel expands/collapses toward the trigger. */
	.select-dropdown:not(:popover-open) {
		opacity: 0;
		transform: scaleY(0.6);
	}
	@starting-style {
		.select-dropdown:popover-open {
			opacity: 0;
			transform: scaleY(0.6);
		}
	}

	/* Search */
	.select-search {
		padding: 0.25em 0.25em 0.4em;
	}
	.select-search input {
		width: 100%;
		padding: 0.6em 0.8em;
		border: 1px solid var(--_border);
		/* A larger radius than the default so it doesn't read as sharper than
		   the surrounding popover. */
		border-radius: var(--radius-lg, 10px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-lg, 10px) * var(--squircle-ratio, 2));
		}
		background: var(--_bg);
		color: var(--_text);
		font: inherit;
		outline: none;
		box-shadow: none;
		transition: border-color var(--_duration) var(--_ease);
	}
	.select-search input:focus {
		border-color: var(--_border-focus);
	}
	.select-search input::placeholder {
		color: var(--_text-muted);
	}

	/* Options */
	.select-option {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.6em;
		padding: 0.7em 0.85em;
		border-radius: var(--radius-md, 8px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-md, 8px) * var(--squircle-ratio, 2));
		}
		cursor: pointer;
		/* Self-contained perspective so the pressed dip recedes toward each
		 * option's own center, not the center of the whole list. */
		transform-origin: center center;
		/* Durations match ListItem: the highlight eases out over 300ms; the
		   corner merge (below) animates over 150ms. */
		transition:
			background 300ms ease,
			border-radius 150ms ease,
			transform 200ms ease;
		user-select: none;
	}
	.select-option:hover,
	.select-option.highlighted {
		background: var(--_option-hover);
		/* Snap the highlight in on hover/keyboard nav; the base rule eases it out. */
		transition:
			border-radius 150ms ease,
			transform 200ms ease;
	}
	/* Hairline between consecutive rows, matching ListItem's separator (same
	   6% text tint, same 1rem inset). Group labels carry their own stronger
	   rule, so only option-to-option seams get one. */
	.select-option + .select-option::after {
		content: '';
		position: absolute;
		top: 0;
		left: 1rem;
		right: 1rem;
		border-top: 1px solid var(--_option-hover);
	}
	/* The first and last rows hug the panel's rounded corners (panel radius
	   minus its 0.3em padding) so a highlighted edge item nests cleanly. */
	.select-dropdown > .select-option:first-child,
	.select-dropdown > .select-group-label:first-child {
		border-top-left-radius: calc(var(--radius-xl, 16px) - 0.3em);
		border-top-right-radius: calc(var(--radius-xl, 16px) - 0.3em);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-top-left-radius: calc(
				(var(--radius-xl, 16px) - 0.3em) * var(--squircle-ratio, 2)
			);
			border-top-right-radius: calc(
				(var(--radius-xl, 16px) - 0.3em) * var(--squircle-ratio, 2)
			);
		}
	}
	.select-dropdown > .select-option:last-child,
	.select-dropdown > .select-empty:last-child {
		border-bottom-left-radius: calc(var(--radius-xl, 16px) - 0.3em);
		border-bottom-right-radius: calc(var(--radius-xl, 16px) - 0.3em);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-bottom-left-radius: calc(
				(var(--radius-xl, 16px) - 0.3em) * var(--squircle-ratio, 2)
			);
			border-bottom-right-radius: calc(
				(var(--radius-xl, 16px) - 0.3em) * var(--squircle-ratio, 2)
			);
		}
	}
	.select-option.selected {
		color: var(--_border-focus);
		font-weight: 600;
		background: var(--_option-selected);
	}
	/* A hovered/highlighted selected row deepens its action-color wash (rather
	   than switching to the gray hover fill, which would read as a downgrade).
	   These win over the resting .selected tint by specificity; the
	   snap-in/ease-out timing is still governed by the :hover rule above. */
	.select-option.selected:hover,
	.select-option.selected.highlighted {
		background: var(--_option-selected-hover);
	}
	/* Adjacent lit rows merge into one block (mirrors ListItem): when a
	   selected/highlighted row touches another, square off the corners where
	   they meet so the pair reads as one continuous selection instead of two
	   rounded pills. The border-radius transition above animates the merge. */
	.select-option:is(.selected, .highlighted):not(.disabled):has(
			+ .select-option:is(.selected, .highlighted):not(.disabled)
		) {
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
	}
	.select-option:is(.selected, .highlighted):not(.disabled)
		+ .select-option:is(.selected, .highlighted):not(.disabled) {
		border-top-left-radius: 0;
		border-top-right-radius: 0;
	}
	.select-option.disabled {
		opacity: 0.5;
		pointer-events: none;
	}
	/* Pressed feedback — the same tactile dip as ListItem (perspective 100px,
	 * depth clamped off the font size). The perspective is baked into the
	 * transform so the recede is relative to the option itself. */
	.select-option:active:not(.disabled) {
		transform: perspective(100px)
			translate3d(0, 1px, clamp(-10px, calc(0.2em - 12px), -2px));
	}

	.select-option-content {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}
	.select-option-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.select-option-description {
		font-size: 0.8em;
		color: var(--_text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Checkmarks */
	.select-check {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.1em;
		height: 1.1em;
		flex-shrink: 0;
		color: var(--_border-focus);
	}
	.select-check-single {
		display: flex;
		align-items: center;
		margin-left: auto;
		flex-shrink: 0;
		color: var(--_border-focus);
	}

	/* Group label — set off from the preceding group with space and a rule */
	.select-group-label {
		margin-top: 0.5em;
		padding: 0.7em 0.85em 0.3em;
		border-top: 1px solid color-mix(in oklch, var(--_text) 9%, transparent);
		font-size: 0.72em;
		font-weight: 700;
		letter-spacing: 0.06em;
		color: var(--_text-muted);
		text-transform: uppercase;
		user-select: none;
	}
	/* No rule above the first group when nothing precedes it in the panel */
	.select-group-label:first-child {
		margin-top: 0;
		border-top: none;
		padding-top: 0.4em;
	}

	/* Create option */
	.select-create {
		font-style: italic;
		color: var(--_text-muted);
	}

	/* Empty / loading state — same metrics as Input's .ac-status row */
	.select-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5em;
		padding: 0.85em;
		color: var(--_text-muted);
		font-size: 0.9em;
	}

	/* Error message */
	.select-error {
		display: block;
		font-size: 0.78em;
		color: var(--_border-error);
		margin-top: 0.35em;
		padding: 0 0.5em;
	}

	/* Icons scale with the control's font size */
	.select-chevron svg {
		width: 1.4em;
		height: 1.4em;
	}
	.select-clear svg {
		width: 1.35em;
		height: 1.35em;
	}
	.select-chip-remove svg {
		width: 0.85em;
		height: 0.85em;
	}
	.select-check svg,
	.select-check-single svg {
		width: 100%;
		height: 100%;
	}
</style>
