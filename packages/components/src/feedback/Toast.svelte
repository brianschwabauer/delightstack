<script lang="ts" module>
	type Position =
		| 'top-left'
		| 'top-center'
		| 'top-right'
		| 'bottom-left'
		| 'bottom-center'
		| 'bottom-right';

	export interface ToastOptions {
		duration?: number;
		dismissible?: boolean;
		success?: boolean;
		warning?: boolean;
		error?: boolean;
		action?: { label: string; onclick: () => void };
		persistent?: boolean;
		progress?: boolean;
		id?: string;
	}

	type Variant = 'default' | 'success' | 'warning' | 'error' | 'loading';

	interface ToastEntry {
		id: string;
		message: string;
		variant: Variant;
		options: ToastOptions;
		created_at: number;
		remaining: number;
		dismissed: boolean;
	}

	let toasts = $state<ToastEntry[]>([]);
	let counter = 0;

	function generateId(): string {
		return `toast-${++counter}-${Date.now()}`;
	}

	function variantFromOptions(options?: ToastOptions): Variant {
		if (options?.error) return 'error';
		if (options?.warning) return 'warning';
		if (options?.success) return 'success';
		return 'default';
	}

	function addToast(message: string, variant: Variant, options?: ToastOptions): string {
		const id = options?.id ?? generateId();
		const duration = options?.duration ?? 4000;
		const effective_duration = options?.action ? duration + 2000 : duration;

		// If a toast with this id already exists, update it
		const existing_index = toasts.findIndex((t) => t.id === id);
		if (existing_index !== -1) {
			toasts[existing_index].message = message;
			toasts[existing_index].variant = variant;
			toasts[existing_index].options = { ...toasts[existing_index].options, ...options };
			toasts[existing_index].remaining = effective_duration;
			toasts[existing_index].dismissed = false;
			return id;
		}

		const entry: ToastEntry = {
			id,
			message,
			variant,
			options: {
				dismissible: true,
				persistent: false,
				progress: true,
				...options,
				duration: effective_duration,
			},
			created_at: Date.now(),
			remaining: effective_duration,
			dismissed: false,
		};

		toasts.push(entry);
		return id;
	}

	function removeToast(id: string): void {
		const index = toasts.findIndex((t) => t.id === id);
		if (index !== -1) {
			toasts[index].dismissed = true;
		}
	}

	/**
	 * Show a toast notification.
	 * Returns the toast ID for later dismissal.
	 */
	export function toast(message: string, options?: ToastOptions): string {
		return addToast(message, variantFromOptions(options), options);
	}

	/** Show a success toast */
	toast.success = function success(message: string, options?: ToastOptions): string {
		return addToast(message, 'success', { ...options, success: true });
	};

	/** Show an error toast */
	toast.error = function error(message: string, options?: ToastOptions): string {
		return addToast(message, 'error', { ...options, error: true });
	};

	/** Show a warning toast */
	toast.warning = function warning(message: string, options?: ToastOptions): string {
		return addToast(message, 'warning', { ...options, warning: true });
	};

	/** Show a promise toast that transitions through loading/success/error states */
	toast.promise = async function promise<T>(
		p: Promise<T>,
		messages: {
			loading: string;
			success: string | ((result: T) => string);
			error: string | ((err: Error) => string);
		},
		options?: ToastOptions,
	): Promise<T> {
		const id = options?.id ?? generateId();
		addToast(messages.loading, 'loading', {
			...options,
			id,
			persistent: true,
			progress: false,
		});

		try {
			const result = await p;
			const msg =
				typeof messages.success === 'function'
					? messages.success(result)
					: messages.success;
			addToast(msg, 'success', {
				...options,
				id,
				persistent: false,
				progress: true,
				success: true,
			});
			return result;
		} catch (err) {
			const msg =
				typeof messages.error === 'function'
					? messages.error(err instanceof Error ? err : new Error(String(err)))
					: messages.error;
			addToast(msg, 'error', {
				...options,
				id,
				persistent: false,
				progress: true,
				error: true,
			});
			throw err;
		}
	};

	/** Dismiss one or all toasts */
	toast.dismiss = function dismiss(id?: string): void {
		if (id) {
			removeToast(id);
		} else {
			for (const t of toasts) {
				t.dismissed = true;
			}
		}
	};
</script>

