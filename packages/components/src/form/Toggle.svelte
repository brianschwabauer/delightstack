<script lang="ts" generics="Indeterminate extends boolean = false">
	import { onMount, type Snippet } from 'svelte';
	import { Popover } from '$lib/components';
	import ChevronDown from '~icons/mdi/chevron-down';
	import { browser } from '$app/environment';

	const propId = $props.id();
	let {
		/**
		 * Whether the toggle supports the 'indeterminate' state - where it's not a true/false
		 * If true, the user can click toggle between the three states: true, false, and null
		 */
		indeterminate = false as Indeterminate,

		/** The current value of the checkbox. 'null' means indeterminate */
		value = $bindable() as Indeterminate extends true
			? boolean | undefined | null
			: boolean,

		/** Whether the toggle should be smaller & denser */
		dense = false,

		/** Whether the toggle should be larger */
		comfortable = false,

		/** Whether or not the toggle must be checked to be valid */
		required = false,

		/** Whether the toggle is disabled */
		disabled = false,

		/** Whether the toggle value is inverted (false shows true and true shows false) */
		inverted = false,

		/** Whether the field has been touched (and blurred) */
		touched = $bindable(false) as boolean,

		/** Whether the toggle should be displayed in the vertical orientation */
		vertical = false,

		/** Where the toggle button should be in relation to the label */
		position = 'left' as 'left' | 'right',

		/**
		 * Whether the background color should be the accent/primary/brand color.
		 * If 'transparent' is also true, this will change the color of the text instead
		 */
		accent = false,

		/** Specifies a custom class name for the container element */
		class: className = '',

		/** The ID of the checkbox element. @defaults to a random ID */
		id = propId,

		/** The css style string added to the component from the parent */
		style = '',

		/** The content to show in a dropdown menu when the toggle label is clicked */
		menu = undefined as undefined | Snippet,

		/** The child elements to display inside the element */
		children = undefined as undefined | Snippet,

		/** Called when the field is touched */
		ontouch = undefined as (() => void) | undefined,

		/** Called when the value changes */
		onchange = undefined as
			| ((val: Indeterminate extends true ? boolean | undefined | null : boolean) => void)
			| undefined,
	} = $props();

	let inputElement = $state<HTMLInputElement | undefined>();
	let menuActive = $state(false);
	let menuTrigger = $state(undefined as undefined | HTMLElement);

	// Emit the necessary events when the field is touched or dirty or value changes
	$effect(() => {
		if (touched && ontouch) ontouch();
	});

	/** Called when the input field value is changed */
	function onInputChange(checked: boolean | null) {
		const newValue = (!indeterminate ? !!checked : checked) as Indeterminate extends true
			? boolean | undefined | null
			: boolean;
		if (newValue !== value) {
			(value as any) = newValue;
			if (onchange) onchange(newValue);
		}
	}

	let thumbTransitionDuration = $state('');
	let thumbPosition = $state('');
	let isDragging = false;
	let recentlyDragged = false;
	let thumbsize = 0;
	let padding = 0;
	let middle = 0;
	let upper = 0;

	onMount(() => {
		if (!inputElement) return;
		const inputStyles = window.getComputedStyle(inputElement);
		const thumbStyles = window.getComputedStyle(inputElement, ':before');
		thumbsize = parseInt(thumbStyles.getPropertyValue('width'));
		padding =
			parseInt(inputStyles.getPropertyValue('padding-left')) +
			parseInt(inputStyles.getPropertyValue('padding-right'));
		middle = (inputElement.clientWidth - padding) / 4;
		upper = inputElement.clientWidth - thumbsize - padding;
	});

	function dragInit() {
		if (disabled) return;
		isDragging = true;
		thumbTransitionDuration = '0s';
	}

	function dragEnd() {
		if (isDragging !== true) return;
		const checked = determineChecked();
		onInputChange(inverted ? !checked : checked);
		thumbTransitionDuration = '';
		thumbPosition = '';
		isDragging = false;
		padRelease();
	}

	function dragging(event: PointerEvent) {
		if (isDragging !== true) return;
		let pos = Math.round(event.offsetX - thumbsize / 2);
		if (pos < 0) pos = 0;
		if (pos > upper) pos = upper;
		thumbPosition = `${pos}px`;
	}

	function determineChecked(): boolean | null {
		let pos = Math.abs(Number.parseInt(thumbPosition));
		if (indeterminate) {
			if (isNaN(pos)) return value ? false : value === null ? true : null;
			if (Math.abs(pos - middle) < upper * 0.33) return null;
		}
		if (isNaN(pos)) return !value;
		return pos >= middle;
	}

	function padRelease() {
		recentlyDragged = true;
		setTimeout(() => (recentlyDragged = false), 300);
	}

	function onInputClick(e: MouseEvent) {
		if (recentlyDragged) {
			e.preventDefault();
			e.stopPropagation();
		}
	}
	function onKeyUp(e: KeyboardEvent) {
		if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
			if (indeterminate) {
				onInputChange(value ? false : value === null ? true : null);
			} else {
				onInputChange(!value);
			}
		}
	}
</script>

<svelte:window onpointerup={dragEnd} />

