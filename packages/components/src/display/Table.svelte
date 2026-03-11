<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { untrack, type Snippet } from 'svelte';
	import { Entities } from '$lib/state';
	import {
		formatToString,
		intersect,
		pointerupOverride,
		ripple,
		seededRandom,
		selectable as selectableLib,
		sortable,
	} from '@packages/lib';
	import Button from '../form/Button.svelte';
	import Link from './Link.svelte';
	import ChevronDown from '~icons/mdi/chevron-down';
	import UpFolderIcon from '~icons/material-symbols/drive-folder-upload';
	import UploadIcon from '~icons/material-symbols/cloud-upload';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { dashboardLink } from './Link.svelte';
	import { getContext } from 'svelte';
	import PlusIcon from '~icons/material-symbols/add-circle';
	import { browser } from '$app/environment';
	import type Selecto from 'selecto';
	import DragIcon from '~icons/material-symbols/drag-indicator';
	import type { Placement } from '@floating-ui/dom';

	type ListData = $$Generic<object>;
	type TableColumn = {
		/** The unique id of the column. Used for keyed each */
		id: string;

		/** The header to show for the column */
		name?: string;

		/** How the cell value should be formatted */
		type?:
			| 'text'
			| 'date'
			| 'number'
			| 'currency'
			| 'storage'
			| 'profile'
			| 'status'
			| 'projectName'
			| 'projectThumbnail'
			| 'clientName'
			| 'mediaThumbnail';

		/** Whether the column is sortable or not */
		sortable?: boolean;

		/** Whether the column can be collapsed into a dropdown (during mobile view) */
		collapsable?: boolean;
	} & (
		| {
				/** The key used to access the data from the object in the list */
				key: keyof ListData;
		  }
		| {
				/** The function that should return the value of the cell for this row/column */
				getFn: (row: ListData) => any;
		  }
		| {
				/** The snippet that should be used to render the cell */
				snippet: Snippet<[ListData, TableColumn]>;
		  }
	);

	type TableActionItem = {
		/** The text to show in the button */
		text: string;
		/** Where the create new button should be placed. @default 'top' */
		location?: 'top' | 'bottom';

		/** The icon to show in the button @default 'plus' */
		icon?: 'plus' | 'up-folder' | 'upload';
	} & (
		| {
				/** The path that should be navigated to when the create new row button is clicked */
				href: string;
		  }
		| {
				/** The callback function for when the create new row button is clicked */
				click: () => void;
		  }
	);

	let {
		/** The pre-sorted/pre-filtered list of data to show in the table */
		list = [] as Readonly<ListData[]>,
		/** The size of the cells */
		size = $bindable(4) as number,
		/** The list of columns to display */
		columns = [] as TableColumn[],
		/** Add an action button (like "Create New") row before the real rows for creating a new row */
		action = undefined as TableActionItem | undefined,
		/** The message to show when there are no items in the list */
		noItemsMessage = 'No items',
		/** The field that is currently sorted */
		sortField = undefined as string | undefined,
		/** The direction that the sortField is sorted */
		sortDirection = 'ASC' as 'ASC' | 'DESC',
		/** Whether placeholder graphics should be shown when loading the list */
		showPlaceholders = false,
		/** The number of placeholders to show (is showPlaceholders is true) */
		numPlaceholders = 20,
		/** Whether the table rows should be selectable. A function can be provided to determine selectability by row */
		selectable = false as boolean | ((item: ListData) => boolean),
		/** The set of indexes of the currently selected elements */
		selection = $bindable(new SvelteSet<number>()) as Set<number>,
		/** Whether or not the list of items can be reordered by dragging/dropping */
		reorderable = false,
		/** Whether the special responsive mobile view should be disabled and the traditional table should be shown on mobile */
		disableMobileView = false,
		/** The function that determines the href the row should be linked to */
		href = ((row: ListData) => {
			return !row
				? ''
				: 'entity' in row && 'id' in row
					? `/${row.entity}/${row.id}`
					: '_entity' in row && '_id' in row
						? `/${row._entity}/${row._id}`
						: '';
		}) as ((row: ListData) => string) | null,
		/** The css style string added to the component from the parent */
		style = '',
		/** Specifies a custom class name for the container element */
		class: className = '',
		/** Emits the value of the row that was clicked */
		onclick = undefined as ((row: ListData) => void) | undefined,
		/** Emits when the user attempts to sort the data using the table headers */
		onsort = undefined as
			| ((sort: { field: string; direction: 'ASC' | 'DESC' }) => void)
			| undefined,
		/** Emits the set of indexes of the selected elements when the selection changes */
		onselect = undefined as ((selected: Set<number>) => void) | undefined,
		/** Called when the user reorders the list (via drag/drop) */
		onreorder = undefined as
			| ((oldIndex: number, newIndex: number, selected: Set<number>) => void)
			| undefined,
		/** Called when the user scrolls down and the list should load more (if any more items are available) */
		onloadmore = undefined as (() => void) | undefined,
	} = $props();

	const entities = getContext<Entities>('entities');
	const hasSelection = $derived(selection.size > 0);
	const expanded = new SvelteSet<string>();
	let amountToLoad = $state(100);
	let innerWidth = $state(0);
	let tbodyElement = $state<HTMLElement | undefined>();
	let draggableMirrorContainer = $state<HTMLElement | undefined>();
	let selecto = $state<Selecto | undefined>();
	const listIDs = $derived(
		list
			.map((item) => ('id' in item ? item.id : '_id' in item ? item._id : undefined))
			.map((id, i, array) => {
				const numDuplicates = array.slice(0, i).filter((v) => v === id).length;
				return `${id},${numDuplicates + 1}`;
			}),
	);

	function onSort(field: string) {
		if (!onsort) return;
		onsort({
			field,
			direction:
				sortField !== field ? sortDirection : sortDirection === 'ASC' ? 'DESC' : 'ASC',
		});
	}
	function getCellValue(column: TableColumn, row: ListData) {
		if ('key' in column) {
			return row[column.key];
		} else if ('getFn' in column) {
			return column.getFn(row);
		}
	}
	function onActionButtonClick() {
		if (action && 'click' in action) {
			action.click();
		}
	}

	$effect(() => {
		if (!selecto || !tbodyElement) return;
		selection;
		untrack(() => {
			if (!selecto || !tbodyElement) return;
			const elements = Array.from(
				tbodyElement.querySelectorAll('.item'),
			) as HTMLElement[];
			elements.forEach((el, i) => {
				if (selection.has(i)) el.classList.add('selected');
				else el.classList.remove('selected');
			});
			selecto.setSelectedTargets(elements.filter((el, i) => selection.has(i)));
		});
	});

	function selectableAction(element: HTMLElement) {
		if (!selectable) return {};
		const action = selectableLib(element, {
			selectableTargets: [
				() => {
					return Array.from(element.querySelectorAll('.selectable')) as HTMLElement[];
				},
			],
			selectByClick: !reorderable,
			preventDefault: !reorderable,
			selectFromInside: !reorderable,
			toggleContinueSelect: 'ctrl',
			toggleContinueSelectWithoutDeselect: 'shift',
			onDragStart: () => {
				if (reorderable) return;
				element.style.pointerEvents = 'none';
				element.classList.add('selecting');
			},
			onDragEnd: () => {
				if (reorderable) return;
				element.style.removeProperty('pointer-events');
				element.classList.remove('selecting');
			},
			onSelect: (e) => {
				const elements = Array.from(element.querySelectorAll('.item')) as Element[];
				e.added.forEach((el) => {
					const index = elements.indexOf(el);
					if (index > -1) {
						selection.add(index);
					} else {
						selection.delete(index);
					}
				});
				e.removed.forEach((el) => {
					const index = elements.indexOf(el);
					if (index > -1) selection.delete(index);
				});
				if (onselect) onselect(selection);
			},
		});
		action.selecto.then((v) => (selecto = v));
		return action;
	}