<script lang="ts">
	import { portal } from '../actions/Portal.svelte';

	const propId = $props.id();
	let {
		/** Where toasts appear on the screen */
		position = 'bottom-right' as Position,

		/** Maximum number of visible toasts before queuing */
		max_visible = 5,

		/** Spacing between toasts in pixels */
		gap = 8,

		/** Toast width in pixels */
		width = 360,

		/** Default auto-dismiss duration in milliseconds */
		duration = 4000,

		/** Show progress bar by default */
		progress = true,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: className = '',
	} = $props();

	let hovered = $state(false);
	let toaster_el: HTMLDivElement | undefined = $state();

	const is_top = $derived(position.startsWith('top'));

	const visible_toasts = $derived.by(() => {
		const active = toasts.filter((t) => !t.dismissed);
		return active.slice(-max_visible);
	});

	// Cleanup dismissed toasts after animation
	$effect(() => {
		const dismissed = toasts.filter((t) => t.dismissed);
		if (dismissed.length > 0) {
			const timeout = setTimeout(() => {
				toasts = toasts.filter((t) => !t.dismissed);
			}, 200);
			return () => clearTimeout(timeout);
		}
	});

	// Countdown timer using requestAnimationFrame
	$effect(() => {
		if (visible_toasts.length === 0) return;

		let raf_id: number;
		let last_time = performance.now();

		function tick(now: number) {
			const delta = now - last_time;
			last_time = now;

			if (!hovered) {
				for (const t of toasts) {
					if (t.dismissed || t.options.persistent || t.variant === 'loading') continue;
					t.remaining -= delta;
					if (t.remaining <= 0) {
						t.dismissed = true;
					}
				}
			}

			raf_id = requestAnimationFrame(tick);
		}

		raf_id = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf_id);
	});

	// Escape key dismisses most recent toast
	$effect(() => {
		function onKeydown(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				const active = toasts.filter(
					(t) => !t.dismissed && t.options.dismissible !== false,
				);
				if (active.length > 0) {
					active[active.length - 1].dismissed = true;
				}
			}
		}
		document.addEventListener('keydown', onKeydown);
		return () => document.removeEventListener('keydown', onKeydown);
	});

	function getProgressPercent(t: ToastEntry): number {
		const total = t.options.duration ?? duration;
		if (total <= 0) return 0;
		return Math.max(0, Math.min(100, (t.remaining / total) * 100));
	}

	function getRole(t: ToastEntry): string {
		return t.variant === 'warning' || t.variant === 'error' ? 'alert' : 'status';
	}

	function getStackStyle(index: number, total: number): string {
		if (hovered) return '';
		const offset = total - 1 - index;
		if (offset === 0) return '';
		const s = Math.max(0.85, 1 - offset * 0.05);
		const o = Math.max(0.4, 1 - offset * 0.15);
		const y = is_top ? -offset * 6 : offset * 6;
		return `transform: scale(${s}) translateY(${y}px); opacity: ${o};`;
	}

	// Swipe-to-dismiss state
	let swipe_id = $state<string | null>(null);
	let swipe_start_x = $state(0);
	let swipe_offset_x = $state(0);

	function onPointerDown(e: PointerEvent, toast_id: string) {
		if (e.pointerType !== 'touch') return;
		swipe_id = toast_id;
		swipe_start_x = e.clientX;
		swipe_offset_x = 0;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!swipe_id) return;
		swipe_offset_x = e.clientX - swipe_start_x;
	}

	function onPointerUp() {
		if (!swipe_id) return;
		const threshold = width * 0.4;
		if (Math.abs(swipe_offset_x) > threshold) {
			removeToast(swipe_id);
		}
		swipe_id = null;
		swipe_offset_x = 0;
	}

	function getSwipeStyle(toast_id: string): string {
		if (swipe_id !== toast_id || swipe_offset_x === 0) return '';
		const opacity = Math.max(0, 1 - Math.abs(swipe_offset_x) / (width * 0.6));
		return `transform: translateX(${swipe_offset_x}px); opacity: ${opacity};`;
	}

	function showProgress(t: ToastEntry): boolean {
		const toast_progress = t.options.progress ?? progress;
		return toast_progress && !t.options.persistent && t.variant !== 'loading';
	}
</script>

