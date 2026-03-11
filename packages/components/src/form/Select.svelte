<script lang="ts">
	import { Portal } from '$lib/components';
	import { type Snippet, untrack } from 'svelte';
	import { focusWithin, isEqual, ripple } from '@packages/lib';
	import { browser } from '$app/environment';
	import { cubicOut } from 'svelte/easing';
	import ChevronDown from '~icons/mdi/chevron-down';

	type OptionType = $$Generic<any>;

	const propId = $props.id();
	let {
		/** The list of options to choose from */
		options = [] as OptionType[],

		/** The current validated value of the field */
		value = $bindable() as OptionType | undefined,

		/**
		 * Whether the select field should include less padding
		 * Note - this doesn't change font size - just spacing.
		 * To change font size, set the font-size on the parent element
		 */
		dense = false,

		/**
		 * Whether the select field should include more padding
		 * Note - this doesn't change font size - just spacing.
		 * To change font size, set the font-size on the parent element
		 */
		comfortable = false,

		/** Whether the select field should be rounded (larger border-radius) */
		rounded = false,

		/** Whether the select field is a required field in the form */
		required = false,

		/** Whether the select field is disabled and accepts no interactions */
		disabled = false,

		/** Whether the field has been touched (and blurred) */
		touched = $bindable(false) as boolean,

		/** Whether the field has a value (field is filled in) */
		dirty = $bindable(false) as boolean,

		/** The text in the select field when there is no value yet */
		label = '',

		/** The css style string added to the component from the parent */
		style = '',

		/** The ID of the select element. @defaults to a random ID */
		id = propId,

		/** Specifies a custom class name for the container element */
		class: className = '',

		/** The snippet for rendering the select options */
		children = undefined as undefined | Snippet<[OptionType]>,

		/** Called when the field is touched */
		ontouch = undefined as (() => void) | undefined,

		/** Called when the field is dirty (has an option selected) */
		ondirty = undefined as (() => void) | undefined,

		/** Called when the value changes */
		onchange = undefined as ((val: OptionType) => void) | undefined,
	} = $props();

	/** Whether or not any element is focused inside of the input container */
	let focused = $state(false);

	/** The index of the currently active/focused option */
	let currentIndex = $state(0);

	/** Whether or not the selection panel is currently being shown */
	let panelShown = $state(false);
	let popoverIndex = $state(0);

	let containerElement = $state<HTMLDivElement | undefined>(undefined);
	let panelElement = $state<HTMLElement | undefined>(undefined);

	$effect(() => {
		currentIndex = Math.max(
			options.findIndex((option) => isEqual(option, value)),
			0,
		);
	});
	$effect(() => {
		if (!focused && panelShown) panelShown = false;
	});
	$effect(() => {
		if (focused && !touched) touched = true;
	});

	// Emit the necessary events when the field is touched or dirty or value changes
	$effect(() => {
		if (touched) ontouch?.();
	});
	$effect(() => {
		if (dirty) ondirty?.();
	});

	// Scroll the options panel to the currently selected item
	$effect(() => {
		if (panelElement && currentIndex > -1 && options.length) {
			const items = panelElement.querySelectorAll('.panel-item');
			const item = items?.[currentIndex];
			if (item) {
				item.scrollIntoView({
					block: 'nearest',
					inline: 'nearest',
				});
			}
		}
	});

	/** Called when an option is clicked */
	function onOptionClick(index: number) {
		currentIndex = index;
		selectOption(options[currentIndex]);
		if (panelShown) panelShown = false;
	}

	/** Changes the current value to the given option and emits the change */
	function selectOption(option: OptionType) {
		(value as any) = option;
		panelShown = false;
		if (!dirty) dirty = true;
		if (!touched) touched = true;
		if (value !== undefined) onchange?.(value);
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') e.preventDefault();
		if (e.key === 'ArrowDown') {
			currentIndex = (currentIndex + 1) % options.length;
			if (!panelShown) selectOption(options[currentIndex]);
		} else if (e.key === 'ArrowUp') {
			currentIndex = Math.max((options.length + currentIndex - 1) % options.length, 0);
			if (!panelShown) selectOption(options[currentIndex]);
		}
	}
	function onKeyUp(e: KeyboardEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (e.key === 'Enter') {
			if (panelShown) {
				selectOption(options[currentIndex]);
			} else {
				panelShown = true;
			}
		} else if (e.key === 'Escape') {
			panelShown = false;
		} else if (e.key.match(/^[\w]$/i)) {
			// Jump to the first option that starts with the typed character
			const items = panelElement?.querySelectorAll('.panel-item');
			if (!items?.length) return;
			const currentLetter = (items[currentIndex]?.textContent || '')
				.trim()
				.toLowerCase()[0];
			currentIndex = Math.max(
				0,
				Array.from(items).findIndex((item, i, arr) => {
					const letter = (item?.textContent || '').trim().toLowerCase()[0];
					if (letter !== e.key.toLowerCase()) return false;
					if (letter === currentLetter) {
						if (i <= currentIndex) {
							const nextLetter = (arr[i + 1]?.textContent || '').trim().toLowerCase()[0];
							if (nextLetter === currentLetter) return false;
						}
					}
					return true;
				}),
			);
		}
	}

	/** Determines the position of the selection panel so that it fits on screen */
	let panelPositionDestroy = () => {};
	$effect(() => {
		if (browser && panelElement && containerElement) {
			let lastPosition: 'top' | 'bottom' | undefined = undefined;
			untrack(async () => {
				const { computePosition, autoUpdate, flip, size } = await import(
					'@floating-ui/dom'
				);
				if (!containerElement || !panelElement) return;
				panelPositionDestroy();
				panelPositionDestroy = autoUpdate(containerElement, panelElement, async () => {
					if (!containerElement || !panelElement || !panelShown) {
						return;
					}
					let { placement, x, y } = await computePosition(
						containerElement,
						panelElement,
						{
							placement: 'bottom',
							strategy: 'fixed',
							middleware: [
								flip(),
								size({
									apply({ rects, elements }) {
										Object.assign(elements.floating.style, {
											width: `${rects.reference.width}px`,
										});
									},
								}),
							],
						},
					);
					const position = placement.startsWith('bottom') ? 'bottom' : 'top';
					if (position === 'top' && label) y -= 6;
					const currentY = parseFloat(panelElement.style.top || '');
					const shouldAnimateOn = !lastPosition;
					const shouldAnimateFlip =
						lastPosition !== position && lastPosition && Math.abs(currentY - y) > 5;
					lastPosition = position;
					panelElement.style.left = `${x}px`;
					panelElement.style.top = `${y}px`;
					panelElement.style.transformOrigin = position === 'bottom' ? 'top' : 'bottom';
					if (shouldAnimateOn) {
						const animation = panelElement.animate(
							[
								{
									opacity: 1,
									transform: 'translateZ(0) scale(1)',
								},
							],
							{
								duration: 200,
								easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
								fill: 'forwards',
							},
						);
						await animation.finished.catch(() => undefined);
						try {
							animation.commitStyles();
							animation.cancel();
						} catch (error) {
							// ignore
						}
					}
					if (shouldAnimateFlip) {
						const animations = panelElement.getAnimations();
						animations.forEach((animation) => {
							try {
								animation.commitStyles();
								animation.cancel();
							} catch (error) {
								// ignore
							}
						});
						const animation = panelElement.animate(
							[
								{ transform: `translate3d(0px, ${Math.floor(currentY - y)}px, 0px)` },
								{ transform: 'translate3d(0px, 0px, 0px)' },
							],
							{
								duration: 200,
								easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
								fill: 'forwards',
							},
						);
						await animation.finished.catch(() => undefined);
						try {
							animation.commitStyles();
							animation.cancel();
						} catch (error) {
							// ignore
						}
					}
				});
			});
		}
		return () => panelPositionDestroy();
	});

	function panelTransitionOut(element: HTMLElement) {
		return () => {
			return {
				duration: 80,
				easing: cubicOut,
				css: (t: number) => `transform: translateZ(0) scale(1, ${t * 0.75 + 0.25});`,
			};
		};
	}

	$effect.pre(() => {
		if (!panelShown) return;
		let highestIndex = -1;
		document.querySelectorAll('[data-popover-index]').forEach((el) => {
			highestIndex = Math.max(
				highestIndex,
				+((el as HTMLElement).dataset.popoverIndex || '0'),
			);
		});
		popoverIndex = highestIndex + 1;
	});
