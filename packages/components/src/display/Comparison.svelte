<script lang="ts">
	const propId = $props.id();
	let {
		/** The URL of the "before" image */
		before,

		/** The URL of the "after" image */
		after,

		/** Alt text for the before image @default 'Before' */
		before_alt = 'Before',

		/** Alt text for the after image @default 'After' */
		after_alt = 'After',

		/** The divider position from 0 to 100 (percentage) */
		position = $bindable(50),

		/** Whether the comparison should be vertical instead of horizontal */
		vertical = false,

		/** Whether to show "Before" and "After" labels */
		show_labels = true,

		/** The text for the before label @default 'Before' */
		label_before = 'Before',

		/** The text for the after label @default 'After' */
		label_after = 'After',

		/** Whether to show a skeleton loading state */
		skeleton = false,

		/** The ID of the component @defaults to a random ID */
		id = propId,

		/** Specifies a custom class name for the container element */
		class: className = '',

		/** Called when the position changes */
		onchange = undefined as ((detail: { position: number }) => void) | undefined,
	}: {
		before: string;
		after: string;
		before_alt?: string;
		after_alt?: string;
		position?: number;
		vertical?: boolean;
		show_labels?: boolean;
		label_before?: string;
		label_after?: string;
		skeleton?: boolean;
		id?: string;
		class?: string;
		onchange?: (detail: { position: number }) => void;
	} = $props();

	let container: HTMLElement | undefined = $state(undefined);
	let dragging = $state(false);

	const clampedPosition = $derived(Math.min(100, Math.max(0, position)));

	/** Clip-path for the "after" image based on orientation and position */
	const afterClipPath = $derived(
		vertical
			? `inset(${clampedPosition}% 0 0 0)`
			: `inset(0 0 0 ${clampedPosition}%)`,
	);

	/** CSS for the divider position */
	const dividerStyle = $derived(
		vertical
			? `top: ${clampedPosition}%; left: 0; right: 0;`
			: `left: ${clampedPosition}%; top: 0; bottom: 0;`,
	);

	function updatePosition(clientX: number, clientY: number) {
		if (!container) return;
		const rect = container.getBoundingClientRect();
		let newPosition: number;
		if (vertical) {
			newPosition = ((clientY - rect.top) / rect.height) * 100;
		} else {
			newPosition = ((clientX - rect.left) / rect.width) * 100;
		}
		newPosition = Math.min(100, Math.max(0, Math.round(newPosition * 100) / 100));
		if (newPosition !== position) {
			position = newPosition;
			onchange?.({ position });
		}
	}

	function handlePointerDown(e: PointerEvent) {
		if (skeleton) return;
		e.preventDefault();
		dragging = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		updatePosition(e.clientX, e.clientY);
	}

	function handlePointerMove(e: PointerEvent) {
		if (!dragging) return;
		e.preventDefault();
		updatePosition(e.clientX, e.clientY);
	}

	function handlePointerUp(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
	}

	function handleContainerClick(e: MouseEvent) {
		if (skeleton) return;
		// Only handle clicks directly on the container (not on the handle itself during drag)
		updatePosition(e.clientX, e.clientY);
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (skeleton) return;
		const step = e.shiftKey ? 10 : 1;
		let newPosition = position;

		switch (e.key) {
			case 'ArrowLeft':
			case 'ArrowUp':
				e.preventDefault();
				newPosition = position - step;
				break;
			case 'ArrowRight':
			case 'ArrowDown':
				e.preventDefault();
				newPosition = position + step;
				break;
			case 'Home':
				e.preventDefault();
				newPosition = 0;
				break;
			case 'End':
				e.preventDefault();
				newPosition = 100;
				break;
			default:
				return;
		}

		newPosition = Math.min(100, Math.max(0, newPosition));
		if (newPosition !== position) {
			position = newPosition;
			onchange?.({ position });
		}
	}
</script>

