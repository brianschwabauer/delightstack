<script lang="ts" module>
	import { DelightError } from '@delightstack/utilities';

	type Position =
		| 'top-left'
		| 'top-center'
		| 'top-right'
		| 'bottom-left'
		| 'bottom-center'
		| 'bottom-right';

	export interface ToastOptions {
		/** Optional secondary line shown beneath the title. */
		description?: string;
		/** Auto-dismiss delay in milliseconds (overrides the Toaster default) */
		duration?: number;
		/** Whether the toast shows a close button */
		dismissible?: boolean;
		/** Style the toast as a success message */
		success?: boolean;
		/** Style the toast as a warning message */
		warning?: boolean;
		/** Style the toast as an error message */
		error?: boolean;
		/** Style the toast as an informational message */
		info?: boolean;
		/** An action button shown in the toast */
		action?: { label: string; onclick: () => void };
		/** Whether the toast stays until manually dismissed (no auto-dismiss) */
		persistent?: boolean;
		/** Custom toast id — reusing an id updates the existing toast in place */
		id?: string;
	}

	type Variant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'loading';

	interface ToastEntry {
		id: string;
		message: string;
		description?: string;
		variant: Variant;
		options: ToastOptions;
		created_at: number;
		duration: number;
		remaining: number;
		dismissed: boolean;
		height: number;
	}

	let toasts = $state<ToastEntry[]>([]);
	let counter = 0;

	// Default auto-dismiss duration. Kept in sync with the primary <Toaster>'s
	// `duration` prop (see the election effect below) so the prop actually works.
	let default_duration = 4000;

	// Single-instance election. Every <Toaster /> shares this one `toasts` store,
	// so only the first-mounted instance ("primary") may render the stack and run
	// the timers. Mounting <Toaster /> more than once (e.g. one per docs demo)
	// then never duplicates the UI or multiplies the auto-dismiss countdown.
	// `registered` is a plain (non-reactive) list used only to elect the next
	// primary on unmount; `primary_token` is the reactive bit that flips renders.
	let registered: number[] = [];
	let primary_token = $state<number | null>(null);
	let election_counter = 0;

	function generateId(): string {
		return `toast-${++counter}-${Date.now()}`;
	}

	function variantFromOptions(options?: ToastOptions): Variant {
		if (options?.error) return 'error';
		if (options?.warning) return 'warning';
		if (options?.success) return 'success';
		if (options?.info) return 'info';
		return 'default';
	}

	function addToast(message: string, variant: Variant, options?: ToastOptions): string {
		const id = options?.id ?? generateId();
		const base_duration = options?.duration ?? default_duration;
		const effective_duration = options?.action ? base_duration + 2000 : base_duration;

		const existing_index = toasts.findIndex((t) => t.id === id);
		if (existing_index !== -1) {
			toasts[existing_index].message = message;
			toasts[existing_index].description =
				options?.description ?? toasts[existing_index].description;
			toasts[existing_index].variant = variant;
			toasts[existing_index].options = { ...toasts[existing_index].options, ...options };
			toasts[existing_index].duration = effective_duration;
			toasts[existing_index].remaining = effective_duration;
			toasts[existing_index].dismissed = false;
			return id;
		}

		const entry: ToastEntry = {
			id,
			message,
			description: options?.description,
			variant,
			options: {
				dismissible: true,
				persistent: false,
				...options,
			},
			created_at: Date.now(),
			duration: effective_duration,
			remaining: effective_duration,
			dismissed: false,
			height: 0,
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

	/** Remove a toast immediately, skipping the standard exit animation. */
	function destroyToast(id: string): void {
		toasts = toasts.filter((t) => t.id !== id);
	}

	/** Show a toast notification. Returns the toast ID for later dismissal. */
	export function toast(message: string, options?: ToastOptions): string {
		return addToast(message, variantFromOptions(options), options);
	}

	toast.success = function success(message: string, options?: ToastOptions): string {
		return addToast(message, 'success', { ...options, success: true });
	};

	toast.error = function error(message: string, options?: ToastOptions): string {
		return addToast(message, 'error', { ...options, error: true });
	};

	toast.warning = function warning(message: string, options?: ToastOptions): string {
		return addToast(message, 'warning', { ...options, warning: true });
	};

	toast.info = function info(message: string, options?: ToastOptions): string {
		return addToast(message, 'info', { ...options, info: true });
	};

	toast.loading = function loading(message: string, options?: ToastOptions): string {
		return addToast(message, 'loading', { ...options, persistent: true });
	};

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
		addToast(messages.loading, 'loading', { ...options, id, persistent: true });

		try {
			const result = await p;
			const msg =
				typeof messages.success === 'function'
					? messages.success(result)
					: messages.success;
			addToast(msg, 'success', { ...options, id, persistent: false, success: true });
			return result;
		} catch (err) {
			const msg =
				typeof messages.error === 'function'
					? messages.error(err instanceof Error ? err : new DelightError(String(err)))
					: messages.error;
			addToast(msg, 'error', { ...options, id, persistent: false, error: true });
			throw err;
		}
	};

	toast.dismiss = function dismiss(id?: string): void {
		if (id) {
			removeToast(id);
		} else {
			for (const t of toasts) t.dismissed = true;
		}
	};
</script>

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { portal } from '../actions/Portal.svelte';
	import Button from '../actions/Button.svelte';
	import Progress from './Progress.svelte';

	const propId = $props.id();
	let {
		/** Where toasts appear on the screen */
		position = 'bottom-right' as Position,

		/** Maximum number of visible toasts before the rest are queued behind */
		max_visible = 3,

		/** Gap between toasts when the stack is expanded (px) */
		gap = 14,

		/** Toast width in pixels */
		width = 356,

		/** Default auto-dismiss duration in milliseconds */
		duration = 4000,

		/** Use saturated, variant-colored toast backgrounds (sonner "rich colors"). */
		rich_colors = false,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: class_name = '',
	} = $props();

	// --- Single-instance election --------------------------------------------
	// Register/deregister in lifecycle hooks (not an $effect) so we never read and
	// write the same reactive value during tracking — that would self-invalidate
	// and loop forever. Only `primary_token` is reactive, so flipping it re-renders.
	const my_token = ++election_counter;
	onMount(() => {
		registered.push(my_token);
		if (primary_token === null) primary_token = my_token;
	});
	onDestroy(() => {
		clearTimeout(collapse_timer);
		const i = registered.indexOf(my_token);
		if (i !== -1) registered.splice(i, 1);
		if (primary_token === my_token) primary_token = registered[0] ?? null;
	});
	const is_primary = $derived(primary_token === my_token);

	// Keep the shared default duration in sync with the primary Toaster.
	$effect(() => {
		if (is_primary) default_duration = duration;
	});

	let expanded = $state(false);
	let collapse_timer: ReturnType<typeof setTimeout> | undefined;
	let toaster_el: HTMLDivElement | undefined = $state();

	const is_top = $derived(position.startsWith('top'));
	const is_center = $derived(position.endsWith('center'));
	const align = $derived(
		position.endsWith('left') ? 'left' : position.endsWith('right') ? 'right' : 'center',
	);

	// Active (non-dismissed) toasts, newest last. The newest is the "front".
	const active_toasts = $derived(toasts.filter((t) => !t.dismissed));
	// Visible set: the most recent `max_visible`. Render dismissed ones too so
	// their exit animation can play.
	const rendered = $derived.by(() => {
		const recent = active_toasts.slice(-max_visible);
		const recentIds = new Set(recent.map((t) => t.id));
		return toasts.filter((t) => recentIds.has(t.id) || t.dismissed);
	});

	// 0 = front, 1 = one behind, etc. Dismissed toasts keep their last position.
	function frontDistance(t: ToastEntry): number {
		const idx = active_toasts.indexOf(t);
		if (idx === -1) return 0;
		return active_toasts.length - 1 - idx;
	}

	// Cleanup fully dismissed toasts after their exit animation.
	$effect(() => {
		if (!is_primary) return;
		const hasDismissed = toasts.some((t) => t.dismissed);
		if (hasDismissed) {
			const timeout = setTimeout(() => {
				toasts = toasts.filter((t) => !t.dismissed);
			}, 320);
			return () => clearTimeout(timeout);
		}
	});

	// Auto-dismiss countdown. Runs only on the primary instance (so multiple
	// mounted Toasters never multiply the rate) and pauses while the stack is
	// hovered or a toast is being dragged.
	$effect(() => {
		if (!is_primary) return;
		if (active_toasts.length === 0) return;
		let raf_id: number;
		let last_time = performance.now();
		function tick(now: number) {
			const delta = now - last_time;
			last_time = now;
			const paused = expanded || swipe_id !== null;
			if (!paused) {
				for (const t of toasts) {
					if (t.dismissed || t.options.persistent || t.variant === 'loading') continue;
					t.remaining -= delta;
					if (t.remaining <= 0) t.dismissed = true;
				}
			}
			raf_id = requestAnimationFrame(tick);
		}
		raf_id = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf_id);
	});

	// Escape dismisses the front toast.
	$effect(() => {
		if (!is_primary) return;
		function onKeydown(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				const active = active_toasts.filter((t) => t.options.dismissible !== false);
				if (active.length > 0) active[active.length - 1].dismissed = true;
			}
		}
		document.addEventListener('keydown', onKeydown);
		return () => document.removeEventListener('keydown', onKeydown);
	});

	function getRole(t: ToastEntry): string {
		return t.variant === 'warning' || t.variant === 'error' ? 'alert' : 'status';
	}

	function measure(node: HTMLElement, t: ToastEntry) {
		const update = () => {
			const h = node.offsetHeight;
			if (h && t.height !== h) t.height = h;
		};
		update();
		const ro = new ResizeObserver(update);
		ro.observe(node);
		return { destroy: () => ro.disconnect() };
	}

	// Cumulative offset for the expanded stack: sum of heights+gap of the toasts
	// in front of this one (the newer toasts between it and the anchor edge).
	function expandedOffset(t: ToastEntry): number {
		let offset = 0;
		const idx = active_toasts.indexOf(t);
		if (idx === -1) return 0;
		for (let i = idx + 1; i < active_toasts.length; i++) {
			offset += (active_toasts[i].height || 64) + gap;
		}
		return offset;
	}

	// --- Swipe-to-dismiss (pointer based — mouse + touch, like sonner) --------
	let swipe_id = $state<string | null>(null);
	let swipe_delta = $state(0);
	let swipe_settling = $state(false);
	let swipe_settle_ms = $state(300);
	let swipe_ease = $state('cubic-bezier(0.22, 1, 0.36, 1)');
	let swipe_axis: 'X' | 'Y' = 'X';
	let swipe_start = 0;
	let last_pos = 0;
	let last_time = 0;
	let velocity = 0;
	let settle_timer: ReturnType<typeof setTimeout> | undefined;

	function onPointerDown(e: PointerEvent, t: ToastEntry) {
		if (t.options.dismissible === false || swipe_settling) return;
		// Don't start a drag from interactive children (close / action buttons).
		if ((e.target as HTMLElement).closest('button, a')) return;
		// Only start from the toast card itself, not its surrounding hover-halo.
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		if (
			e.clientX < rect.left ||
			e.clientX > rect.right ||
			e.clientY < rect.top ||
			e.clientY > rect.bottom
		)
			return;
		// Horizontal stacks swipe left/right; centered stacks swipe up/down.
		// Either direction dismisses (more forgiving than edge-only).
		swipe_axis = is_center ? 'Y' : 'X';
		swipe_id = t.id;
		swipe_delta = 0;
		swipe_settling = false;
		swipe_start = swipe_axis === 'Y' ? e.clientY : e.clientX;
		last_pos = swipe_start;
		last_time = performance.now();
		velocity = 0;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!swipe_id || swipe_settling) return;
		const pos = swipe_axis === 'Y' ? e.clientY : e.clientX;
		const now = performance.now();
		const dt = now - last_time;
		if (dt > 0) velocity = (pos - last_pos) / dt; // signed px/ms
		last_pos = pos;
		last_time = now;
		swipe_delta = pos - swipe_start; // bidirectional, no rubber-banding
	}

	function onPointerUp(e: PointerEvent) {
		if (!swipe_id) return;
		const id = swipe_id;
		try {
			(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		} catch {
			/* pointer already released */
		}

		const threshold = swipe_axis === 'Y' ? 40 : width * 0.25;
		const dismiss = Math.abs(swipe_delta) > threshold || Math.abs(velocity) > 0.45;

		// A pure tap (no movement) needs no settle animation.
		if (!dismiss && swipe_delta === 0) {
			swipe_id = null;
			return;
		}

		swipe_settling = true;
		clearTimeout(settle_timer);

		if (dismiss) {
			// Throw it off-screen in the swipe direction, continuing its momentum.
			const dir = swipe_delta !== 0 ? Math.sign(swipe_delta) : Math.sign(velocity) || 1;
			const fly = (swipe_axis === 'Y' ? 240 : width * 1.4) * dir;
			const speed = Math.max(Math.abs(velocity), 0.6); // px/ms
			const remaining = Math.max(0, Math.abs(fly - swipe_delta));
			swipe_settle_ms = Math.min(380, Math.max(140, remaining / speed));
			swipe_ease = 'cubic-bezier(0.32, 0.72, 0, 1)';
			swipe_delta = fly;
			settle_timer = setTimeout(() => {
				destroyToast(id);
				swipe_id = null;
				swipe_settling = false;
			}, swipe_settle_ms);
		} else {
			// Cancelled — spring back into place.
			swipe_settle_ms = 320;
			swipe_ease = 'cubic-bezier(0.34, 1.4, 0.5, 1)';
			swipe_delta = 0;
			settle_timer = setTimeout(() => {
				swipe_id = null;
				swipe_settling = false;
			}, swipe_settle_ms);
		}
	}

	// Full transform for a toast: stack position + (optional) live swipe offset.
	function toastStyle(t: ToastEntry): string {
		const dist = frontDistance(t);
		const dir = is_top ? 1 : -1;
		let ty: number;
		let scale: number;
		let opacity: number;
		if (expanded) {
			ty = expandedOffset(t) * dir;
			scale = 1;
			opacity = 1;
		} else {
			ty = 16 * dist * dir;
			scale = Math.max(0.9, 1 - dist * 0.06);
			opacity = dist >= max_visible ? 0 : 1;
		}
		const z = 1000 - dist;

		if (swipe_id === t.id) {
			const fade_dim = swipe_axis === 'Y' ? 120 : width * 0.6;
			opacity *= Math.max(0, 1 - Math.abs(swipe_delta) / fade_dim);
			const sx = swipe_axis === 'X' ? swipe_delta : 0;
			const sy = swipe_axis === 'Y' ? swipe_delta : 0;
			const transition = swipe_settling
				? `transform ${swipe_settle_ms}ms ${swipe_ease}, opacity ${swipe_settle_ms}ms ease`
				: 'transform 0s, opacity 0s';
			return `transform: translate(${sx}px, ${sy}px) translateY(${ty}px) scale(${scale}); opacity: ${opacity}; z-index: ${z}; transition: ${transition};`;
		}

		return `transform: translateY(${ty}px) scale(${scale}); opacity: ${opacity}; z-index: ${z};`;
	}
</script>

{#if is_primary && rendered.length > 0}
	<div
		class={['toaster', position, `align-${align}`, class_name].filter(Boolean).join(' ')}
		class:expanded
		class:is-top={is_top}
		class:rich={rich_colors}
		style:--toast-width="{width}px"
		style:--toast-gap="{gap}px"
		{id}
		use:portal={'body'}
		bind:this={toaster_el}
		role="region"
		aria-label="Notifications"
		onmouseenter={() => {
			clearTimeout(collapse_timer);
			expanded = true;
		}}
		onmouseleave={() => {
			if (swipe_id) return;
			// Grace period before collapsing. Dismissing a toast removes the one
			// under the cursor (it stops capturing pointer events), which fires
			// mouseleave — without this delay the stack would snap shut between
			// clicks, forcing a re-hover to dismiss the next one. Moving to the
			// next toast within the window cancels the collapse.
			clearTimeout(collapse_timer);
			collapse_timer = setTimeout(() => (expanded = false), 500);
		}}>
		{#each rendered as t (t.id)}
			<div
				class="toast"
				class:success={t.variant === 'success'}
				class:error={t.variant === 'error'}
				class:warning={t.variant === 'warning'}
				class:info={t.variant === 'info'}
				class:loading={t.variant === 'loading'}
				class:dismissed={t.dismissed}
				class:front={frontDistance(t) === 0}
				role={getRole(t)}
				aria-live={t.variant === 'warning' || t.variant === 'error'
					? 'assertive'
					: 'polite'}
				use:measure={t}
				style={toastStyle(t)}
				style:touch-action={is_center ? 'pan-x' : 'pan-y'}
				onpointerdown={(e) => onPointerDown(e, t)}
				onpointermove={onPointerMove}
				onpointerup={onPointerUp}
				onpointercancel={onPointerUp}>
				<div class="inner">
					<span class="icon">
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
							<Progress size="00" color="currentColor" />
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

					<div class="content">
						<div class="title">{t.message}</div>
						{#if t.description}
							<div class="description">{t.description}</div>
						{/if}
					</div>

					{#if t.options.action}
						<div class="action">
							<Button
								dense
								size="0"
								onclick={() => {
									t.options.action?.onclick();
									removeToast(t.id);
								}}>
								{t.options.action.label}
							</Button>
						</div>
					{/if}
				</div>

				{#if t.options.dismissible !== false}
					<div class="close">
						<Button
							icon
							transparent
							dense
							aria-label="Dismiss notification"
							onclick={() => removeToast(t.id)}>
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.2"
								stroke-linecap="round"
								stroke-linejoin="round">
								<line x1="18" y1="6" x2="6" y2="18" />
								<line x1="6" y1="6" x2="18" y2="18" />
							</svg>
						</Button>
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<style>
	.toaster {
		position: fixed;
		z-index: var(--layer-toast, 600);
		width: var(--toast-width, 356px);
		max-width: calc(100vw - 2rem);
		pointer-events: none;
		--toast-bg: light-dark(#fff, #1c1c1f);
		--toast-fg: light-dark(#18181b, #f4f4f5);
		--toast-border: light-dark(rgb(0 0 0 / 0.08), rgb(255 255 255 / 0.1));

		&.bottom-right {
			bottom: 1rem;
			right: 1rem;
		}
		&.bottom-left {
			bottom: 1rem;
			left: 1rem;
		}
		&.bottom-center {
			bottom: 1rem;
			left: 50%;
			transform: translateX(-50%);
		}
		&.top-right {
			top: 1rem;
			right: 1rem;
		}
		&.top-left {
			top: 1rem;
			left: 1rem;
		}
		&.top-center {
			top: 1rem;
			left: 50%;
			transform: translateX(-50%);
		}
	}

	/* Each toast is absolutely positioned within the toaster and offset by JS
	 * (collapsed stack vs. expanded list), giving the sonner pile-up effect. */
	.toast {
		position: absolute;
		left: 0;
		right: 0;
		pointer-events: auto;
		width: 100%;
		border-radius: var(--radius-lg, 12px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-lg, 12px) * var(--squircle-ratio, 2));
		}
		background-color: var(--toast-bg);
		color: var(--toast-fg);
		border: 1px solid var(--toast-border);
		box-shadow:
			0 4px 12px rgb(0 0 0 / 0.1),
			0 2px 4px rgb(0 0 0 / 0.06);
		cursor: default;
		/* Stacked <-> expanded reflow: fast + strong ease-out (quintOut). */
		transition:
			transform 200ms cubic-bezier(0.22, 1, 0.36, 1),
			opacity 300ms ease,
			box-shadow 250ms ease;
		/* `backwards` (not `both`): the enter keyframe only fills BEFORE the run,
		 * so once it finishes it releases the transform back to the base value and
		 * the stacked<->expanded transition can animate it. A lingering `both`
		 * fill would keep overriding transform and make expand/collapse jump. */
		animation: toast-enter 350ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
		transform-origin: center top;
	}
	.toaster:is(.bottom-right, .bottom-left, .bottom-center) .toast {
		bottom: 0;
		transform-origin: center bottom;
		--enter-from: 100%;
	}
	.toaster:is(.top-right, .top-left, .top-center) .toast {
		top: 0;
		--enter-from: -100%;
	}

	/* Slightly lift the stack while expanded for a sense of depth. */
	.toaster.expanded .toast {
		box-shadow:
			0 8px 24px rgb(0 0 0 / 0.14),
			0 3px 8px rgb(0 0 0 / 0.08);

		/* While expanded, each toast carries a transparent hit-area halo extending
		 * ~22px beyond it on every side (sits behind the card via z-index:-1 so it
		 * never blocks the buttons). Adjacent halos overlap, so (a) moving the pointer
		 * between fanned-out toasts keeps the stack open, and (b) you must move a
		 * comfortable margin past the list before it collapses back to a stack. */
		&::before {
			content: '';
			position: absolute;
			inset: calc(-1 * var(--toast-hover-pad, 22px));
			z-index: -1;
		}
	}

	.inner {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1rem 1rem;
	}

	.icon {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 20px;
		height: 20px;
		margin-top: 0.05rem;

		.toast.success & {
			color: var(--color-success, #16a34a);
		}
		.toast.error & {
			color: var(--color-error, #dc2626);
		}
		.toast.warning & {
			color: var(--color-warning, #d97706);
		}
		.toast.info & {
			color: var(--color-action, #3b82f6);
		}
		.toast.loading & {
			color: var(--color-action, #3b82f6);
		}

		/* The success check pops in with a spring scale while its stroke draws
		 * itself on — most visible when a promise toast's spinner flips to the
		 * confirmation, instead of the check just blinking into place. */
		.toast.success & svg {
			animation: toast-check-pop 400ms cubic-bezier(0.34, 1.56, 0.64, 1) backwards;

			path {
				/* Dash length >= the tick's path length (~23px) so `from` hides it fully */
				stroke-dasharray: 24;
				animation: toast-check-draw 350ms cubic-bezier(0.22, 1, 0.36, 1) 80ms backwards;
			}
		}
	}
	@keyframes toast-check-pop {
		from {
			transform: scale(0.3);
			opacity: 0;
		}
	}
	@keyframes toast-check-draw {
		from {
			stroke-dashoffset: 24;
		}
	}

	.content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.title {
		font-size: 0.875rem;
		font-weight: 600;
		line-height: 1.4;
		word-break: break-word;
	}
	.description {
		font-size: 0.8125rem;
		line-height: 1.4;
		opacity: 0.75;
		word-break: break-word;
	}

	.action {
		flex-shrink: 0;
		align-self: center;
	}

	.close {
		position: absolute;
		top: 0;
		left: 0;
		font-size: 7.5px; /* scales the icon Button (4em) to 30px, host-independent */
		transform: translate(-35%, -35%);
		border-radius: 50%;
		background: var(--toast-bg);
		box-shadow: 0 0 0 1px var(--toast-border);
		opacity: 0;
		transition: opacity 150ms ease;

		.toaster.expanded .toast &,
		.toast.front &,
		.toast:hover & {
			opacity: 1;
		}

		.toaster.align-right & {
			left: auto;
			right: 0;
			transform: translate(35%, -35%);
		}
	}

	/* Subtle variant tint (default mode): faint wash + colored border. */
	.toast.success {
		--toast-accent: var(--color-success, #16a34a);
	}
	.toast.error {
		--toast-accent: var(--color-error, #dc2626);
	}
	.toast.warning {
		--toast-accent: var(--color-warning, #d97706);
	}
	.toast.info {
		--toast-accent: var(--color-action, #3b82f6);
	}
	.toast:is(.success, .error, .warning, .info) {
		background-color: color-mix(in oklch, var(--toast-accent) 6%, var(--toast-bg));
		border-color: color-mix(in oklch, var(--toast-accent) 28%, var(--toast-border));
		box-shadow:
			0 4px 12px rgb(0 0 0 / 0.1),
			0 2px 4px rgb(0 0 0 / 0.06),
			inset 0 0 0 1px color-mix(in oklch, var(--toast-accent) 10%, transparent);
	}
	.toaster.expanded .toast:is(.success, .error, .warning, .info) {
		box-shadow:
			0 8px 24px rgb(0 0 0 / 0.14),
			0 3px 8px rgb(0 0 0 / 0.08),
			inset 0 0 0 1px color-mix(in oklch, var(--toast-accent) 10%, transparent);
	}

	/* Rich colors — saturated variant surfaces (overrides the subtle tint). */
	.toaster.rich .toast {
		&.success {
			--toast-bg: light-dark(#ecfdf5, #052e1a);
			--toast-fg: light-dark(#065f46, #6ee7b7);
			--toast-border: light-dark(#a7f3d0, #065f46);
		}
		&.error {
			--toast-bg: light-dark(#fef2f2, #2d0a0a);
			--toast-fg: light-dark(#991b1b, #fca5a5);
			--toast-border: light-dark(#fecaca, #7f1d1d);
		}
		&.warning {
			--toast-bg: light-dark(#fffbeb, #2b1c00);
			--toast-fg: light-dark(#92400e, #fcd34d);
			--toast-border: light-dark(#fde68a, #78350f);
		}
		&.info {
			--toast-bg: light-dark(#eff6ff, #0a1b2e);
			--toast-fg: light-dark(#1e40af, #93c5fd);
			--toast-border: light-dark(#bfdbfe, #1e3a8a);
		}
		&:is(.success, .error, .warning, .info) {
			background-color: var(--toast-bg);
			border-color: var(--toast-border);
			box-shadow:
				0 4px 12px rgb(0 0 0 / 0.1),
				0 2px 4px rgb(0 0 0 / 0.06);
		}
		.icon {
			color: currentColor;
		}
	}

	.toast.dismissed {
		animation: toast-exit 320ms cubic-bezier(0.22, 1, 0.36, 1) both;
		pointer-events: none;
	}

	@keyframes toast-enter {
		from {
			opacity: 0;
			transform: translateY(var(--enter-from, 100%)) scale(0.9);
		}
	}

	@keyframes toast-exit {
		to {
			opacity: 0;
			transform: translateY(var(--enter-from, 100%)) scale(0.9);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.toast {
			animation-duration: 1ms !important;
			transition-duration: 1ms !important;
		}
		.toast.success .icon svg,
		.toast.success .icon svg path {
			animation: none;
		}
		.toast.dismissed {
			animation: toast-exit-reduced 150ms ease both;
		}
		@keyframes toast-exit-reduced {
			to {
				opacity: 0;
			}
		}
	}
</style>
