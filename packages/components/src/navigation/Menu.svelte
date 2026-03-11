<script lang="ts" module>
	export { default as MenuItem } from './Menu.svelte';
	export { default as MenuSeparator } from './Menu.svelte';
	export { default as MenuGroup } from './Menu.svelte';
	export { default as MenuCheckboxItem } from './Menu.svelte';
	export { default as MenuRadioGroup } from './Menu.svelte';
	export { default as MenuRadioItem } from './Menu.svelte';

	export interface MenuContext {
		close_on_select: boolean;
		close: () => void;
		size: string;
		registerItem: (el: HTMLElement) => void;
		unregisterItem: (el: HTMLElement) => void;
	}

	export interface MenuRadioContext {
		value: string;
		select: (value: string) => void;
	}
</script>

<script lang="ts">
	import { getContext, setContext, onMount, type Snippet } from 'svelte';
	import Popover from '../actions/Popover.svelte';

	const propId = $props.id();

	let {
		/* --- Menu container props --- */
		/** Whether the menu is open (bindable). Presence of this prop signals this is a Menu container. */
		open = $bindable(false),

		/** The trigger element the menu is anchored to */
		trigger = undefined as HTMLElement | undefined,

		/** Popover placement relative to the trigger */
		placement = 'bottom-start' as import('@floating-ui/dom').Placement,

		/** Whether the menu closes when an item is selected */
		close_on_select = true,

		/** The size of the menu items */
		size = '1' as '0' | '1' | '2' | '3',

		/** Callback when the menu opens */
		onopen = undefined as (() => void) | undefined,

		/** Callback when the menu closes */
		onclose = undefined as (() => void) | undefined,

		/* --- MenuItem props --- */
		/** Keyboard shortcut hint displayed on the right side */
		shortcut = undefined as string | undefined,

		/** Badge displayed on the right side */
		badge = undefined as string | number | undefined,

		/** Whether the item is disabled */
		disabled = false,

		/** Whether the item should be styled as a destructive action */
		danger = false,

		/** Click handler for the menu item */
		onclick = undefined as (() => void) | undefined,

		/* --- MenuCheckboxItem props --- */
		/** Whether the checkbox item is checked (bindable). Presence signals this is a MenuCheckboxItem. */
		checked = $bindable(undefined) as boolean | undefined,

		/* --- MenuRadioGroup / MenuRadioItem props --- */
		/** For MenuRadioGroup: the currently selected value (bindable). For MenuRadioItem: this item's value. */
		value = $bindable(undefined) as string | undefined,

		/* --- MenuGroup props --- */
		/** A label for a menu group. Presence with no interactive props signals this is a MenuGroup. */
		label = undefined as string | undefined,

		/* --- Shared --- */
		/** Change handler for checkbox or radio group */
		onchange = undefined as ((detail: { checked?: boolean; value?: string }) => void) | undefined,

		/** The ID of the element */
		id = propId,

		/** Custom class name */
		class: className = '',

		/** The child content */
		children = undefined as undefined | Snippet,
	} = $props();

	/* ------------------------------------------------------------------ */
	/*  Role detection                                                     */
	/* ------------------------------------------------------------------ */
	const parentMenuContext = getContext<MenuContext | undefined>('menu');
	const parentRadioContext = getContext<MenuRadioContext | undefined>('menu-radio');

	// Menu container: no parent menu context AND has trigger prop support
	// We detect container by checking if there's no parent context
	const isContainer = !parentMenuContext;

	// MenuRadioItem: inside a radio group context and has a string value
	const isRadioItem = $derived(!!parentRadioContext && typeof value === 'string');

	// MenuCheckboxItem: has checked prop (not undefined at init time)
	// We detect this by the presence of checked being explicitly set
	const isCheckboxItem = $derived(!isContainer && !isRadioItem && checked !== undefined);

	// MenuRadioGroup: has value prop but NOT inside a radio context (it creates one)
	const isRadioGroup = $derived(
		!isContainer && !parentRadioContext && value !== undefined && !onclick && !label,
	);

	// MenuGroup: has label prop, no interactive behavior
	const isGroup = $derived(
		!isContainer &&
			!isRadioItem &&
			!isCheckboxItem &&
			!isRadioGroup &&
			!!label &&
			!onclick &&
			!shortcut &&
			!danger,
	);

	// MenuSeparator: no meaningful props at all
	const isSeparator = $derived(
		!isContainer &&
			!isRadioItem &&
			!isCheckboxItem &&
			!isRadioGroup &&
			!isGroup &&
			!onclick &&
			!shortcut &&
			!danger &&
			!label &&
			badge === undefined &&
			!children,
	);

	// MenuItem: everything else inside a menu context
	const isItem = $derived(
		!isContainer &&
			!isRadioItem &&
			!isCheckboxItem &&
			!isRadioGroup &&
			!isGroup &&
			!isSeparator,
	);

	/* ------------------------------------------------------------------ */
	/*  Menu container logic                                               */
	/* ------------------------------------------------------------------ */
	let items = $state<HTMLElement[]>([]);

	if (isContainer) {
		const ctx: MenuContext = {
			close_on_select,
			close() {
				open = false;
			},
			size,
			registerItem(el: HTMLElement) {
				if (!items.includes(el)) {
					items = [...items, el];
				}
			},
			unregisterItem(el: HTMLElement) {
				items = items.filter((item) => item !== el);
			},
		};
		setContext<MenuContext>('menu', ctx);

		// Keep context in sync with props
		$effect(() => {
			ctx.close_on_select = close_on_select;
			ctx.size = size;
		});

		// Fire open/close callbacks
		$effect(() => {
			if (open) {
				onopen?.();
			} else {
				onclose?.();
			}
		});
	}

	/* ------------------------------------------------------------------ */
	/*  MenuRadioGroup logic                                               */
	/* ------------------------------------------------------------------ */
	if (!isContainer && !parentRadioContext && value !== undefined && !onclick && !label) {
		const radioCtx = $state<MenuRadioContext>({
			value: value ?? '',
			select(val: string) {
				value = val;
				onchange?.({ value: val });
			},
		});
		setContext<MenuRadioContext>('menu-radio', radioCtx);

		$effect(() => {
			radioCtx.value = value ?? '';
		});
	}

	/* ------------------------------------------------------------------ */
	/*  Item registration                                                  */
	/* ------------------------------------------------------------------ */
	let itemEl = $state<HTMLElement | undefined>(undefined);

	if (!isContainer) {
		onMount(() => {
			if (parentMenuContext && itemEl) {
				parentMenuContext.registerItem(itemEl);
			}
			return () => {
				if (parentMenuContext && itemEl) {
					parentMenuContext.unregisterItem(itemEl);
				}
			};
		});
	}

	/* ------------------------------------------------------------------ */
	/*  Keyboard navigation (container)                                    */
	/* ------------------------------------------------------------------ */
	let typeAheadBuffer = $state('');
	let typeAheadTimeout: ReturnType<typeof setTimeout> | undefined;

	function getMenuItems(menuEl: HTMLElement): HTMLElement[] {
		return Array.from(
			menuEl.querySelectorAll<HTMLElement>(
				'[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemcheckbox"]:not([aria-disabled="true"]), [role="menuitemradio"]:not([aria-disabled="true"])',
			),
		);
	}

	function focusItem(menuEl: HTMLElement, direction: 'first' | 'last' | 'next' | 'prev') {
		const allItems = getMenuItems(menuEl);
		if (allItems.length === 0) return;

		const activeEl = document.activeElement as HTMLElement;
		const currentIdx = allItems.indexOf(activeEl);

		let targetIdx: number;
		if (direction === 'first') {
			targetIdx = 0;
		} else if (direction === 'last') {
			targetIdx = allItems.length - 1;
		} else if (direction === 'next') {
			targetIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % allItems.length;
		} else {
			targetIdx =
				currentIdx === -1 ? allItems.length - 1 : (currentIdx - 1 + allItems.length) % allItems.length;
		}
		allItems[targetIdx]?.focus();
	}

	function handleTypeAhead(menuEl: HTMLElement, char: string) {
		clearTimeout(typeAheadTimeout);
		typeAheadBuffer += char.toLowerCase();
		typeAheadTimeout = setTimeout(() => {
			typeAheadBuffer = '';
		}, 300);

		const allItems = getMenuItems(menuEl);
		const match = allItems.find((el) =>
			el.textContent?.trim().toLowerCase().startsWith(typeAheadBuffer),
		);
		if (match) match.focus();
	}

	function onMenuKeyDown(e: KeyboardEvent) {
		const menuEl = e.currentTarget as HTMLElement;

		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				focusItem(menuEl, 'next');
				break;
			case 'ArrowUp':
				e.preventDefault();
				focusItem(menuEl, 'prev');
				break;
			case 'Home':
				e.preventDefault();
				focusItem(menuEl, 'first');
				break;
			case 'End':
				e.preventDefault();
				focusItem(menuEl, 'last');
				break;
			case 'Escape':
				e.preventDefault();
				if (parentMenuContext) {
					parentMenuContext.close();
				} else {
					open = false;
				}
				break;
			default:
				if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
					e.preventDefault();
					handleTypeAhead(menuEl, e.key);
				}
				break;
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Item actions                                                       */
	/* ------------------------------------------------------------------ */
	function handleItemClick() {
		if (disabled) return;
		onclick?.();
		if (parentMenuContext?.close_on_select) {
			parentMenuContext.close();
		}
	}

	function handleCheckboxClick() {
		if (disabled) return;
		checked = !checked;
		onchange?.({ checked });
		if (parentMenuContext?.close_on_select) {
			parentMenuContext.close();
		}
	}

	function handleRadioClick() {
		if (disabled || !parentRadioContext || typeof value !== 'string') return;
		parentRadioContext.select(value);
		if (parentMenuContext?.close_on_select) {
			parentMenuContext.close();
		}
	}

	function onItemKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			(e.currentTarget as HTMLElement).click();
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Size map                                                           */
	/* ------------------------------------------------------------------ */
	const sizeMap: Record<string, string> = {
		'0': '0.75rem',
		'1': '0.875rem',
		'2': '1rem',
		'3': '1.125rem',
	};

	const resolvedSize = $derived(parentMenuContext ? parentMenuContext.size : size);

	/* ------------------------------------------------------------------ */
	/*  Derived state for radio items                                      */
	/* ------------------------------------------------------------------ */
	const isRadioSelected = $derived(
		isRadioItem && parentRadioContext ? parentRadioContext.value === value : false,
	);
