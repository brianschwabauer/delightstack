<script lang="ts">
	import type { Snippet } from 'svelte';

	const propId = $props.id();
	let {
		/** Success variant styling */
		success = false,

		/** Warning variant styling */
		warning = false,

		/** Error variant styling */
		error = false,

		/** Tip variant styling (uses accent color) */
		tip = false,

		/** Full-width banner mode with solid background and white text */
		banner = false,

		/** Optional heading text */
		title = '',

		/** Show a close/dismiss button */
		dismissible = false,

		/** Stick to top on scroll (banner mode only) */
		sticky = false,

		/** Compact padding */
		dense = false,

		/** Relaxed padding */
		comfortable = false,

		/** Loading skeleton state */
		skeleton = false,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: className = '',

		/** Called when the dismiss button is clicked */
		ondismiss = undefined as (() => void) | undefined,

		/** Main content */
		children = undefined as undefined | Snippet,

		/** Custom icon snippet (overrides default icon) */
		icon = undefined as undefined | Snippet,

		/** Action area snippet */
		action = undefined as undefined | Snippet,
	} = $props();

	let dismissed = $state(false);
	let visible = $state(false);

	$effect(() => {
		visible = true;
	});

	const variant = $derived(
		error ? 'error' : warning ? 'warning' : success ? 'success' : tip ? 'tip' : 'info',
	);

	const alertRole = $derived(variant === 'error' || variant === 'warning');

	function handleDismiss() {
		dismissed = true;
		ondismiss?.();
	}
</script>

