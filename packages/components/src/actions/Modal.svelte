<script lang="ts" module>
	let lastClickedElement = undefined as HTMLElement | undefined;
	let lastClickedListening = false;
	function onDocumentClick(event: MouseEvent) {
		lastClickedElement = event.target as HTMLElement;
	}
	function listenForLastClickedElement() {
		if (!document || lastClickedListening) return;
		lastClickedListening = true;
		document.removeEventListener('pointerdown', onDocumentClick);
		document.addEventListener('pointerdown', onDocumentClick);
	}
</script>

<script lang="ts">
	import { crossfade, fade, scale } from 'svelte/transition';
	import { quartOut } from 'svelte/easing';
	import { type Snippet } from 'svelte';
	import { focusTrap, generateID, ripple } from '@delightstack/utilities';
	import Button from './Button.svelte';
	import { scrollbar } from './scrollbar';

	let {
		/** Title text displayed as the dialog header */
		title = '',

		/** Determines whether the dialog is open or not */
		open = $bindable(false) as boolean,

		/** Determines whether the dialog can be conventially closed using the escape key or backdrop click. */
		closable = true,

		/** Whether the close icon should be hidden or not */
		disable_close_icon = false,

		/** The ID of the modal - used to set/unset transition targets automatically */
		modal_id = '',

		/** The CSS string width of the modal (when on desktop) */
		width = '',

		/** The CSS string height of the modal (when on desktop) */
		height = '',

		/** The CSS string maximum width of the modal */
		max_width = 'calc(100vw - 2rem)',

		/** The CSS string maximum height of the modal */
		max_height = 'calc(100svh - 2rem)',

		/** The element that the modal will be animated from  when opening */
		transition_target = undefined as HTMLElement | Element | undefined,

		/** The css style string added to the component from the parent */
		style = '',

		/** Specifies a custom class name for the dialog */
		class: class_name = '',

		/** The snippet used to render the modal body */
		children = undefined as undefined | Snippet,

		/** The snippet used to render the header bar */
		header = undefined as undefined | Snippet,

		/** The snippet used to render a child at the start of the header bar. Can't be used if 'header' is supplied */
		header_start = undefined as undefined | Snippet,

		/** The snippet used to render a child at the end of the header bar. Can't be used if 'header' is supplied */
		header_end = undefined as undefined | Snippet,

		/** The snippet used to render the modal footer */
		footer = undefined as undefined | Snippet,

		/** The snippet used to render the modal footer at the start. Can't be used if 'footer' is supplied */
		footer_start = undefined as undefined | Snippet,

		/** The snippet used to render the modal footer at the end. Can't be used if 'footer' is supplied */
		footer_end = undefined as undefined | Snippet,

		/** The function to call when the dialog is closed. If false is returned, the modal will not be closed */
		onclose = undefined as undefined | (() => boolean | undefined | void),

		/** The function to call when the dialog is opened */
		onopen = undefined as undefined | (() => void),

		/** The function to call when the backdrop is clicked */
		onbackdropclick = undefined as undefined | (() => void),

		...rest
	} = $props();

	const titleId = `modal-title-${generateID({ length: 6 })}`;
	const bodyId = `modal-body-${generateID({ length: 6 })}`;
	const easing = (t: number, factor = 0.5) => quartOut(t) * factor + (1 - factor);
	let _open = $state(open);
	$effect(() => listenForLastClickedElement());
	$effect(() => {
		if (open === _open) return;
		const target = transition_target || lastClickedElement;
		if (target && open) send(target, { key: 'modal' });
		_open = open;
	});

	// Setup the send/receive animation so the modal body can be animated into existence
	const [send, receive] = crossfade({
		duration: 300,
		easing,
		fallback: (node) => {
			const style = getComputedStyle(node);
			const transform = style.transform === 'none' ? '' : style.transform;
			return {
				duration: 300,
				easing,
				css: (t) => `transform: ${transform} translateZ(0px) scale(${t}); opacity: ${t}`,
			};
		},
	});

	function close() {
		if (closable && _open) {
			const accepted = onclose?.() ?? true;
			if (accepted) {
				_open = false;
				open = false;
			}
		}
	}
	function handleEscapeKey({ key }: KeyboardEvent) {
		if (key === 'Escape') close();
	}

	function mountModal(node: HTMLElement) {
		if (onopen) onopen();
		if (transition_target) transition_target = undefined;
		return {
			destroy: () => {
				if (_open) return;
				if (onclose) onclose();
			},
		};
	}