</script>

<svelte:window bind:innerWidth />

<div class="draggable-mirrors" bind:this={draggableMirrorContainer}></div>

{#if !browser && showPlaceholders}
	<table
		style:--size={size}
		{style}
		class="desktop-placeholder {className ? ` ${className}` : ''}">
		<tbody>
			{#each new Array(numPlaceholders) as _, i}
				<tr class="placeholder">
					{#each columns as column, j (column.id)}
						<td
							class:graphic-cell={column.type === 'profile' ||
								column.type === 'status' ||
								column.type === 'mediaThumbnail' ||
								column.type === 'projectThumbnail'}>
							{#if column.type === 'profile'}
								<div class="profile"></div>
							{:else if column.type === 'status'}
								<div class="status"></div>
							{:else if column.type === 'mediaThumbnail'}
								<div class="media-thumbnail"></div>
							{:else if column.type === 'projectThumbnail'}
								<div class="project-thumbnail"></div>
							{:else if column.type && column.type !== 'text'}
								<span>⠀⠀⠀⠀⠀⠀⠀⠀⠀</span>
							{:else}
								<span>
									{new Array(Math.floor(seededRandom((i + 1) * (j + 1)) * 7 + 10))
										.fill('⠀')
										.join('')}
								</span>
							{/if}
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
	<div class="mobile-placeholder list">
		{#each new Array(numPlaceholders) as _, i}
			<div class="item">
				{#if reorderable}
					<div class="drag-handle">
						<DragIcon />
					</div>
				{/if}
				<div class="columns">
					{#each columns.slice(0, 3) as column, j (column.id)}
						{@const isGraphic =
							column.type === 'profile' ||
							column.type === 'status' ||
							column.type === 'mediaThumbnail' ||
							column.type === 'projectThumbnail'}
						<div
							class="column"
							class:rounded={column.type === 'profile' || column.type === 'status'}
							class:graphic={isGraphic}>
							{#if !isGraphic && column.type && column.type !== 'text'}
								<span>⠀⠀⠀⠀⠀⠀⠀⠀⠀</span>
							{:else if !isGraphic}
								<span>
									{new Array(Math.floor(seededRandom((i + 1) * (j + 1)) * 7 + 10))
										.fill('⠀')
										.join('')}
								</span>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/each}
	</div>
{:else if innerWidth < 1024 && !disableMobileView}
	{#if reorderable}
		<div
			class="list"
			use:sortable={{
				draggable: '.item',
				handle: '.drag-handle',
				delay: 0,
				mirror: {
					constrainDimensions: true,
					yAxis: true,
					xAxis: false,
				},
				onSortStop: ({ oldIndex, newIndex }) => {
					onreorder && onreorder(oldIndex, newIndex, selection);
				},
			}}>
			{#if action && action.location !== 'bottom'}
				<div class="action">
					{@render mobileListAction()}
				</div>
			{/if}
			{#each listIDs.slice(0, amountToLoad) as id, i (id)}
				<div class="item">
					{#if reorderable}
						<div class="drag-handle">
							<DragIcon />
						</div>
					{/if}
					{@render mobileListItem(id, i)}
				</div>
			{/each}
			{#if list.length === 0 && !action && noItemsMessage && browser}
				<div class="action">
					{noItemsMessage}
				</div>
			{/if}
			{#if action && action.location === 'bottom'}
				<div class="action">
					{@render mobileListAction()}
				</div>
			{/if}
		</div>
	{:else}
		<div class="list">
			{#if action && action.location !== 'bottom'}
				<div class="action">
					{@render mobileListAction()}
				</div>
			{/if}
			{#each listIDs.slice(0, amountToLoad) as id, i (id)}
				<div class="item">
					{@render mobileListItem(id, i)}
				</div>
			{/each}
			{#if list.length === 0 && !action && noItemsMessage && browser}
				<div class="action">
					{noItemsMessage}
				</div>
			{/if}
			{#if action && action.location === 'bottom'}
				<div class="action">
					{@render mobileListAction()}
				</div>
			{/if}
		</div>
	{/if}
	{#snippet mobileListAction()}
		{#if action}
			<Button
				transparent
				fullWidth
				fullHeight
				round={false}
				href={'href' in action ? action.href : undefined}
				onclick={() => {
					if ('click' in action) action.click();
				}}>
				{action.text}
			</Button>
		{/if}
	{/snippet}
	{#snippet mobileListItem(id: string, i: number)}
		{@const url: any = (href && href(list[i])) || undefined}
		<Link href={url}>
			{#snippet child(href)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<svelte:element
					this={href ? 'a' : onclick ? 'button' : 'div'}
					{href}
					onclick={(e: MouseEvent) => {
						onclick && onclick(list[i]);
					}}
					use:pointerupOverride
					class="columns"
					use:ripple={{ enabled: !!href || !!onclick }}>
					{#each columns as column (column.id)}
						{@const cellValue = getCellValue(column, list[i])}
						{@const isGraphic =
							column.type === 'profile' ||
							column.type === 'status' ||
							column.type === 'mediaThumbnail' ||
							column.type === 'projectThumbnail'}
						{#if cellValue || isGraphic}
							<div class="column" class:graphic={isGraphic}>
								{#if column.name && !isGraphic}
									<small>{column.name}</small>
								{/if}
								<div class="value">
									{@render cell(column, list[i], cellValue)}
								</div>
							</div>
						{/if}
					{/each}
				</svelte:element>
			{/snippet}
		</Link>
		<Button
			transparent
			size="0"
			icon
			onclick={(e) => {
				let element = e.currentTarget as HTMLElement;
				while (!element.classList.contains('item')) {
					element = element.parentElement as HTMLElement;
				}
				const columns = element?.querySelector('.columns') as HTMLElement;
				const doesntNeedToExpand = columns.clientHeight < 16 * 4;
				if (columns) {
					if (expanded.has(id) || doesntNeedToExpand) {
						element.style.removeProperty('height');
					} else {
						element.style.height = columns.clientHeight + 24 + 'px';
					}
				}
				if (expanded.has(id)) expanded.delete(id);
				else if (!doesntNeedToExpand) expanded.add(id);
			}}>
			<ChevronDown
				class="animate-rotation"
				style="transition: transform 250ms var(--easing); {expanded.has(id)
					? 'transform:rotate(180deg);'
					: ''}" />
		</Button>
	{/snippet}
{:else}
	<table style:--size={size} {style} class={className} class:has-selection={hasSelection}>
		<thead>
			<tr>
				{#each columns as column (column.id)}
					<th
						class:graphic-header={column.type === 'profile' || column.type === 'status'}>
						{#if column.name}
							{#if !column.sortable}
								{column.name}
							{:else}
								<Button dense transparent onclick={() => onSort(column.id)}>
									{column.name}
									{#if sortField === column.id}
										<ChevronDown
											style="transition: transform 250ms var(--easing); {sortDirection ===
											'ASC'
												? 'transform:rotate(180deg);'
												: ''}" />
									{/if}
								</Button>
							{/if}
						{/if}
					</th>
				{/each}
			</tr>
		</thead>

		{#if !reorderable}
			<tbody use:selectableAction>{@render tbody()}</tbody>
		{:else}
			{#key listIDs}
				<tbody
					bind:this={tbodyElement}
					class="reorderable"
					use:selectableAction
					use:sortable={{
						draggable: '.item',
						mirror: {
							constrainDimensions: true,
							yAxis: true,
							xAxis: false,
							appendTo: draggableMirrorContainer,
						},
						onSortStop: ({ oldIndex, newIndex }) => {
							onreorder && onreorder(oldIndex, newIndex, selection);
						},
					}}>
					{@render tbody()}
				</tbody>
			{/key}
		{/if}
	</table>
{/if}

{#snippet actionTr()}
	{#if action}
		<tr use:ripple={{ zIndex: 1, append: true }} onclick={onActionButtonClick}>
			<td colspan={columns.length} style="padding: 0;" class="create-new">
				<svelte:element
					this={'href' in action && action.href ? 'a' : 'div'}
					href={'href' in action && action.href ? action.href : undefined}
					data-sveltekit-noscroll={'href' in action &&
						action.href &&
						action.href.startsWith('?')}
					style="display: flex; align-items: center; justify-content: center; height: var(--row-height, 100%); gap: .5rem">
					{action.text}
					{#if !action.icon || action.icon === 'plus'}
						<PlusIcon />
					{:else if action.icon === 'up-folder'}
						<UpFolderIcon />
					{:else if action.icon === 'upload'}
						<UploadIcon />
					{/if}
				</svelte:element>
			</td>
		</tr>
	{/if}
{/snippet}

{#snippet tbody()}
	{#if action && action.location !== 'bottom'}
		{@render actionTr()}
	{/if}
	{#if showPlaceholders}
		{#each new Array(numPlaceholders) as _, i}
			<tr class="placeholder">
				{#each columns as column, j (column.id)}
					<td
						class:graphic-cell={column.type === 'profile' ||
							column.type === 'status' ||
							column.type === 'mediaThumbnail' ||
							column.type === 'projectThumbnail'}>
						{#if column.type === 'profile'}
							<div class="profile"></div>
						{:else if column.type === 'status'}
							<div class="status"></div>
						{:else if column.type === 'mediaThumbnail'}
							<div class="media-thumbnail"></div>
						{:else if column.type === 'projectThumbnail'}
							<div class="project-thumbnail"></div>
						{:else if column.type && column.type !== 'text'}
							<span>⠀⠀⠀⠀⠀⠀⠀⠀⠀</span>
						{:else}
							<span>
								{new Array(Math.floor(seededRandom((i + 1) * (j + 1)) * 7 + 10))
									.fill('⠀')
									.join('')}
							</span>
						{/if}
					</td>
				{/each}
			</tr>
		{/each}
	{:else if reorderable}
		{#each listIDs as id, i (id)}
			<tr
				class="item"
				class:selected={selection.has(i)}
				class:selectable={selectable === true ||
					(typeof selectable === 'function' && selectable(list[i]))}
				data-id={id}>
				{@render tds(list[i])}
			</tr>
		{/each}
	{:else}
		{#each listIDs.slice(0, amountToLoad) as id, i (id)}
			<tr
				class="item"
				class:selected={selection.has(i)}
				class:selectable={selectable === true ||
					(typeof selectable === 'function' && selectable(list[i]))}
				onmousedown={(e) => {
					if (e.button == 1 || e.buttons == 4) e.preventDefault();
				}}
				onmouseup={(e) => {
					if (e.button == 1 || e.buttons == 4) {
						e.preventDefault();
						if (onclick) onclick(list[i]);
						if (!href) return;
						const url = href(list[i]);
						if (!url) return;
						window.open(url, '_blank');
					}
				}}
				onclick={() => {
					if (onclick) onclick(list[i]);
					if (!href) return;
					const url = href(list[i]);
					if (!url) return;
					goto(url, { noScroll: href(list[i]).startsWith('?') });
				}}
				use:ripple={{ zIndex: 1, append: true, enabled: !!onclick || !!href }}>
				{@render tds(list[i])}
			</tr>
		{/each}
	{/if}
	{#if list.length === 0 && !action && noItemsMessage && browser}
		<tr class="no-items">
			<td colspan={columns.length} style="text-align:center; height: 8rem;">
				{noItemsMessage}
			</td>
		</tr>
	{/if}
	{#if action && action.location === 'bottom'}
		{@render actionTr()}
	{/if}
{/snippet}

{#snippet tds(item: ListData)}
	{#each columns as column, i (column.id)}
		{@const cellValue = getCellValue(column, item)}
		<td
			class:graphic-cell={column.type === 'profile' ||
				column.type === 'status' ||
				column.type === 'mediaThumbnail' ||
				column.type === 'projectThumbnail'}
			class:currency={column.type === 'currency'}
			class:last-cell={i === columns.length - 1}>
			{@render cell(column, item, cellValue, i === columns.length - 1 ? 'right' : 'left')}
		</td>
	{/each}
{/snippet}

{#snippet cell(
	column: TableColumn,
	item: ListData,
	cellValue: any,
	popoverPlacement?: Placement,
)}
	{#if 'snippet' in column}
		{@render column.snippet(item, column)}
	{:else if column.type === 'date'}
		{#if cellValue !== null && cellValue !== undefined}
			{formatToString(cellValue as Date, { type: 'date' })}
		{/if}
	{:else if column.type === 'currency'}
		{#if cellValue !== null && cellValue !== undefined}
			{@html formatToString(cellValue as string, { type: 'currency', html: true })}
		{/if}
	{:else if column.type === 'storage'}
		{#if cellValue !== null && cellValue !== undefined}
			{formatToString(cellValue as number, { type: 'storage' })}
		{/if}
	{:else if column.type === 'number'}
		{#if cellValue !== null && cellValue !== undefined}
			{formatToString(cellValue as number, { type: 'number' })}
		{/if}
	{:else}
		{cellValue}
	{/if}
{/snippet}

{#if !reorderable}
	<div
		class="load-more"
		use:intersect={{
			rootMargin: '0px 0px 200% 0px',
			onintersectchange: (e) => {
				if (e.isIntersecting) {
					onloadmore && onloadmore();
					amountToLoad += 100;
				}
			},
		}}>
	</div>
{/if}

<style lang="scss">
	.list {
		display: flex;
		flex-direction: column;
		border-radius: var(--radius-3);
		border: solid 1px var(--c-outline);

		&.mobile-placeholder {
			width: 100%;
			pointer-events: none;
			:global() {
				@keyframes shimmer {
					100% {
						transform: translateX(100%);
					}
				}
			}
			.item {
				.column {
					&.graphic {
						position: relative;
						overflow: hidden;
						width: calc(var(--height) - 1rem);
						height: calc(var(--height) - 1rem);
						border-radius: var(--radius-3);
						margin: 0.5rem 0;
						&.rounded {
							border-radius: var(--radius-round);
						}
						background-color: var(--c-bg-active);
						&::after {
							position: absolute;
							top: 0;
							right: 0;
							bottom: 0;
							left: 0;
							transform: translateX(-100%);
							background-image: linear-gradient(
								90deg,
								rgba(white, 0) 0,
								rgba(white, 0.2) 20%,
								rgba(white, 0.5) 60%,
								rgba(white, 0)
							);
							background-image: linear-gradient(
								90deg,
								rgb(from var(--c-text) r g b / 0) 0,
								rgb(from var(--c-text) r g b / 0.1) 20%,
								rgb(from var(--c-text) r g b / 0.2) 60%,
								rgb(from var(--c-text) r g b / 0)
							);
							animation: shimmer 2s infinite;
							content: '';
						}
					}
					span {
						background-color: var(--c-bg-active);
						border-radius: var(--radius-round);
						position: relative;
						overflow: hidden;
						display: inline-block;
						&::after {
							position: absolute;
							top: 0;
							right: 0;
							bottom: 0;
							left: 0;
							transform: translateX(-100%);
							background-image: linear-gradient(
								90deg,
								rgba(white, 0) 0,
								rgba(white, 0.2) 20%,
								rgba(white, 0.5) 60%,
								rgba(white, 0)
							);
							background-image: linear-gradient(
								90deg,
								rgb(from var(--c-text) r g b / 0) 0,
								rgb(from var(--c-text) r g b / 0.1) 20%,
								rgb(from var(--c-text) r g b / 0.2) 60%,
								rgb(from var(--c-text) r g b / 0)
							);
							animation: shimmer 2s infinite;
							content: '';
						}
					}
				}
			}
		}

		.action {
			display: flex;
			align-items: center;
			justify-content: center;
			&:first-child:last-child {
				height: 8rem;
			}
		}

		.item {
			display: flex;
			width: 100%;
			--height: 3.5rem;
			height: var(--height);
			transition: height 200ms ease;
			overflow: hidden;
			padding-left: 0.5rem;
			position: relative;
			background-color: var(--c-bg);
			&:first-child {
				border-top-left-radius: var(--radius-3);
				border-top-right-radius: var(--radius-3);
			}
			&:last-child {
				border-bottom-left-radius: var(--radius-3);
				border-bottom-right-radius: var(--radius-3);
			}
			&:not(:last-child) {
				border-bottom: solid 1px color-mix(in oklch, transparent, var(--c-text) 6%);
			}

			.drag-handle {
				display: flex;
				align-items: center;
				justify-content: center;
				width: 2rem;
				height: var(--height);
				cursor: grab;
			}
			:global(.draggable-source--is-dragging) {
				cursor: grabbing;
			}
			:global(.columns) {
				flex: 1;
				display: flex;
				flex-wrap: wrap;
				align-items: center;
				gap: 1rem 0;
				height: fit-content;
				text-align: left;
				color: var(--c-text);
			}
			:global(.column:not(.graphic)) {
				display: flex;
				flex-direction: column;
				line-height: 1.1rem;
				justify-content: center;
				padding: 0 1rem;
			}
			:global(.column.graphic) {
				--graphic-height: calc(var(--height) - 1rem);
				:global(.profile) {
					width: var(--graphic-height);
					height: var(--graphic-height);
					margin-top: calc((var(--height) - var(--graphic-height)) / 2);
				}
				:global(.status) {
					width: var(--graphic-height);
					height: var(--graphic-height);
					margin-top: calc((var(--height) - var(--graphic-height)) / 2);
				}
				:global(.project-thumbnail) {
					width: var(--graphic-height);
					height: var(--graphic-height);
					margin-top: calc((var(--height) - var(--graphic-height)) / 2);
					border-radius: var(--radius-3);
					display: flex;
				}
				:global(.media-thumbnail) {
					width: var(--graphic-height);
					height: var(--graphic-height);
					margin-top: calc((var(--height) - var(--graphic-height)) / 2);
				}
			}
		}
	}

	table {
		--radius: var(--radius-4);
		--row-height: calc(17rem / max(2, min(6, var(--size, 4))));
		width: 100%;
		border: none;
		border: solid 1px var(--c-outline);
		border-radius: var(--radius);
		padding: 0.5rem;
		border-spacing: 0px;
		container-type: inline-size;
		&:global(:has(.draggable-container--is-dragging)) {
			cursor: grabbing;
		}
		&.has-selection {
			:global(.item:not(.selected)) {
				opacity: 0.75;
			}
		}
	}
	.graphic-cell {
		width: 0;
		height: var(--row-height);
		transition:
			width 200ms ease,
			height 200ms ease;
		:global(.profile) {
			width: 70%;
			aspect-ratio: 1 / 1;
			margin: 0 auto;
		}
		:global(.status) {
			width: 70%;
			aspect-ratio: 1 / 1;
			margin: 0 auto;
		}
		:global(.project-thumbnail) {
			width: auto;
			height: 90%;
			aspect-ratio: 1 / 1;
			margin-right: calc(3rem / max(2, min(6, var(--size, 4))));
			margin-left: calc(2rem / (max(2, min(6, 6 - var(--size, 4)))));
			border-radius: 12%;
			display: flex;
		}
		:global(.media-thumbnail) {
			height: 90%;
			aspect-ratio: 1 / 1;
			margin: 0 0.75rem;
		}
	}
	.graphic-header {
		width: var(--row-height);
		transition: width 200ms ease;
	}

	.draggable-mirrors {
		z-index: 2;
		position: relative;
		:global(.draggable-mirror) {
			background-color: transparent;
			border: solid 2px var(--c-outline-active);
			border-radius: var(--radius-4);
			opacity: 1;
			display: flex;
			z-index: 1;
			cursor: grabbing;
			:global(.ripple) {
				display: none;
			}
			:global(td) {
				display: none;
			}
		}
	}

	tbody {
		&:global(.draggable-container--is-dragging) {
			:global(.ripple) {
				display: none;
			}
			:global(.item) {
				cursor: grabbing !important;
			}
			:global(.item.selected:not(.draggable-source--is-dragging)) {
				opacity: 0.35;
			}
		}
		&.reorderable {
			:global(.item) {
				cursor: grab;
			}
			:global(.item td > *) {
				pointer-events: none;
			}
		}
		:global(tr) {
			position: relative;
			border: none;
			border-top: solid 1px var(--c-outline);
			background-color: transparent;
			overflow: hidden;
			border-radius: var(--radius-4);
			height: var(--row-height);
			outline-offset: 8px;
			transition:
				height 200ms ease,
				outline-offset 200ms ease,
				opacity 200ms ease,
				background-color 150ms ease,
				color 150ms ease;
		}
		:global(tr:not(.no-items)) {
			cursor: pointer;
		}
		:global(tr:not(.no-items):hover td) {
			background-color: var(--c-bg-active);
		}

		:global(tr.selected) {
			background-color: var(--c-bg-active);
			outline: solid 1px var(--c-outline);
			outline-offset: -1px;
			color: var(--c-text-active);
		}

		:global(tr.draggable-source--is-dragging) {
			background-color: var(--c-bg-active);
			cursor: grabbing;
		}
		:global(td) {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			max-width: min(200px, 25cqw);
		}
		:global(td:first-child:not(.graphic-cell)) {
			padding: 0 0 0 1rem;
		}
		:global(td:first-child) {
			border-top-left-radius: var(--radius-4);
			border-bottom-left-radius: var(--radius-4);
		}
		:global(td:last-child),
		:global(td.last-cell) {
			border-top-right-radius: var(--radius-4);
			border-bottom-right-radius: var(--radius-4);
		}
		:global(td.create-new::after) {
			content: '';
			position: absolute;
			top: calc((var(--row-height) - 1rem) / 10);
			bottom: calc((var(--row-height) - 1rem) / 10);
			right: calc((var(--row-height) - 1rem) / 10);
			left: calc((var(--row-height) - 1rem) / 10);
			border-radius: var(--radius-4);
			border: dashed 1px var(--c-outline-disabled);
			pointer-events: none;
		}
		:global(.currency) {
			font-size: 1.25em;
			line-height: 1.25em;
		}
		:global(.currency .symbol),
		:global(.currency .fraction),
		:global(.currency .decimal) {
			font-size: max(0.5em, 0.75rem);
			vertical-align: text-top;
		}
		:global(.currency .symbol) {
			color: var(--c-text-disabled);
			padding: 0 0.15em 0 0;
		}
	}
	th {
		text-align: left;
		&:first-child {
			padding-left: 0.5rem;
		}
		&:not(:first-child) {
			:global(> .button) {
				margin-left: -0.75rem;
			}
		}
	}
	td {
		border: none;
		background-color: transparent;
	}
	.placeholder {
		overflow: hidden;
		position: relative;
		pointer-events: none;
		:global() {
			@keyframes shimmer {
				100% {
					transform: translateX(100%);
				}
			}
		}
		td {
			span {
				background-color: var(--c-bg-active);
				border-radius: var(--radius-round);
				position: relative;
				overflow: hidden;
				display: inline-block;
				&::after {
					position: absolute;
					top: 0;
					right: 0;
					bottom: 0;
					left: 0;
					transform: translateX(-100%);
					background-image: linear-gradient(
						90deg,
						rgba(white, 0) 0,
						rgba(white, 0.2) 20%,
						rgba(white, 0.5) 60%,
						rgba(white, 0)
					);
					background-image: linear-gradient(
						90deg,
						rgb(from var(--c-text) r g b / 0) 0,
						rgb(from var(--c-text) r g b / 0.1) 20%,
						rgb(from var(--c-text) r g b / 0.2) 60%,
						rgb(from var(--c-text) r g b / 0)
					);
					animation: shimmer 2s infinite;
					content: '';
				}
			}
		}
		:global(.media-thumbnail) {
			background-color: var(--c-bg-active);
			border-radius: 10%;
		}
		:global(.project-thumbnail) {
			background-color: var(--c-bg-active);
		}
		.profile,
		.status {
			position: relative;
			overflow: hidden;
			border-radius: var(--radius-round);
			background-color: var(--c-bg-active);
			&::after {
				position: absolute;
				top: 0;
				right: 0;
				bottom: 0;
				left: 0;
				transform: translateX(-100%);
				background-image: linear-gradient(
					90deg,
					rgba(white, 0) 0,
					rgba(white, 0.2) 20%,
					rgba(white, 0.5) 60%,
					rgba(white, 0)
				);
				background-image: linear-gradient(
					90deg,
					rgb(from var(--c-text) r g b / 0) 0,
					rgb(from var(--c-text) r g b / 0.1) 20%,
					rgb(from var(--c-text) r g b / 0.2) 60%,
					rgb(from var(--c-text) r g b / 0)
				);
				animation: shimmer 2s infinite;
				content: '';
			}
		}
	}
</style>
