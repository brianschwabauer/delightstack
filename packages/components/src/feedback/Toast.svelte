<script lang="ts" module>
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
		duration?: number;
		dismissible?: boolean;
		success?: boolean;
		warning?: boolean;
		error?: boolean;
		info?: boolean;
		action?: { label: string; onclick: () => void };
		persistent?: boolean;
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
		const base_duration = options?.duration ?? 4000;
		const effective_duration = options?.action ? base_duration + 2000 : base_duration;

		const existing_index = toasts.findIndex((t) => t.id === id);
		if (existing_index !== -1) {
			toasts[existing_index].message = message;
			toasts[existing_index].description = options?.description ?? toasts[existing_index].description;
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
				typeof messages.success === 'function' ? messages.success(result) : messages.success;
			addToast(msg, 'success', { ...options, id, persistent: false, success: true });
			return result;
		} catch (err) {
			const msg =
				typeof messages.error === 'function'
					? messages.error(err instanceof Error ? err : new Error(String(err)))
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
	import { portal } from '../actions/Portal.svelte';

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
		richColors = false,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: className = '',
	} = $props();

	let expanded = $state(false);
	let toaster_el: HTMLDivElement | undefined = $state();

	const is_top = $derived(position.startsWith('top'));
	const is_center = $derived(position.endsWith('center'));
	const align = $derived(position.endsWith('left') ? 'left' : position.endsWith('right') ? 'right' : 'center');

	// Active (non-dismissed) toasts, newest last. The newest is the "front".
	const active_toasts = $derived(toasts.filter((t) => !t.dismissed));
	// Visible set: the most recent `max_visible`. Render dismissed ones too so
	// their exit animation can play.
	const rendered = $derived.by(() => {
		const recent = active_toasts.slice(-max_visible);
		const recentIds = new Set(recent.map((t) => t.id));
		// Keep dismissed toasts mounted briefly so their exit animation plays.
		return toasts.filter((t) => recentIds.has(t.id) || t.dismissed);
	});

	// Front index within active toasts (last = front).
	function frontDistance(t: ToastEntry): number {
		// 0 = front, 1 = one behind, etc. Dismissed toasts keep their last position.
		const idx = active_toasts.indexOf(t);
		if (idx === -1) return 0;
		return active_toasts.length - 1 - idx;
	}

	// Cleanup fully dismissed toasts after their exit animation.
	$effect(() => {
		const dismissed = toasts.filter((t) => t.dismissed);
		if (dismissed.length > 0) {
			const timeout = setTimeout(() => {
				toasts = toasts.filter((t) => !t.dismissed);
			}, 300);
			return () => clearTimeout(timeout);
		}
	});

	// Auto-dismiss countdown.
	$effect(() => {
		if (active_toasts.length === 0) return;
		let raf_id: number;
		let last_time = performance.now();
		function tick(now: number) {
			const delta = now - last_time;
			last_time = now;
			if (!expanded) {
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

	// Cumulative offset for the expanded stack: sum of heights+gap of the
	// toasts in front of this one.
	function expandedOffset(t: ToastEntry): number {
		let offset = 0;
		const idx = active_toasts.indexOf(t);
		if (idx === -1) return 0;
		for (let i = idx + 1; i < active_toasts.length; i++) {
			offset += (active_toasts[i].height || 64) + gap;
		}
		return offset;
	}

	function toastStyle(t: ToastEntry): string {
		const dist = frontDistance(t);
		const dir = is_top ? 1 : -1;
		if (expanded) {
			const y = expandedOffset(t) * dir;
			return `transform: translateY(${y}px) scale(1); opacity: 1; z-index: ${1000 - dist};`;
		}
		// Collapsed: front toast at 0, others peek behind with a small offset + scale.
		const peek = 16 * dist * dir;
		const scale = Math.max(0.9, 1 - dist * 0.06);
		const opacity = dist >= max_visible ? 0 : 1;
		return `transform: translateY(${peek}px) scale(${scale}); opacity: ${opacity}; z-index: ${1000 - dist};`;
	}

	// Swipe-to-dismiss (pointer based — works for mouse + touch like sonner).
	let swipe_id = $state<string | null>(null);
	let swipe_start = $state(0);
	let swipe_offset = $state(0);

	function onPointerDown(e: PointerEvent, t: ToastEntry) {
		if (t.options.dismissible === false) return;
		swipe_id = t.id;
		swipe_start = is_center ? e.clientY : e.clientX;
		swipe_offset = 0;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onPointerMove(e: PointerEvent) {
		if (!swipe_id) return;
		const cur = is_center ? e.clientY : e.clientX;
		swipe_offset = cur - swipe_start;
		// Only allow swiping in the dismiss direction for center positions
		if (is_center) {
			if (is_top && swipe_offset > 0) swipe_offset = 0;
			if (!is_top && swipe_offset < 0) swipe_offset = 0;
		}
	}
	function onPointerUp() {
		if (!swipe_id) return;
		const dim = is_center ? 60 : width * 0.35;
		if (Math.abs(swipe_offset) > dim) removeToast(swipe_id);
		swipe_id = null;
		swipe_offset = 0;
	}
	function swipeStyle(t: ToastEntry): string {
		if (swipe_id !== t.id || swipe_offset === 0) return '';
		const axis = is_center ? 'Y' : 'X';
		const dim = is_center ? 120 : width * 0.6;
		const opacity = Math.max(0, 1 - Math.abs(swipe_offset) / dim);
		return `transform: translate${axis}(${swipe_offset}px); opacity: ${opacity}; transition: none;`;
	}
</script>

{#if rendered.length > 0}
	<div
		class={['toaster', position, `align-${align}`, className].filter(Boolean).join(' ')}
		class:expanded
		class:rich={richColors}
		style:--toast-width="{width}px"
		{id}
		use:portal={'body'}
		bind:this={toaster_el}
		role="region"
		aria-label="Notifications"
		onmouseenter={() => (expanded = true)}
		onmouseleave={() => (expanded = false)}>
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
				aria-live={t.variant === 'warning' || t.variant === 'error' ? 'assertive' : 'polite'}
				use:measure={t}
				style={`${toastStyle(t)}${swipeStyle(t)}`}
				style:touch-action={is_center ? 'pan-x' : 'pan-y'}
				onpointerdown={(e) => onPointerDown(e, t)}
				onpointermove={onPointerMove}
				onpointerup={onPointerUp}
				onpointercancel={onPointerUp}>
				<div class="toast-inner">
					<span class="toast-icon">
						{#if t.variant === 'success'}
							<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M20 6L9 17l-5-5" />
							</svg>
						{:else if t.variant === 'error'}
							<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<circle cx="12" cy="12" r="10" />
								<line x1="15" y1="9" x2="9" y2="15" />
								<line x1="9" y1="9" x2="15" y2="15" />
							</svg>
						{:else if t.variant === 'warning'}
							<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
								<line x1="12" y1="9" x2="12" y2="13" />
								<line x1="12" y1="17" x2="12.01" y2="17" />
							</svg>
						{:else if t.variant === 'loading'}
							<svg class="spinner-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
								<path d="M12 2a10 10 0 0110 10" />
							</svg>
						{:else}
							<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<circle cx="12" cy="12" r="10" />
								<line x1="12" y1="16" x2="12" y2="12" />
								<line x1="12" y1="8" x2="12.01" y2="8" />
							</svg>
						{/if}
					</span>

					<div class="toast-content">
						<div class="toast-title">{t.message}</div>
						{#if t.description}
							<div class="toast-description">{t.description}</div>
						{/if}
					</div>

					{#if t.options.action}
						<button class="toast-action" type="button" onclick={t.options.action.onclick}>
							{t.options.action.label}
						</button>
					{/if}
				</div>

				{#if t.options.dismissible !== false}
					<button
						class="toast-close"
						type="button"
						aria-label="Dismiss notification"
						onclick={() => removeToast(t.id)}>
						<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<line x1="18" y1="6" x2="6" y2="18" />
							<line x1="6" y1="6" x2="18" y2="18" />
						</svg>
					</button>
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

		&.bottom-right { bottom: 1rem; right: 1rem; }
		&.bottom-left { bottom: 1rem; left: 1rem; }
		&.bottom-center { bottom: 1rem; left: 50%; transform: translateX(-50%); }
		&.top-right { top: 1rem; right: 1rem; }
		&.top-left { top: 1rem; left: 1rem; }
		&.top-center { top: 1rem; left: 50%; transform: translateX(-50%); }
	}

	/* Each toast is absolutely positioned within the toaster and offset by JS
	 * (collapsed stack vs. expanded list), giving the sonner pile-up effect. */
	.toast {
		position: absolute;
		left: 0;
		right: 0;
		pointer-events: auto;
		width: 100%;
		border-radius: var(--radius-3, 12px);
		background: var(--toast-bg);
		color: var(--toast-fg);
		border: 1px solid var(--toast-border);
		box-shadow:
			0 4px 12px rgb(0 0 0 / 0.1),
			0 2px 4px rgb(0 0 0 / 0.06);
		cursor: default;
		transition:
			transform 400ms cubic-bezier(0.22, 1, 0.36, 1),
			opacity 350ms ease,
			box-shadow 200ms ease;
		animation: toast-enter 400ms cubic-bezier(0.22, 1, 0.36, 1) both;
		transform-origin: center top;
	}
	.toaster.bottom-right .toast,
	.toaster.bottom-left .toast,
	.toaster.bottom-center .toast {
		bottom: 0;
		transform-origin: center bottom;
	}
	.toaster.top-right .toast,
	.toaster.top-left .toast,
	.toaster.top-center .toast {
		top: 0;
	}

	.toast-inner {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1rem 1rem;
	}

	.toast-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		margin-top: 0.05rem;
	}
	.toast.success .toast-icon { color: var(--color-success, #16a34a); }
	.toast.error .toast-icon { color: var(--color-error, #dc2626); }
	.toast.warning .toast-icon { color: var(--color-warning, #d97706); }
	.toast.info .toast-icon { color: var(--color-action, #3b82f6); }
	.toast.loading .toast-icon { color: var(--color-action, #3b82f6); }

	.toast-content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.toast-title {
		font-size: 0.875rem;
		font-weight: 600;
		line-height: 1.4;
		word-break: break-word;
	}
	.toast-description {
		font-size: 0.8125rem;
		line-height: 1.4;
		opacity: 0.75;
		word-break: break-word;
	}

	.toast-action {
		flex-shrink: 0;
		align-self: center;
		padding: 0.35rem 0.7rem;
		font-size: 0.8125rem;
		font-weight: 600;
		border-radius: var(--radius-2, 6px);
		border: none;
		background: var(--toast-fg);
		color: var(--toast-bg);
		cursor: pointer;
		white-space: nowrap;
		transition: opacity 120ms ease, translate 150ms ease;
	}
	.toast-action:hover { opacity: 0.85; }
	.toast-action:active { translate: 0 1px; }

	.toast-close {
		position: absolute;
		top: 0;
		left: 0;
		transform: translate(-35%, -35%);
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 50%;
		border: 1px solid var(--toast-border);
		background: var(--toast-bg);
		color: var(--toast-fg);
		cursor: pointer;
		padding: 0;
		opacity: 0;
		transition: opacity 150ms ease, background 120ms ease;
	}
	.toaster.expanded .toast .toast-close,
	.toast.front .toast-close {
		opacity: 1;
	}
	.toaster.align-right .toast-close {
		left: auto;
		right: 0;
		transform: translate(35%, -35%);
	}
	.toast-close:hover {
		background: light-dark(rgb(0 0 0 / 0.06), rgb(255 255 255 / 0.12));
	}

	/* Rich colors */
	.toaster.rich .toast.success {
		--toast-bg: light-dark(#ecfdf5, #052e1a);
		--toast-fg: light-dark(#065f46, #6ee7b7);
		--toast-border: light-dark(#a7f3d0, #065f46);
	}
	.toaster.rich .toast.error {
		--toast-bg: light-dark(#fef2f2, #2d0a0a);
		--toast-fg: light-dark(#991b1b, #fca5a5);
		--toast-border: light-dark(#fecaca, #7f1d1d);
	}
	.toaster.rich .toast.warning {
		--toast-bg: light-dark(#fffbeb, #2b1c00);
		--toast-fg: light-dark(#92400e, #fcd34d);
		--toast-border: light-dark(#fde68a, #78350f);
	}
	.toaster.rich .toast.info {
		--toast-bg: light-dark(#eff6ff, #0a1b2e);
		--toast-fg: light-dark(#1e40af, #93c5fd);
		--toast-border: light-dark(#bfdbfe, #1e3a8a);
	}
	.toaster.rich .toast .toast-icon { color: currentColor; }

	.toast.dismissed {
		animation: toast-exit 300ms cubic-bezier(0.22, 1, 0.36, 1) both;
		pointer-events: none;
	}

	.spinner-icon {
		animation: toast-spin 0.8s linear infinite;
	}
	@keyframes toast-spin {
		to { transform: rotate(360deg); }
	}

	@keyframes toast-enter {
		from { opacity: 0; transform: translateY(var(--enter-from, 100%)) scale(0.9); }
	}
	.toaster.bottom-right .toast,
	.toaster.bottom-left .toast,
	.toaster.bottom-center .toast {
		--enter-from: 100%;
	}
	.toaster.top-right .toast,
	.toaster.top-left .toast,
	.toaster.top-center .toast {
		--enter-from: -100%;
	}

	@keyframes toast-exit {
		to { opacity: 0; transform: translateY(var(--enter-from, 100%)) scale(0.9); }
	}

	@media (prefers-reduced-motion: reduce) {
		.toast {
			animation-duration: 1ms !important;
			transition-duration: 1ms !important;
		}
		.toast.dismissed {
			animation: toast-exit-reduced 150ms ease both;
		}
		@keyframes toast-exit-reduced {
			to { opacity: 0; }
		}
		.spinner-icon { animation: none; }
	}
</style>