</script>

<svelte:window onkeyup={handleEscapeKey} />

{#if _open}
	<div
		class={['modal', class_name].filter(Boolean).join(' ')}
		{style}
		in:receive={{ key: 'modal' }}
		out:scale={{ duration: 100, start: 0.75 }}
		role="dialog"
		aria-modal="true"
		aria-labelledby={titleId}
		aria-describedby={bodyId}
		{@attach focusTrap({
			escapeDeactivates: false,
			allowOutsideClick: true,
			returnFocusOnDeactivate: true,
			initialFocus: false,
		})}
		use:mountModal
		{...rest}>
		<div
			class="modal-body"
			id={bodyId}
			style:width
			style:height
			style:max-width={max_width}
			style:max-height={max_height}
			{@attach scrollbar({ corner_inset: 10 })}>
			{#if (closable && !disable_close_icon) || title || header || header_start || header_end}
				<header class:bar={title || header || header_start || header_end}>
					{#if closable && !disable_close_icon}
						<div class="close">
							<Button transparent icon onclick={close} size="0">
								<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
									<path
										d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
								</svg>
							</Button>
						</div>
					{/if}
					{#if title}<h2>{title}</h2>{/if}
					{#if header}
						{@render header()}
					{:else}
						{#if header_start}{@render header_start()}{/if}
						<div class="spacer"></div>
						{#if header_end}{@render header_end()}{/if}
					{/if}
				</header>
			{/if}
			{#if children}{@render children()}{/if}
			{#if footer || footer_start || footer_end}
				<footer class="modal-footer">
					{#if footer}
						{@render footer()}
					{:else}
						{#if footer_start}{@render footer_start()}{/if}
						<div class="spacer"></div>
						{#if footer_end}{@render footer_end()}{/if}
					{/if}
				</footer>
			{/if}
		</div>
		<div class="modal-fg"></div>
	</div>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="modal-bg"
		style:cursor={closable ? 'pointer' : ''}
		style:pointer-events={closable ? '' : 'none'}
		role="button"
		tabindex="-1"
		{@attach ripple()}
		onclick={() => {
			if (onbackdropclick) onbackdropclick();
			close();
		}}
		in:fade={{ duration: 250, delay: 50 }}
		out:fade={{ duration: 120 }}>
	</div>
{/if}

<style>
	:global(html:has(.modal)) {
		overflow: hidden;
	}
	:global(::view-transition-old(modal-fg)),
	:global(::view-transition-new(modal-fg)) {
		/* Prevent the default animation,
		so both views remain opacity:1 throughout the transition */
		animation: none;
		/* Use normal blending,
		so the new view sits on top and obscures the old view */
		mix-blend-mode: normal;
		/* Make the height the same as the group,
		meaning the view size might not match its aspect-ratio. */
		height: 100%;
		/* Clip any overflow of the view */
		overflow: clip;
	}
	.modal {
		/* panel sits one above the backdrop, which is at --layer-modal */
		--layer: calc(var(--layer-modal) + 1);
		--radius-lg: var(--radius-2xl);
		--shadow-md: var(--shadow-lg);
		display: grid;
		position: fixed;
		z-index: var(--layer);
		top: 0;
		left: 0;
		bottom: 0;
		right: 0;
		grid-template-columns: 100%;
		grid-template-rows: 100%;
		width: 100%;
		height: 100%;
		align-content: center;
		justify-content: center;
		pointer-events: none;

		@media (min-width: 768px) {
			overflow: hidden;
			grid-template-rows: max-content;
			grid-template-columns: max-content;
			border-radius: var(--radius-lg);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--radius-lg) * var(--squircle-ratio, 2));
			}
		}

		header {
			display: flex;
			align-items: center;
			position: absolute;
			bottom: 0;
			left: 0;
			background-color: var(--color-bg);
			z-index: 2;
			gap: 0.5rem;
			padding: 0.5rem 0.5rem 0.5rem 0;
			overflow-x: auto;
			@media (max-width: 767px) {
				width: 100%;
				:global(> *) {
					flex-shrink: 0;
				}
				h2 {
					font-size: 1.15rem;
				}
			}
			@media (min-width: 768px) {
				&.bar {
					padding: 0;
					position: sticky;
					margin: -1.5rem -1rem 0.5rem -1.25rem;
					height: 4rem;
					top: calc(-2rem - 1px);
					bottom: unset;
					left: unset;
					overflow-x: hidden;
				}
			}
			&:not(.bar) {
				background-color: transparent;
				position: sticky;
				left: 0;
				top: -1rem;
				bottom: unset;
				height: 4rem;
				width: 4rem;
				margin: -3rem 0 0 -2rem;
				overflow: hidden;
				@media (min-width: 768px) {
					left: -1rem;
					top: -2rem;
					margin: -2rem 0 0 -2rem;
				}
			}
			.close {
				position: sticky;
				left: 0;
				background-color: var(--color-bg);
				border-radius: var(--radius-lg);
				@supports (corner-shape: squircle) {
					corner-shape: squircle;
					border-radius: calc(var(--radius-lg) * var(--squircle-ratio, 2));
				}
			}
			.spacer {
				flex: 1;
			}
		}
	}
	.modal-body {
		grid-column: 1 / 1;
		grid-row: 1 / 1;
		height: 100%;
		z-index: 1;
		padding: 1rem 0.5rem;
		view-transition-name: modal-body;
		overflow-y: auto;
		overflow-x: hidden;
		overscroll-behavior: contain;
		pointer-events: auto;
		/* The overlay scrollbar takes no layout space (the native gutter that
		   scrollbar-gutter: stable both-edges used to reserve is gone), so the
		   inline padding carries the full edge distance itself. */
		scrollbar-gutter: stable both-edges;
		@media (max-width: 767px) {
			min-width: 100vw;
			padding-bottom: 4rem;
		}
		@media (min-width: 768px) {
			padding: 2rem 2.5rem;
		}
		/* Corner inset for the styled-native fallback (pre-JS / no overlay) */
		--scrollbar-track-inset: calc(var(--radius-lg, 10px) / 2);
	}
	.modal-footer {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		justify-content: flex-end;
		padding: 0.75rem 0;
		margin-top: 1rem;
		border-top: 1px solid var(--color-border, rgb(from var(--color-text) r g b / 0.1));
	}
	.modal-fg {
		view-transition-name: modal-fg;
		z-index: -1;
		grid-column: 1 / 1;
		grid-row: 1 / 1;
		height: 100%;
		background-color: var(--color-bg);
		z-index: -1;
		box-shadow: var(--shadow-md);
		@media (min-width: 768px) {
			border-radius: var(--radius-lg);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--radius-lg) * var(--squircle-ratio, 2));
			}
		}
	}
	.modal-bg {
		--layer: var(--layer-modal);
		position: fixed;
		top: 0;
		bottom: 0;
		right: 0;
		left: 0;
		backdrop-filter: blur(15px);
		z-index: var(--layer);
		&::after {
			content: '';
			background-color: var(--color-text);
			position: absolute;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			opacity: 0.2;
		}
	}
</style>