{#if !dismissed}
	<svelte:element
		this={banner ? 'aside' : 'div'}
		{id}
		class={['callout', variant, className].filter(Boolean).join(' ')}
		class:banner
		class:sticky={banner && sticky}
		class:dense
		class:comfortable
		class:skeleton
		class:visible
		role={alertRole ? 'alert' : 'status'}>
		<div class="callout-inner">
			<div class="callout-icon" aria-hidden="true">
				{#if icon}
					{@render icon()}
				{:else if variant === 'success'}
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						width="20"
						height="20">
						<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
						<polyline points="22 4 12 14.01 9 11.01" />
					</svg>
				{:else if variant === 'warning'}
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						width="20"
						height="20">
						<path
							d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
						<line x1="12" y1="9" x2="12" y2="13" />
						<line x1="12" y1="17" x2="12.01" y2="17" />
					</svg>
				{:else if variant === 'error'}
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						width="20"
						height="20">
						<circle cx="12" cy="12" r="10" />
						<line x1="15" y1="9" x2="9" y2="15" />
						<line x1="9" y1="9" x2="15" y2="15" />
					</svg>
				{:else if variant === 'tip'}
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						width="20"
						height="20">
						<line x1="9" y1="18" x2="15" y2="18" />
						<line x1="10" y1="22" x2="14" y2="22" />
						<path
							d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
					</svg>
				{:else}
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						width="20"
						height="20">
						<circle cx="12" cy="12" r="10" />
						<line x1="12" y1="16" x2="12" y2="12" />
						<line x1="12" y1="8" x2="12.01" y2="8" />
					</svg>
				{/if}
			</div>

			<div class="callout-content">
				{#if skeleton}
					<div class="skeleton-line title-skeleton"></div>
					<div class="skeleton-line"></div>
					<div class="skeleton-line short"></div>
				{:else}
					{#if title}
						<div class="callout-title">{title}</div>
					{/if}
					{#if children}
						<div class="callout-body">
							{@render children()}
						</div>
					{/if}
				{/if}
			</div>

			{#if action && !skeleton}
				<div class="callout-action">
					{@render action()}
				</div>
			{/if}

			{#if dismissible && !skeleton}
				<button
					type="button"
					class="callout-dismiss"
					aria-label="Dismiss"
					onclick={handleDismiss}>
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						width="16"
						height="16">
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
					</svg>
				</button>
			{/if}
		</div>
	</svelte:element>
{/if}

<style>
	.callout {
		--callout-color: var(--color-info);
		--callout-bg: var(--color-info-bg);
		display: grid;
		grid-template-rows: 0fr;
		border-radius: var(--radius-md);
		background: var(--callout-bg);
		border-left: 4px solid var(--callout-color);
		opacity: 0;
		transform: scale(0.98);
		transition:
			grid-template-rows 300ms ease,
			opacity 300ms ease,
			transform 300ms ease;

		&.visible {
			grid-template-rows: 1fr;
			opacity: 1;
			transform: scale(1);
		}

		&.success {
			--callout-color: var(--color-success);
			--callout-bg: var(--color-success-bg);
		}
		&.warning {
			--callout-color: var(--color-warning);
			--callout-bg: var(--color-warning-bg);
		}
		&.error {
			--callout-color: var(--color-error);
			--callout-bg: var(--color-error-bg);
		}
		&.tip {
			--callout-color: var(--color-accent);
			--callout-bg: color-mix(in oklch, var(--color-accent) 10%, transparent);
		}

		&.banner {
			border-left: none;
			border-radius: 0;
			width: 100%;
			background: var(--callout-color);
			color: white;
			transform: none;
			opacity: 0;
			translate: 0 -100%;

			&.visible {
				opacity: 1;
				translate: 0 0;
			}

			.callout-inner {
				justify-content: center;
			}

			.callout-icon {
				color: white;
			}

			.callout-title {
				color: white;
			}

			.callout-body {
				color: rgba(255, 255, 255, 0.9);
			}

			.callout-dismiss {
				color: rgba(255, 255, 255, 0.7);
				&:hover {
					color: white;
					background: rgba(255, 255, 255, 0.15);
					transition: none;
				}
			}
		}

		&.sticky {
			position: sticky;
			top: 0;
			z-index: var(--layer-sticky);
		}

		&.dense {
			.callout-inner {
				padding: 0.5rem 0.75rem;
				gap: 0.5rem;
			}
		}

		&.comfortable {
			.callout-inner {
				padding: 1.25rem 1.75rem;
				gap: 1rem;
			}
		}

		&.skeleton {
			pointer-events: none;
		}
	}

	.callout-inner {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		overflow: hidden;
	}

	.callout-icon {
		flex-shrink: 0;
		color: var(--callout-color);
		display: flex;
		align-items: center;
		padding-top: 0.1rem;

		.visible & {
			animation: icon-bounce 400ms ease 150ms both;
		}
	}

	.callout-content {
		flex: 1;
		min-width: 0;
	}

	.callout-title {
		font-weight: 600;
		color: var(--callout-color);
		margin-bottom: 0.25rem;
		line-height: 1.4;
	}

	.callout-body {
		color: var(--color-text);
		line-height: 1.5;
		font-size: 0.9375rem;
	}

	.callout-action {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		margin-left: auto;
	}

	.callout-dismiss {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.25rem;
		border-radius: var(--radius-sm);
		color: var(--callout-color);
		opacity: 0.7;
		transition:
			opacity 150ms ease,
			background-color 150ms ease;

		&:hover {
			opacity: 1;
			background: rgba(0, 0, 0, 0.06);
			transition: none;
		}

		&:focus-visible {
			outline: 2px solid var(--callout-color);
			outline-offset: 2px;
			opacity: 1;
		}
	}

	/* Skeleton */
	.skeleton-line {
		height: 0.875rem;
		border-radius: var(--radius-sm);
		background: linear-gradient(
			90deg,
			var(--callout-color) 0%,
			color-mix(in oklch, var(--callout-color) 40%, transparent) 50%,
			var(--callout-color) 100%
		);
		opacity: 0.15;
		background-size: 200% 100%;
		animation: skeleton-shimmer 1.5s ease-in-out infinite;
		margin-bottom: 0.5rem;

		&:last-child {
			margin-bottom: 0;
		}
		&.title-skeleton {
			width: 40%;
			height: 1rem;
			opacity: 0.2;
		}
		&.short {
			width: 60%;
		}
	}

	@keyframes icon-bounce {
		0% {
			transform: scale(0);
			opacity: 0;
		}
		60% {
			transform: scale(1.2);
			opacity: 1;
		}
		100% {
			transform: scale(1);
			opacity: 1;
		}
	}

	@keyframes skeleton-shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.callout {
			transition: none;

			&.banner {
				translate: none;
			}
		}

		.callout-icon {
			.visible & {
				animation: none;
			}
		}

		.skeleton-line {
			animation: none;
		}
	}
</style>