</script>

<div
	{id}
	class={['select', className].filter(Boolean).join(' ')}
	class:error={required && !value && touched}
	class:dense
	class:comfortable
	class:disabled={disabled || !browser}
	bind:this={containerElement}
	use:focusWithin={{
		onfocuswithin: (e) => (focused = e),
	}}
	aria-haspopup={true}
	aria-expanded={panelShown}
	{style}>
	<div class="select-outer">
		<div
			class="select-inner"
			role="combobox"
			aria-expanded={panelShown}
			aria-controls="{id}-panel"
			class:rounded
			class:has-label={!!label.length}
			tabindex={disabled || !browser ? -1 : 0}
			onkeydown={onKeyDown}
			onkeyup={onKeyUp}
			onclick={() => {
				if (disabled || !browser) return;
				focused = true;
				panelShown = !panelShown;
			}}>
			<div class="select-box">
				{#if Array.isArray(value)}
					{#each value as item, i (item)}
						<div class="selected-item">
							{#if children}
								{@render children(item)}
							{:else}
								{item}
							{/if}
						</div>
					{/each}
				{:else if value !== undefined && value !== null}
					<div class="selected-item">
						{#if children}
							{@render children(value)}
						{:else}
							{value}
						{/if}
					</div>
				{/if}
				{#if !!label.length}
					<div class="label">{label}</div>
				{/if}
			</div>
			<div aria-hidden={true} class="icon" class:active={panelShown}><ChevronDown /></div>
		</div>
	</div>
</div>

<!-- The panel of selection options that shows when active -->
<Portal>
	{#if panelShown}
		<ul
			tabindex="-1"
			class="panel"
			class:dense
			class:comfortable
			data-popover-index={popoverIndex}
			id="{id}-panel"
			role="listbox"
			style="opacity: 0; transform: translateZ(0) scale(1, 0);"
			bind:this={panelElement}
			out:panelTransitionOut>
			{#each options as item, i (item)}
				<li
					class="panel-item"
					role="option"
					aria-selected={currentIndex === i}
					class:active={currentIndex === i}
					use:ripple
					onkeyup={() => {}}
					onpointerdown={(e) => e.preventDefault()}
					onclick={() => onOptionClick(i)}>
					{#if children}
						{@render children(item)}
					{:else}
						{item}
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</Portal>

<style lang="scss">
	$label-font-size: 0.8em;
	$label-margin: 0.4em;

	/** The outer most container */
	.select {
		--easing: var(--ease-out-back);
		flex: 1 1 auto;
		font-size: 1em;
		letter-spacing: normal;
		max-width: 100%;
		text-align: left;
		--height: 3.5em;

		&.dense {
			--height: 2.5em;
		}
		&.comfortable {
			--height: 4em;

			.select-inner .selected-item {
				padding: 0 1.5em;
			}
		}

		&.disabled {
			cursor: not-allowed;
			color: var(--c-text-disabled);
			.select-box > .label {
				cursor: not-allowed;
			}

			.label {
				color: var(--c-text-disabled);
			}
		}
	}

	/** The parent of the .select-inner div - used for flex */
	.select-outer {
		border-radius: inherit;
		align-items: center;
		color: inherit;
		display: flex;
		position: relative;
		width: 100%;
		margin-bottom: $label-margin;
	}

	/** The div containing the input, prepend, append elements */
	.select-inner {
		--radius: var(--radius-3);
		width: 100%;
		color: inherit;
		caret-color: currentColor;
		display: flex;
		align-items: center;
		min-height: calc(var(--height) + $label-margin);
		border-radius: var(--radius);
		box-shadow: none;
		cursor: pointer;

		.selected-item {
			padding: 0 0 0 1em;
		}

		.icon {
			padding: 0 0.75em;
			display: flex;
			align-items: center;
			justify-content: center;
			pointer-events: none;
			transform: rotate(0);
			transition: transform 300ms var(--easing);

			> :global(svg) {
				font-size: 1.25em;
			}
			&.active {
				transform: rotate(-180deg);
			}
		}

		> :global(*) {
			margin-top: $label-margin;
		}

		&.rounded {
			--radius: calc((var(--height) / 2) + #{$label-margin});
			.select-box > .label {
				&::before {
					transition:
						border-color 0.05s,
						margin-right 0.2s,
						width 0.3s;
				}
				&::after {
					transition:
						margin-right 0.2s,
						width 0.3s;
				}
			}
			&:focus-within:not(:hover) {
				.select-box > .label {
					&::after,
					&::before {
						transition:
							border-color 0.2s,
							margin-right 0.2s,
							width 0.3s;
					}
				}
			}
		}

		&::before {
			border-radius: inherit;
			width: inherit;
			bottom: -1px;
			content: '';
			left: 0;
			position: absolute;
			pointer-events: none;
			border-color: var(--c-outline);
			border-style: solid;
			top: $label-margin;
			border-width: 1px;
			box-sizing: border-box;
			transition: border-color 0.1s;
		}
	}

	/** Change the colors of the input when hovered or errored */
	.select-inner:hover {
		.select-box > .label {
			color: currentColor;
		}
		&::before {
			border-color: currentColor;
		}
		&.has-label {
			&::before {
				border-top-color: transparent;
			}
			.label {
				border-color: currentColor;
			}
		}
		.selected-item + .label {
			&::before,
			&::after {
				border-top-color: currentColor;
			}
		}
	}
	.select.error {
		color: var(--c-error);
		--c-outline: var(--c-error);
		--c-text-disabled: var(--c-error);
		.select-inner:hover,
		&:focus-within {
			color: var(--c-error-active);
		}
	}

	/** The element that contains the input/label elements */
	.select-box {
		display: flex;
		flex-grow: 1;
		flex-wrap: wrap;
		overflow: hidden;
		position: inherit !important; // overwrite the autoAnimate 'position: relative' styles
		align-items: center;
		box-shadow: none;

		> .label {
			position: absolute;
			text-overflow: ellipsis;
			transform-origin: top left;
			top: $label-margin;
			left: 0;
			display: flex;
			width: 100%;
			min-height: calc(100% - $label-margin);
			max-height: 100%;
			max-width: 100%;
			line-height: calc(var(--height) - ($label-margin / 2));
			height: auto;
			padding: 0;
			transform: none;
			transition:
				color 0.1s,
				top 0.2s cubic-bezier(0, 0.54, 0.47, 1),
				font-size 0.2s,
				line-height 0.2s;
			cursor: pointer;
			overflow: visible;
			font-size: 1em;
			border-top: solid 1px var(--c-outline);
			border-radius: var(--radius);
			color: var(--c-text-disabled);
			&::before,
			&::after {
				content: '';
				display: block;
				box-sizing: border-box;
				min-width: max(var(--radius), 1em);
				width: 0;
				height: var(--radius);
				pointer-events: none;
				border-top: solid 1px transparent;
				margin-top: 0.1em;
			}
			&::before {
				margin-right: 0;
				border-radius: var(--radius) 0;
				transition:
					margin-right 0.2s,
					width 0.3s;
				border-left: solid 1px transparent;
			}
			&::after {
				flex-grow: 1;
				margin-left: 4px;
				border-radius: 0 var(--radius);
				border-right: solid 1px transparent;
			}
		}
	}

	/** Overwrites for the input label positioning and the active state of the input */
	.select-inner {
		&.has-label {
			&:focus-within::before,
			&:before {
				border-top-color: transparent;
			}
		}

		&:focus-within {
			&::after {
				transform: scale(1);
			}
			&::before {
				border-color: currentColor;
				border-width: 2px;
			}
			.select-box > .label {
				color: inherit;
			}
			.select-box {
				.label {
					border-top: solid 2px currentColor;
				}
				> .selected-item {
					+ .label {
						border-top: none;
						// The top border when the input is focused and there is placeholder text
						&::after,
						&::before {
							border-top: solid 2px currentColor;
						}
					}
				}
			}
		}
	}
	.select-box {
		.selected-item + .label {
			&::before,
			&::after {
				// The top border when there is a value in the input and the input is not focused
				// The placeholder text shows up at the top
				border-top: solid 1px var(--c-outline);
			}
		}
		.selected-item + .label {
			line-height: 0px !important;
			font-size: $label-font-size;
			border-top: transparent;
			&::before {
				margin-right: 4px;
			}
		}
	}

	.panel {
		--radius: var(--radius-4);
		--border-inset: 6px;
		position: fixed;
		z-index: var(--layer-5);
		padding: 0;
		margin: 0;
		background-color: var(--c-bg-0);
		color: var(--c-text);
		border-radius: var(--radius);
		overflow-x: hidden;
		overflow-y: auto;
		box-shadow: var(--shadow-2);
		max-height: calc(3.5em * 5);
		transition: transform 150ms;
		transform: translate3d(0, 0, 0);
		scrollbar-color: var(--c-text) transparent;
		scrollbar-width: thin;
		will-change: transform;
		&::-webkit-scrollbar {
			width: 0.5rem;
		}
		&::-webkit-scrollbar-track {
			box-shadow: none;
			background-color: transparent;
		}
		&::-webkit-scrollbar-track-piece:start {
			margin-top: var(--radius);
		}
		&::-webkit-scrollbar-track-piece:end {
			margin-bottom: var(--radius);
		}
		&::-webkit-scrollbar-thumb {
			background-color: var(--c-text);
			border-radius: 9999px;
			min-height: 2rem;
			&:hover {
				background-color: var(--c-text-active);
				cursor: pointer;
			}
		}

		&.dense {
			--border-inset: 4px;
			--radius: var(--radius-3);
			.panel-item {
				height: 2.75em;
				padding: 1em;
				&:first-child {
					padding-top: calc(var(--border-inset, 0px) + 1em);
				}
				&:last-child {
					padding-bottom: calc(var(--border-inset, 0px) + 1em);
				}
				&::before {
					top: 1px;
					bottom: 1px;
				}
			}
		}
		&.comfortable {
			--border-inset: 8px;
			.panel-item {
				height: 4.5em;
				padding: 1.5em;
				&:first-child {
					padding-top: calc(var(--border-inset, 0px) + 1.5em);
				}
				&:last-child {
					padding-bottom: calc(var(--border-inset, 0px) + 1.5em);
				}
				&::before {
					top: 3px;
					bottom: 3px;
				}
			}
		}
		.panel-item {
			display: flex;
			align-items: center;
			cursor: pointer;
			position: relative;
			height: 3.5em;
			padding: 1.5em;
			z-index: 1;
			:global(> .ripple) {
				inset: 2px var(--border-inset) !important;
				border-radius: calc(var(--radius) - var(--border-inset)) !important;
			}
			&:first-child {
				padding-top: calc(var(--border-inset, 0px) + 1.5em);
				&::before {
					top: var(--border-inset);
				}
				:global(> .ripple) {
					top: var(--border-inset) !important;
				}
			}
			&:last-child {
				padding-bottom: calc(var(--border-inset, 0px) + 1.5em);
				&::before {
					bottom: var(--border-inset);
				}
				:global(> .ripple) {
					bottom: var(--border-inset) !important;
				}
			}
			&::before {
				content: '';
				position: absolute;
				background-color: var(--c-bg-1);
				top: 2px;
				bottom: 2px;
				left: var(--border-inset);
				right: var(--border-inset);
				border-radius: calc(var(--radius) - var(--border-inset));
				opacity: 0;
				transition: opacity 100ms;
				z-index: -1;
			}
			&:hover,
			&.active {
				color: var(--c-text-active);
				&::before {
					opacity: 1;
				}
			}
			&:hover {
				transition:
					background-color 100ms,
					color 100ms;
			}
			:global(small) {
				color: var(--c-text-disabled);
				font-size: var(--font-size-0);
				margin-left: 0.5em;
				display: inline-block;
			}
			:global(strong) {
				font-weight: bold;
			}
		}
	}
</style>