{#if visible_toasts.length > 0}
	<div
		class={['toaster', position, className].filter(Boolean).join(' ')}
		style:--toast-width="{width}px"
		style:--toast-gap="{gap}px"
		{id}
		use:portal={'body'}
		bind:this={toaster_el}
		role="region"
		aria-label="Notifications"
		onmouseenter={() => (hovered = true)}
		onmouseleave={() => (hovered = false)}>
		{#each visible_toasts as t, i (t.id)}
			<div
				class="toast"
				class:success={t.variant === 'success'}
				class:error={t.variant === 'error'}
				class:warning={t.variant === 'warning'}
				class:loading={t.variant === 'loading'}
				class:dismissed={t.dismissed}
				class:hovered
				role={getRole(t)}
				aria-live={t.variant === 'warning' || t.variant === 'error'
					? 'assertive'
					: 'polite'}
				style="{getStackStyle(i, visible_toasts.length)}{getSwipeStyle(t.id)}"
				style:touch-action="pan-y"
				onpointerdown={(e) => onPointerDown(e, t.id)}
				onpointermove={onPointerMove}
				onpointerup={onPointerUp}>
				<!-- Icon -->
				<span class="toast-icon">
					{#if t.variant === 'success'}
						<svg
							viewBox="0 0 24 24"
							width="20"
							height="20"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round">
							<path d="M20 6L9 17l-5-5" />
						</svg>
					{:else if t.variant === 'error'}
						<svg
							viewBox="0 0 24 24"
							width="20"
							height="20"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round">
							<circle cx="12" cy="12" r="10" />
							<line x1="15" y1="9" x2="9" y2="15" />
							<line x1="9" y1="9" x2="15" y2="15" />
						</svg>
					{:else if t.variant === 'warning'}
						<svg
							viewBox="0 0 24 24"
							width="20"
							height="20"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round">
							<path
								d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
							<line x1="12" y1="9" x2="12" y2="13" />
							<line x1="12" y1="17" x2="12.01" y2="17" />
						</svg>
					{:else if t.variant === 'loading'}
						<svg
							class="spinner-icon"
							viewBox="0 0 24 24"
							width="20"
							height="20"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round">
							<path d="M12 2a10 10 0 0110 10" />
						</svg>
					{:else}
						<svg
							viewBox="0 0 24 24"
							width="20"
							height="20"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round">
							<circle cx="12" cy="12" r="10" />
							<line x1="12" y1="16" x2="12" y2="12" />
							<line x1="12" y1="8" x2="12.01" y2="8" />
						</svg>
					{/if}
				</span>

				<!-- Message -->
				<span class="toast-message">{t.message}</span>

				<!-- Action button -->
				{#if t.options.action}
					<button class="toast-action" type="button" onclick={t.options.action.onclick}>
						{t.options.action.label}
					</button>
				{/if}

				<!-- Close button -->
				{#if t.options.dismissible !== false}
					<button
						class="toast-close"
						type="button"
						aria-label="Dismiss notification"
						onclick={() => removeToast(t.id)}>
						<svg
							viewBox="0 0 24 24"
							width="16"
							height="16"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round">
							<line x1="18" y1="6" x2="6" y2="18" />
							<line x1="6" y1="6" x2="18" y2="18" />
						</svg>
					</button>
				{/if}

				<!-- Progress bar -->
				{#if showProgress(t)}
					<div class="toast-progress" style:width="{getProgressPercent(t)}%"></div>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<style>
	.toaster {
		position: fixed;
		z-index: var(--layer-toast, 600);
		display: flex;
		flex-direction: column;
		pointer-events: none;
		padding: 1rem;

		&.bottom-right {
			bottom: 0;
			right: 0;
			align-items: flex-end;
		}
		&.bottom-left {
			bottom: 0;
			left: 0;
			align-items: flex-start;
		}
		&.bottom-center {
			bottom: 0;
			left: 50%;
			transform: translateX(-50%);
			align-items: center;
		}
		&.top-right {
			top: 0;
			right: 0;
			align-items: flex-end;
			flex-direction: column-reverse;
		}
		&.top-left {
			top: 0;
			left: 0;
			align-items: flex-start;
			flex-direction: column-reverse;
		}
		&.top-center {
			top: 0;
			left: 50%;
			transform: translateX(-50%);
			align-items: center;
			flex-direction: column-reverse;
		}
	}

	.toast {
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-radius: var(--radius-md, 0.5rem);
		background: light-dark(white, #1a1a1a);
		box-shadow: var(
			--shadow-lg,
			0 10px 15px -3px rgb(0 0 0 / 0.1),
			0 4px 6px -4px rgb(0 0 0 / 0.1)
		);
		border: 1px solid var(--color-border, rgb(0 0 0 / 0.1));
		width: var(--toast-width, 360px);
		max-width: calc(100vw - 2rem);
		position: relative;
		overflow: hidden;
		margin-bottom: var(--toast-gap, 8px);
		color: light-dark(#1a1a1a, #f5f5f5);
		transition:
			transform 200ms ease,
			opacity 200ms ease;
		animation: toast-enter 200ms ease both;
		cursor: default;

		&.dismissed {
			animation: toast-exit 150ms ease both;
		}

		&.success .toast-icon {
			color: var(--color-success, #16a34a);
		}

		&.error .toast-icon {
			color: var(--color-error, #dc2626);
		}

		&.warning .toast-icon {
			color: var(--color-warning, #d97706);
		}

		&.loading .toast-icon {
			color: var(--color-action, #3b82f6);
		}

		&.hovered {
			transform: none !important;
			opacity: 1 !important;
		}
	}

	.toast-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.toast-message {
		flex: 1;
		font-size: 0.875rem;
		line-height: 1.4;
		word-break: break-word;
	}

	.toast-action {
		flex-shrink: 0;
		padding: 0.25rem 0.625rem;
		font-size: 0.8125rem;
		font-weight: 600;
		border-radius: var(--radius-sm, 0.25rem);
		border: 1px solid var(--color-border, rgb(0 0 0 / 0.1));
		background: transparent;
		color: inherit;
		cursor: pointer;
		white-space: nowrap;
		transition: background 120ms ease;

		&:hover {
			background: light-dark(rgb(0 0 0 / 0.05), rgb(255 255 255 / 0.1));
			transition: none;
		}

		&:active {
			background: light-dark(rgb(0 0 0 / 0.1), rgb(255 255 255 / 0.15));
		}
	}

	.toast-close {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: var(--radius-sm, 0.25rem);
		border: none;
		background: transparent;
		color: light-dark(rgb(0 0 0 / 0.4), rgb(255 255 255 / 0.4));
		cursor: pointer;
		padding: 0;
		transition:
			background 120ms ease,
			color 120ms ease;

		&:hover {
			background: light-dark(rgb(0 0 0 / 0.08), rgb(255 255 255 / 0.12));
			color: light-dark(rgb(0 0 0 / 0.7), rgb(255 255 255 / 0.7));
			transition: none;
		}
	}

	.toast-progress {
		position: absolute;
		bottom: 0;
		left: 0;
		height: 3px;
		background: light-dark(rgb(0 0 0 / 0.12), rgb(255 255 255 / 0.2));
		transition: width 100ms linear;
	}

	.toast.success .toast-progress {
		background: var(--color-success, #16a34a);
		opacity: 0.4;
	}

	.toast.error .toast-progress {
		background: var(--color-error, #dc2626);
		opacity: 0.4;
	}

	.toast.warning .toast-progress {
		background: var(--color-warning, #d97706);
		opacity: 0.4;
	}

	.spinner-icon {
		animation: toast-spin 0.8s linear infinite;
	}

	@keyframes toast-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes toast-enter {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.95);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.toaster.top-right .toast,
	.toaster.top-left .toast,
	.toaster.top-center .toast {
		@keyframes toast-enter {
			from {
				opacity: 0;
				transform: translateY(-8px) scale(0.95);
			}
			to {
				opacity: 1;
				transform: translateY(0) scale(1);
			}
		}
	}

	@keyframes toast-exit {
		to {
			opacity: 0;
			transform: translateX(100%) scale(0.95);
			margin-bottom: 0;
			padding-top: 0;
			padding-bottom: 0;
			max-height: 0;
		}
	}

	.toaster.bottom-left .toast.dismissed,
	.toaster.top-left .toast.dismissed {
		animation-name: toast-exit-left;
	}

	.toaster.bottom-center .toast.dismissed,
	.toaster.top-center .toast.dismissed {
		animation-name: toast-exit-center;
	}

	@keyframes toast-exit-left {
		to {
			opacity: 0;
			transform: translateX(-100%) scale(0.95);
			margin-bottom: 0;
			padding-top: 0;
			padding-bottom: 0;
			max-height: 0;
		}
	}

	@keyframes toast-exit-center {
		to {
			opacity: 0;
			transform: translateY(8px) scale(0.95);
			margin-bottom: 0;
			padding-top: 0;
			padding-bottom: 0;
			max-height: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.toast {
			animation-duration: 0ms !important;
			transition-duration: 0ms !important;
		}

		.toast.dismissed {
			animation: toast-exit-reduced 150ms ease both;
		}

		@keyframes toast-exit-reduced {
			to {
				opacity: 0;
				margin-bottom: 0;
				padding-top: 0;
				padding-bottom: 0;
				max-height: 0;
			}
		}

		.spinner-icon {
			animation: none;
		}

		@keyframes toast-enter {
			from {
				opacity: 0;
			}
			to {
				opacity: 1;
			}
		}
	}
</style>