<label
	for={id}
	{style}
	bind:this={menuTrigger}
	class={['toggle', className].filter(Boolean).join(' ')}
	class:label-right={position === 'right'}
	class:dense
	class:comfortable
	class:disabled={disabled || !browser}
	class:vertical
	class:indeterminate
	class:accent>
	<input
		type="checkbox"
		role="switch"
		checked={inverted ? !value : !!value}
		aria-checked={inverted ? !value : !!value}
		bind:this={inputElement}
		onchange={(e) =>
			onInputChange(inverted ? !e.currentTarget.checked : e.currentTarget.checked)}
		onpointerdown={dragInit}
		onpointerup={dragEnd}
		onpointermove={dragging}
		onclick={onInputClick}
		onkeyup={onKeyUp}
		onblur={() => touched || (touched = true)}
		style:--thumb-transition-duration={thumbTransitionDuration}
		style:--thumb-position={thumbPosition}
		{required}
		{id}
		disabled={disabled || !browser}
		indeterminate={indeterminate && value === null} />
	{#if menu}
		<button class="menu-trigger" onclick={() => (menuActive = !menuActive)}>
			{#if children}{@render children()}{/if}
			<ChevronDown
				style="pointer-events:none;"
				class="chevron {menuActive ? 'active' : ''}" />
		</button>
	{:else if children}
		{@render children()}
	{/if}
</label>

{#if menu}
	<Popover
		refElement={menuTrigger}
		bind:opened={menuActive}
		arrow={false}
		closeOnInsideClick
		placement="bottom-end">
		{@render menu()}
	</Popover>
{/if}

<style lang="scss">
	:global(html[data-theme='dark']) .toggle {
		--thumb-highlight: hsl(0 0% 100% / 25%);
		& > input {
			&:disabled {
				&::before {
					box-shadow: inset 0 0 0 2px hsl(0 0% 0% / 50%);
				}
			}
		}
	}
	.toggle {
		&.accent {
			--c-action: var(--c-accent);
			--c-action-disabled: var(--c-accent-disabled);
			--c-action: var(--c-accent-active);
			--c-action-text: var(--c-accent-text);
			--c-action-text-active: var(--c-accent-text-active);
			--c-action-text-disabled: var(--c-accent-text-disabled);
		}
		&.dense {
			--thumb-size: 1.1rem;
			--track-padding: 1px;
			gap: 1ch;
		}
		&.comfortable {
			--thumb-size: 2rem;
			--track-padding: 3px;
		}
		--thumb-size: 1.5rem;
		--thumb-highlight: rgb(from var(--c-text) r g b / 0.25);

		--track-size: calc(var(--thumb-size) * 2);
		--track-padding: 2px;
		--thumb: var(--c-action-text);
		--track-inactive: var(--c-action-disabled);
		--track-active: var(--c-action-active);

		--thumb-color: var(--thumb);
		--thumb-color-highlight: var(--thumb-highlight);
		--track-color-inactive: var(--track-inactive);
		--track-color-active: var(--track-active);

		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: 1ch;

		cursor: pointer;
		user-select: none;
		-webkit-tap-highlight-color: transparent;

		&.disabled {
			cursor: not-allowed;
		}
		&.indeterminate {
			--track-size: calc(var(--thumb-size) * 2.5);
		}

		&.label-right {
			flex-direction: row-reverse;
			justify-content: space-between;
		}

		&.vertical {
			min-block-size: calc(var(--track-size) + calc(var(--track-padding) * 2));

			& > input {
				transform: rotate(calc(90deg * -1));
				touch-action: pan-x;
			}
		}

		& > input {
			--thumb-position: 0%;
			--thumb-transition-duration: 0.25s;

			padding: var(--track-padding);
			background: var(--track-color-inactive);
			inline-size: var(--track-size);
			block-size: var(--thumb-size);
			border-radius: var(--track-size);

			appearance: none;
			pointer-events: none;
			touch-action: pan-y;
			border: none;
			outline-offset: 5px;
			box-sizing: content-box;

			flex-shrink: 0;
			display: grid;
			align-items: center;
			grid: [track] 1fr / [track] 1fr;

			transition: background-color 0.25s ease;

			&::before {
				--highlight-size: 0;

				content: '';
				cursor: pointer;
				pointer-events: auto;
				grid-area: track;
				inline-size: var(--thumb-size);
				block-size: var(--thumb-size);
				background: var(--thumb-color);
				box-shadow: 0 0 0 var(--highlight-size) var(--thumb-color-highlight);
				border-radius: 50%;
				transform: translateX(var(--thumb-position));
				transition:
					transform var(--thumb-transition-duration) ease,
					background-color 0.25s ease,
					box-shadow 0.25s ease;
			}

			&:not(:disabled) {
				&:hover::before,
				&:focus-visible::before {
					--highlight-size: 0.5rem;
				}
			}

			&:checked {
				background: var(--track-color-active);
				--thumb-position: calc((var(--track-size) - 100%));
			}

			&:not(:checked) {
				&::before {
					--thumb-color: var(--c-action-text-disabled);
				}
			}

			&:indeterminate {
				--thumb-position: calc(
					calc(calc(var(--track-size) / 2) - calc(var(--thumb-size) / 2))
				);
			}

			&:disabled {
				cursor: not-allowed;
				--thumb-color: transparent;

				&::before {
					cursor: not-allowed;
					box-shadow: inset 0 0 0 2px hsl(0 0% 100% / 50%);
				}
			}
		}

		:global(.chevron) {
			display: flex;
			align-items: center;
			justify-content: center;
			pointer-events: none;
			transform: rotate(0);
			transition: transform 300ms var(--ease-out-back);
			font-size: 1.5rem;
		}
		:global(.chevron.active) {
			transform: rotate(-180deg);
		}
	}

	button.menu-trigger {
		background-color: transparent;
		display: flex;
		align-items: center;
		color: var(--c-text);
		padding: 0;
		margin: 0;
		cursor: pointer;
		box-shadow: none;
		border-radius: var(--radius-3);
		&:focus-visible {
			box-shadow: none;
			outline: solid 2px var(--c-outline-active);
			outline-offset: 6px;
		}
	}
</style>