</script>

{#if isContainer}
	<!-- Menu Container -->
	<Popover
		refElement={trigger}
		bind:opened={open}
		openOnClick
		arrow={false}
		{placement}
		closeOnInsideClick={false}
		disableInitialFocus>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div
			{id}
			class={['menu', className].filter(Boolean).join(' ')}
			role="menu"
			tabindex={0}
			aria-label={label}
			style:font-size={sizeMap[size] ?? sizeMap['1']}
			onkeydown={onMenuKeyDown}>
			{@render children?.()}
		</div>
	</Popover>
{:else if isSeparator}
	<!-- MenuSeparator -->
	<div class="menu-separator" role="separator"></div>
{:else if isGroup}
	<!-- MenuGroup -->
	<div class="menu-group" role="group" aria-label={label}>
		<div class="menu-group-label">{label}</div>
		{@render children?.()}
	</div>
{:else if isRadioGroup}
	<!-- MenuRadioGroup -->
	<div class="menu-radio-group" role="group">
		{@render children?.()}
	</div>
{:else if isCheckboxItem}
	<!-- MenuCheckboxItem -->
	<div
		bind:this={itemEl}
		class={['menu-item', className].filter(Boolean).join(' ')}
		class:disabled
		role="menuitemcheckbox"
		aria-checked={checked}
		aria-disabled={disabled || undefined}
		tabindex={disabled ? -1 : 0}
		onclick={handleCheckboxClick}
		onkeydown={onItemKeyDown}>
		<span class="menu-item-indicator">
			{#if checked}
				<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
					<path d="M2.5 7.5L5.5 10.5L11.5 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			{/if}
		</span>
		<span class="menu-item-content">
			{@render children?.()}
		</span>
	</div>
{:else if isRadioItem}
	<!-- MenuRadioItem -->
	<div
		bind:this={itemEl}
		class={['menu-item', className].filter(Boolean).join(' ')}
		class:disabled
		role="menuitemradio"
		aria-checked={isRadioSelected}
		aria-disabled={disabled || undefined}
		tabindex={disabled ? -1 : 0}
		onclick={handleRadioClick}
		onkeydown={onItemKeyDown}>
		<span class="menu-item-indicator">
			{#if isRadioSelected}
				<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
					<circle cx="7" cy="7" r="3.5" fill="currentColor" />
				</svg>
			{/if}
		</span>
		<span class="menu-item-content">
			{@render children?.()}
		</span>
	</div>
{:else if isItem}
	<!-- MenuItem -->
	<div
		bind:this={itemEl}
		{id}
		class={['menu-item', className].filter(Boolean).join(' ')}
		class:danger
		class:disabled
		role="menuitem"
		aria-disabled={disabled || undefined}
		tabindex={disabled ? -1 : 0}
		onclick={handleItemClick}
		onkeydown={onItemKeyDown}>
		<span class="menu-item-content">
			{@render children?.()}
		</span>
		{#if badge !== undefined}
			<span class="menu-item-badge">{badge}</span>
		{/if}
		{#if shortcut}
			<span class="menu-item-shortcut">{shortcut}</span>
		{/if}
	</div>
{/if}

<style>
	/* ========== Menu Container ========== */
	.menu {
		min-width: 180px;
		max-width: 300px;
		padding: 0.25rem;
	}

	/* ========== MenuItem ========== */
	.menu-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-sm, 0.25rem);
		cursor: pointer;
		transition: background 100ms ease;
		user-select: none;
		outline: none;
		color: var(--color-text, inherit);
		font-size: inherit;

		&:hover,
		&:focus-visible {
			background: light-dark(var(--color-bg-subtle, #f5f5f5), var(--color-bg-subtle, #1a1a1a));
			outline: none;
		}

		&.danger {
			color: var(--color-error, #d32f2f);
		}

		&.disabled {
			opacity: 0.5;
			pointer-events: none;
		}
	}

	.menu-item-content {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.menu-item-shortcut {
		flex-shrink: 0;
		font-size: 0.8em;
		color: var(--color-text-muted, #888);
		margin-left: auto;
	}

	.menu-item-badge {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--color-accent, #1976d2);
		color: var(--color-accent-text, #fff);
		border-radius: var(--radius-round, 9999px);
		font-size: 0.7em;
		line-height: 1;
		padding: 0.15em 0.45em;
		min-width: 1.35em;
		min-height: 1.35em;
		font-weight: 600;
		margin-left: auto;
	}

	.menu-item-indicator {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		flex-shrink: 0;
	}

	/* ========== MenuSeparator ========== */
	.menu-separator {
		height: 1px;
		background: var(--color-border, light-dark(#e0e0e0, #333));
		margin: 0.25rem 0;
	}

	/* ========== MenuGroup ========== */
	.menu-group-label {
		padding: 0.375rem 0.75rem;
		font-size: 0.75em;
		font-weight: 500;
		color: var(--color-text-muted, #888);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		user-select: none;
	}

	/* ========== MenuRadioGroup ========== */
	.menu-radio-group {
		display: contents;
	}
</style>