{#if skeleton}
	<div
		class={['comparison', 'skeleton', className].filter(Boolean).join(' ')}
		{id}>
		<div class="skeleton-inner"></div>
	</div>
{:else}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class={['comparison', className].filter(Boolean).join(' ')}
		class:vertical
		class:dragging
		{id}
		bind:this={container}
		onclick={handleContainerClick}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerUp}>

		<img
			class="comparison-image before"
			src={before}
			alt={before_alt}
			draggable="false" />

		<img
			class="comparison-image after"
			src={after}
			alt={after_alt}
			draggable="false"
			style:clip-path={afterClipPath} />

		{#if show_labels}
			<span class="label label-before">{label_before}</span>
			<span class="label label-after">{label_after}</span>
		{/if}

		<div class="divider" class:vertical style={dividerStyle}>
			<div
				class="handle"
				role="slider"
				tabindex="0"
				aria-valuenow={Math.round(clampedPosition)}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-label="Comparison slider"
				onkeydown={handleKeyDown}>
				{#if vertical}
					<svg class="handle-arrows" viewBox="0 0 24 24" aria-hidden="true">
						<path d="M12 4l-4 4h8zM12 20l-4-4h8z" fill="currentColor" />
					</svg>
				{:else}
					<svg class="handle-arrows" viewBox="0 0 24 24" aria-hidden="true">
						<path d="M4 12l4-4v8zM20 12l-4-4v8z" fill="currentColor" />
					</svg>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.comparison {
		--handle-size: 40px;
		--handle-color: var(--color-handle, #fff);
		--handle-shadow: 0 0 6px rgba(0, 0, 0, 0.3), 0 2px 8px rgba(0, 0, 0, 0.15);
		--divider-color: var(--color-divider, #fff);
		--divider-width: var(--width-divider, 2px);
		--label-bg: var(--color-label-bg, rgba(0, 0, 0, 0.55));
		--label-color: var(--color-label-text, #fff);
		--label-padding: var(--padding-label, 4px 10px);
		--label-radius: var(--radius-label, 4px);
		--label-font-size: var(--font-size-label, 0.8125rem);

		position: relative;
		overflow: hidden;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		cursor: ew-resize;

		&.vertical {
			cursor: ns-resize;
		}

		&.dragging {
			cursor: grabbing;
		}

		&.skeleton {
			cursor: default;
			touch-action: auto;
			user-select: auto;
		}
	}

	.skeleton-inner {
		width: 100%;
		height: 100%;
		min-height: 200px;
		border-radius: var(--radius-4, 8px);
		background: linear-gradient(
			90deg,
			var(--color-bg-active, #e0e0e0) 25%,
			var(--color-bg-hover, #f0f0f0) 50%,
			var(--color-bg-active, #e0e0e0) 75%
		);
		background-size: 200% 100%;
		animation: skeleton-pulse 1.5s ease-in-out infinite;
	}

	@keyframes skeleton-pulse {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}

	.comparison-image {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;

		&.before {
			position: relative;
		}

		&.after {
			position: absolute;
			inset: 0;
		}
	}

	.label {
		position: absolute;
		padding: var(--label-padding);
		background: var(--label-bg);
		color: var(--label-color);
		font-size: var(--label-font-size);
		font-weight: 500;
		border-radius: var(--label-radius);
		pointer-events: none;
		z-index: 2;
		line-height: 1;
	}

	.label-before {
		top: 12px;
		left: 12px;
	}

	.label-after {
		bottom: 12px;
		right: 12px;
	}

	.vertical .label-before {
		top: 12px;
		left: 12px;
	}

	.vertical .label-after {
		bottom: 12px;
		right: 12px;
	}

	.divider {
		position: absolute;
		z-index: 3;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;

		&::before {
			content: '';
			position: absolute;
			background: var(--divider-color);
		}

		&:not(.vertical) {
			width: 0;
			&::before {
				width: var(--divider-width);
				top: 0;
				bottom: 0;
				left: calc(var(--divider-width) / -2);
			}
		}

		&.vertical {
			height: 0;
			&::before {
				height: var(--divider-width);
				left: 0;
				right: 0;
				top: calc(var(--divider-width) / -2);
			}
		}
	}

	.handle {
		position: relative;
		width: var(--handle-size);
		height: var(--handle-size);
		border-radius: 50%;
		background: var(--handle-color);
		box-shadow: var(--handle-shadow);
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: auto;
		cursor: grab;
		flex-shrink: 0;
		z-index: 1;
		outline: none;
		transition: box-shadow 150ms ease;

		&:focus-visible {
			box-shadow:
				var(--handle-shadow),
				0 0 0 3px rgba(59, 130, 246, 0.5);
		}

		.dragging & {
			cursor: grabbing;
		}
	}

	.handle-arrows {
		width: 20px;
		height: 20px;
		color: rgba(0, 0, 0, 0.6);
		pointer-events: none;
	}
</style>
