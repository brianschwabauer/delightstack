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
	import { tooltip } from '@delightstack/utilities';
	import { type Snippet } from 'svelte';
	import Popover from '../actions/Popover.svelte';

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

		/** The placeholder text shown when no value is selected */
		placeholder = 'Select...',

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
		tooltip: tooltipMessage = undefined as string | undefined,

		/** Whether the component uses dense spacing */
		dense = false,

		/** Whether the component uses comfortable spacing */
		comfortable = false,

		/** The id of the select element */
		id = propId,

		/** The name attribute for hidden form input(s) */
		name = undefined as string | undefined,

		/** Custom class name */
		class: className = '',

		/** Called when the value changes */
		onchange = undefined as ((detail: { value: unknown }) => void) | undefined,

		/** Called when the search query changes (debounced 300ms) */
		onsearch = undefined as ((detail: { query: string }) => void) | undefined,

		/** Called when the user tries to create a new option */
		oncreate = undefined as ((detail: { value: string }) => boolean | void) | undefined,

		/** Called when the dropdown opens */
		onopen = undefined as (() => void) | undefined,

		/** Called when the dropdown closes */
		onclose = undefined as (() => void) | undefined,

		/** Custom snippet for rendering the selected value in the trigger */
		renderValue = undefined as Snippet<[SelectOption | SelectOption[]]> | undefined,

		/** Custom snippet for rendering an option in the dropdown */
		option: optionSnippet = undefined as Snippet<[SelectOption]> | undefined,
	} = $props();

	let open = $state(false);
	let searchQuery = $state('');
	let highlightedIndex = $state(-1);
	let triggerElement = $state<HTMLElement | undefined>(undefined);
	let searchInputElement = $state<HTMLInputElement | undefined>(undefined);
	let dropdownElement = $state<HTMLElement | undefined>(undefined);
	let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
	let typeAheadBuffer = $state('');
	let typeAheadTimer: ReturnType<typeof setTimeout> | undefined;

	// Track chips container overflow for "+N more"
	let chipsContainer = $state<HTMLElement | undefined>(undefined);
	let visibleChipCount = $state(0);

	const sizeMap: Record<string, string> = {
		'0': '0.75rem',
		'1': '0.875rem',
		'2': '1rem',
		'3': '1.125rem',
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

	/** Handle creating a new option */
	function handleCreate() {
		const trimmed = searchQuery.trim();
		if (!trimmed) return;
		const result = oncreate?.({ value: trimmed });
		if (result !== false) {
			searchQuery = '';
			if (!multiple) {
				closeDropdown();
			}
		}
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
			next = ((next + direction) % total + total) % total;
			if (!flatSelectableOptions[next].disabled) return next;
		}
		return -1;
	}

	/** Handle keyboard navigation on the trigger */
	function onTriggerKeyDown(e: KeyboardEvent) {
		switch (e.key) {
			case 'ArrowDown': {
				e.preventDefault();
				if (!open) {
					openDropdown();
					highlightedIndex = getNextIndex(-1, 1);
				} else {
					highlightedIndex = getNextIndex(highlightedIndex, 1);
					scrollHighlightedIntoView();
				}
				break;
			}
			case 'ArrowUp': {
				e.preventDefault();
				if (!open) {
					openDropdown();
					highlightedIndex = getNextIndex(flatSelectableOptions.length, -1);
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
				} else if (showCreateOption && (highlightedIndex === -1 || highlightedIndex >= flatSelectableOptions.length)) {
					handleCreate();
				} else if (highlightedIndex >= 0 && highlightedIndex < flatSelectableOptions.length) {
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
				if (!searchable && !open && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
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
				if (showCreateOption && (highlightedIndex === -1 || highlightedIndex >= flatSelectableOptions.length)) {
					handleCreate();
				} else if (highlightedIndex >= 0 && highlightedIndex < flatSelectableOptions.length) {
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

	/** Compute visible chip count for overflow "+N more" */
	$effect(() => {
		if (!multiple || !chipsContainer) {
			visibleChipCount = 0;
			return;
		}
		const chips = chipsContainer.querySelectorAll('.select-chip');
		const containerRect = chipsContainer.getBoundingClientRect();
		let count = 0;
		for (const chip of chips) {
			const chipRect = chip.getBoundingClientRect();
			if (chipRect.top < containerRect.bottom) {
				count++;
			} else {
				break;
			}
		}
		visibleChipCount = count;
	});

	/** Whether there are overflowed chips */
	const overflowCount = $derived.by(() => {
		if (!multiple || !Array.isArray(selectedOptions)) return 0;
		if (visibleChipCount === 0) return 0;
		return selectedOptions.length - visibleChipCount;
	});

	/** Whether the trigger has a value to display */
	const hasValue = $derived.by(() => {
		if (multiple) {
			return Array.isArray(value) && value.length > 0;
		}
		return value !== undefined && value !== null;
	});

	/** Track open state changes from Popover (handles Popover closing itself on outside click etc.) */
	let previousOpen = false;
	$effect(() => {
		if (open && !previousOpen) {
			// Popover opened
			onopen?.();
			if (searchable) {
				requestAnimationFrame(() => {
					searchInputElement?.focus();
				});
			}
		} else if (!open && previousOpen) {
			// Popover closed (possibly by itself via outside click)
			searchQuery = '';
			highlightedIndex = -1;
			onclose?.();
		}
		previousOpen = open;
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

<!-- Label -->
{#if label}
	<label class="select-label" for={id}>{label}{#if required}<span aria-hidden="true"> *</span>{/if}</label>
{/if}

<div
	class={['ds-select', `size-${size}`, className].filter(Boolean).join(' ')}
	class:dense
	class:comfortable
	class:disabled
	class:skeleton
	class:has-error={!!error}
	style:font-size={sizeMap[size] ?? sizeMap['1']}
	{@attach tooltipMessage ? tooltip(tooltipMessage) : () => {}}>

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
		onclick={toggleDropdown}
		onkeydown={onTriggerKeyDown}>

		<div class="select-value" bind:this={chipsContainer}>
			{#if hasValue && renderValue}
				{@render renderValue(selectedOptions as SelectOption | SelectOption[])}
			{:else if multiple && Array.isArray(selectedOptions) && selectedOptions.length > 0}
				{#each selectedOptions as opt (opt.value)}
					<span class="select-chip">
						<span>{opt.label}</span>
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<span class="select-chip-remove" onclick={(e) => removeValue(opt.value, e)}>
							<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
								<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
							</svg>
						</span>
					</span>
				{/each}
				{#if overflowCount > 0}
					<span class="select-chip overflow">+{overflowCount} more</span>
				{/if}
			{:else if !multiple && selectedOptions && !Array.isArray(selectedOptions)}
				<span class="select-single-value">{selectedOptions.label}</span>
			{:else}
				<span class="select-placeholder">{placeholder}</span>
			{/if}
		</div>

		{#if loading}
			<span class="select-spinner" aria-hidden="true"></span>
		{/if}

		{#if clearable && hasValue && !disabled}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span class="select-clear" onclick={clearValue} aria-label="Clear selection">
				<svg viewBox="0 0 24 24" width="16" height="16">
					<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
				</svg>
			</span>
		{/if}

		<span class="select-chevron" class:open aria-hidden="true">
			<svg viewBox="0 0 24 24" width="18" height="18">
				<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
			</svg>
		</span>
	</div>

	<!-- Popover dropdown -->
	<Popover
		refElement={triggerElement}
		bind:opened={open}
		openOnClick={false}
		arrow={false}
		placement="bottom"
		closeOnOutsideClick
		closeOnEscapeKey
		closeOnInsideClick={false}
		disableInitialFocus={searchable}>

		<div
			class="select-dropdown"
			bind:this={dropdownElement}
			role="listbox"
			id="{id}-listbox"
			aria-multiselectable={multiple || undefined}>

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
						onpointerenter={() => { if (!opt.disabled) highlightedIndex = flatIndex; }}>
						{#if multiple}
							<span class="select-check" aria-hidden="true">
								{#if isSelected(opt.value)}
									<svg viewBox="0 0 24 24" width="16" height="16">
										<path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
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
									<path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
								</svg>
							</span>
						{/if}
					</div>
				{/each}

				<!-- Grouped options -->
				{#each [...groupedOptions.groups] as [groupName, groupOpts] (groupName)}
					<div class="select-group-label">{groupName}</div>
					{#each groupOpts as opt, gi (opt.value)}
						{@const flatIndex = groupedOptions.ungrouped.length + getFlatGroupIndex(groupName, gi)}
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
							onpointerenter={() => { if (!opt.disabled) highlightedIndex = flatIndex; }}>
							{#if multiple}
								<span class="select-check" aria-hidden="true">
									{#if isSelected(opt.value)}
										<svg viewBox="0 0 24 24" width="16" height="16">
											<path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
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
										<path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
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
						class:highlighted={highlightedIndex === flatSelectableOptions.length || highlightedIndex === -1}
						role="option"
						tabindex="-1"
						aria-selected={false}
						onpointerdown={(e) => e.preventDefault()}
						onclick={handleCreate}
						onpointerenter={() => { highlightedIndex = flatSelectableOptions.length; }}>
						Create '{searchQuery.trim()}'
					</div>
				{/if}

				<!-- Empty state -->
				{#if showEmpty}
					<div class="select-empty">No options</div>
				{/if}
			{/if}
		</div>
	</Popover>

	<!-- Hidden input(s) for form submission -->
	{#if name}
		{#if multiple && Array.isArray(value)}
			{#each value as v (v)}
				<input type="hidden" {name} value={v} />
			{/each}
		{:else if value !== undefined && value !== null}
			<input type="hidden" {name} value={value} />
		{/if}
	{/if}
</div>

<!-- Error message -->
{#if error}
	<span class="select-error">{error}</span>
{/if}

<style>
	.select-label {
		display: block;
		font-size: 0.85em;
		margin-bottom: 0.25rem;
		color: var(--color-text-muted, hsl(0 0% 55%));
	}

	.ds-select {
		position: relative;
		width: 100%;
	}

	.ds-select.disabled {
		opacity: 0.5;
		pointer-events: none;
	}

	.ds-select.skeleton {
		pointer-events: none;
	}
	.ds-select.skeleton .select-trigger {
		background: var(--color-bg-muted, hsl(0 0% 90%));
		color: transparent;
		border-color: transparent;
		animation: select-skeleton-pulse 1.5s ease-in-out infinite;
	}
	@keyframes select-skeleton-pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
	}

	.select-trigger {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border, hsl(0 0% 80%));
		border-radius: var(--radius-md, 6px);
		background: light-dark(white, var(--color-surface-1, hsl(0 0% 12%)));
		cursor: pointer;
		transition: border-color 150ms;
		min-height: 2.25rem;
		width: 100%;
		outline: none;
		font: inherit;
		color: inherit;
		text-align: left;
	}

	.select-trigger:focus-within,
	.select-trigger.open {
		border-color: var(--color-action, hsl(220 70% 55%));
		box-shadow: 0 0 0 2px color-mix(in oklch, var(--color-action, hsl(220 70% 55%)) 20%, transparent);
	}

	.select-trigger.error {
		border-color: var(--color-error, #d32f2f);
	}

	.select-trigger.disabled {
		opacity: 0.5;
		pointer-events: none;
	}

	/* Dense / Comfortable */
	.ds-select.dense .select-trigger {
		padding: 0.25rem 0.5rem;
		min-height: 1.75rem;
		gap: 0.25rem;
	}
	.ds-select.comfortable .select-trigger {
		padding: 0.75rem 1rem;
		min-height: 2.75rem;
		gap: 0.625rem;
	}

	.select-value {
		flex: 1;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
		overflow: hidden;
		max-height: 4.5rem;
	}

	.select-single-value {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.select-placeholder {
		color: var(--color-text-muted, hsl(0 0% 55%));
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Chips */
	.select-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0.375rem;
		border-radius: var(--radius-sm, 4px);
		background: light-dark(var(--color-bg-muted, #e5e5e5), var(--color-bg-muted, #333));
		font-size: 0.85em;
		max-width: 100%;
		overflow: hidden;

		> span:first-child {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}
	.select-chip.overflow {
		opacity: 0.7;
		font-style: italic;
	}

	.select-chip-remove {
		cursor: pointer;
		display: flex;
		padding: 0;
		border: none;
		background: none;
		opacity: 0.5;
		flex-shrink: 0;
		color: inherit;
	}
	.select-chip-remove:hover {
		opacity: 1;
	}

	/* Clear button */
	.select-clear {
		display: flex;
		align-items: center;
		opacity: 0.4;
		cursor: pointer;
		flex-shrink: 0;
		transition: opacity 150ms;
	}
	.select-clear:hover {
		opacity: 0.8;
	}

	/* Chevron */
	.select-chevron {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		opacity: 0.5;
		transition: transform 200ms ease;
	}
	.select-chevron.open {
		transform: rotate(180deg);
	}

	/* Spinner */
	.select-spinner {
		display: inline-block;
		width: 16px;
		height: 16px;
		border: 2px solid var(--color-border, hsl(0 0% 80%));
		border-top-color: var(--color-action, hsl(220 70% 55%));
		border-radius: 50%;
		animation: select-spin 0.6s linear infinite;
		flex-shrink: 0;
	}
	@keyframes select-spin {
		to { transform: rotate(360deg); }
	}

	/* Dropdown */
	.select-dropdown {
		min-width: 100%;
		max-height: 240px;
		overflow-y: auto;
		padding: 0.25rem;
	}

	/* Search */
	.select-search {
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--color-border, hsl(0 0% 80%));
	}
	.select-search input {
		width: 100%;
		border: none;
		outline: none;
		background: none;
		color: inherit;
		font: inherit;
	}

	/* Options */
	.select-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-sm, 4px);
		cursor: pointer;
		transition: background 100ms;
		user-select: none;
	}
	.select-option:hover,
	.select-option.highlighted {
		background: light-dark(var(--color-bg-subtle, #f5f5f5), var(--color-bg-subtle, #1a1a1a));
	}
	.select-option.selected {
		color: var(--color-action, hsl(220 70% 55%));
	}
	.select-option.disabled {
		opacity: 0.5;
		pointer-events: none;
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
		color: var(--color-text-muted, hsl(0 0% 55%));
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Checkmark space */
	.select-check {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		color: var(--color-action, hsl(220 70% 55%));
	}
	.select-check-single {
		display: flex;
		align-items: center;
		margin-left: auto;
		flex-shrink: 0;
		color: var(--color-action, hsl(220 70% 55%));
	}

	/* Group label */
	.select-group-label {
		padding: 0.375rem 0.75rem;
		font-size: 0.75em;
		font-weight: 500;
		color: var(--color-text-muted, hsl(0 0% 55%));
		text-transform: uppercase;
		user-select: none;
	}

	/* Create option */
	.select-create {
		font-style: italic;
	}

	/* Empty state */
	.select-empty {
		padding: 1rem;
		text-align: center;
		color: var(--color-text-muted, hsl(0 0% 55%));
	}

	/* Error message */
	.select-error {
		font-size: 0.8em;
		color: var(--color-error, #d32f2f);
		margin-top: 0.25rem;
		display: block;
	}
</style>
