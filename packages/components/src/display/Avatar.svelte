<script lang="ts">
	import { tooltip } from '@delightstack/utilities';
	import { type Snippet } from 'svelte';

	const propId = $props.id();
	let {
		/** Image source URL */
		src = undefined as string | undefined,

		/** Name used for initials fallback and alt text */
		name = undefined as string | undefined,

		/** Stable seed for the generated background color; falls back to `name` when absent */
		color_seed = undefined as string | undefined,

		/** Size preset: 0=24px, 1=32px, 2=40px, 3=56px, 4=80px, 5=120px */
		size = '1' as '0' | '1' | '2' | '3' | '4' | '5',

		/** Square shape instead of circle */
		square = false,

		/** Online status indicator */
		status = undefined as 'online' | 'away' | 'busy' | 'offline' | undefined,

		/** Position of the status dot */
		status_position = 'bottom' as 'top' | 'bottom',

		/** Badge: true for dot, number for count */
		badge = undefined as number | boolean | undefined,

		/** Show a ring around the avatar */
		ring = false,

		/** Custom ring color */
		ring_color = undefined as string | undefined,

		/** Show a skeleton shimmer placeholder */
		skeleton = false,

		/** Tooltip message */
		tooltip: tooltip_message = '',

		/** Click handler — makes the avatar interactive */
		onclick = undefined as ((e: MouseEvent) => void) | undefined,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: class_name = '',

		/** Custom children content (replaces default avatar content) */
		children = undefined as Snippet | undefined,
	} = $props();

	let imgError = $state(false);

	function getInitials(value: string): string {
		const parts = value.trim().split(/\s+/);
		if (parts.length === 1) return parts[0][0].toUpperCase();
		return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
	}

	function hashName(value: string): number {
		let hash = 0;
		for (let i = 0; i < value.length; i++) {
			hash = hash + value.charCodeAt(i);
		}
		return hash;
	}

	function getNameColor(value: string): string {
		const hash = hashName(value);
		const hue = hash % 360;
		const lightness = 0.55 + (hash % 21) * 0.01;
		const chroma = 0.12 + (hash % 7) * 0.01;
		return `oklch(${lightness} ${chroma} ${hue})`;
	}

	const showImage = $derived(src && !imgError);
	const showInitials = $derived(!showImage && name);
	const showIcon = $derived(!showImage && !name);
	const initials = $derived(name ? getInitials(name) : '');
	const colorKey = $derived(color_seed ?? name);
	const nameColor = $derived(colorKey ? getNameColor(colorKey) : undefined);
	const isInteractive = $derived(!!onclick);
	const badgeText = $derived(
		badge === true
			? undefined
			: typeof badge === 'number'
				? badge > 99
					? '99+'
					: String(badge)
				: undefined,
	);

	const statusLabel: Record<string, string> = {
		online: 'Online',
		away: 'Away',
		busy: 'Busy',
		offline: 'Offline',
	};

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onclick?.(e as unknown as MouseEvent);
		}
	}

	function handleImgError() {
		imgError = true;
	}

	// Reset error state when src changes
	$effect(() => {
		if (src) imgError = false;
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	{id}
	class={['avatar', `size-${size}`, class_name].filter(Boolean).join(' ')}
	class:square
	class:ring
	class:interactive={isInteractive}
	class:skeleton
	role={isInteractive ? 'button' : 'img'}
	tabindex={isInteractive ? 0 : undefined}
	aria-label={name || 'Avatar'}
	style:--ring-color={ring_color || null}
	style:--name-color={nameColor || null}
	{onclick}
	onkeydown={isInteractive ? handleKeyDown : undefined}
	{@attach tooltip(tooltip_message)}>
	{#if skeleton}
		<div class="skeleton-inner"></div>
	{:else if children}
		{@render children()}
	{:else if showImage}
		<img {src} alt={name || ''} onerror={handleImgError} draggable="false" />
	{:else if showInitials}
		<span class="initials" style:background={nameColor}>
			{initials}
		</span>
	{:else}
		<span class="icon">
			<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path
					d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v1.2c0 .66.54 1.2 1.2 1.2h16.8c.66 0 1.2-.54 1.2-1.2v-1.2c0-3.2-6.4-4.8-9.6-4.8z" />
			</svg>
		</span>
	{/if}

	{#if status}
		<span
			class="status {status}"
			class:top={status_position === 'top'}
			class:bottom={status_position === 'bottom'}
			aria-label={statusLabel[status]}>
		</span>
	{/if}

	{#if badge !== undefined && badge !== false}
		<span
			class="badge"
			class:dot={badge === true}
			aria-label={typeof badge === 'number' ? `${badge} notifications` : 'Notification'}>
			{#if badgeText}{badgeText}{/if}
		</span>
	{/if}
</div>

<style>
	.avatar {
		--avatar-size: 32px;
		--avatar-font: 0.75rem;
		--avatar-status: 11px;
		--avatar-radius: var(--radius-full, 9999px);

		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--avatar-size);
		height: var(--avatar-size);
		border-radius: var(--avatar-radius);
		flex-shrink: 0;
		user-select: none;
		vertical-align: middle;
		overflow: visible;
		font-size: var(--avatar-font);
		line-height: 1;

		&.size-0 {
			--avatar-size: 24px;
			--avatar-font: 0.625rem;
			--avatar-status: 10px;
		}
		&.size-1 {
			--avatar-size: 32px;
			--avatar-font: 0.75rem;
			--avatar-status: 13px;
		}
		&.size-2 {
			--avatar-size: 40px;
			--avatar-font: 0.875rem;
			--avatar-status: 15px;
		}
		&.size-3 {
			--avatar-size: 56px;
			--avatar-font: 1.125rem;
			--avatar-status: 19px;
		}
		&.size-4 {
			--avatar-size: 80px;
			--avatar-font: 1.5rem;
			--avatar-status: 25px;
		}
		&.size-5 {
			--avatar-size: 120px;
			--avatar-font: 2.25rem;
			--avatar-status: 34px;
		}

		&.square {
			--avatar-radius: var(--radius-lg, 8px);
		}

		&.ring {
			box-shadow: 0 0 0 2px var(--ring-color, var(--color-accent, currentColor));
		}

		&.interactive {
			cursor: pointer;
			outline: none;
			transition:
				transform 150ms ease,
				box-shadow 200ms ease;

			&:hover {
				transform: scale(1.05);
			}
			&:active {
				transform: scale(0.97);
			}
			&:focus-visible {
				box-shadow:
					0 0 0 2px var(--color-bg, #fff),
					0 0 0 4px var(--color-accent, currentColor);
			}
			&.ring:focus-visible {
				box-shadow:
					0 0 0 2px var(--ring-color, var(--color-accent, currentColor)),
					0 0 0 4px var(--color-bg, #fff),
					0 0 0 6px var(--color-accent, currentColor);
			}
		}

		img {
			display: block;
			width: 100%;
			height: 100%;
			object-fit: cover;
			border-radius: var(--avatar-radius);
		}

		.initials {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 100%;
			height: 100%;
			border-radius: var(--avatar-radius);
			color: #fff;
			font-weight: 600;
			letter-spacing: 0.02em;
			text-transform: uppercase;
		}

		.icon {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 100%;
			height: 100%;
			border-radius: var(--avatar-radius);
			background: light-dark(var(--color-border, #d1d5db), var(--color-border, #4b5563));
			color: light-dark(
				var(--color-text-muted, #6b7280),
				var(--color-text-muted, #9ca3af)
			);

			svg {
				width: 60%;
				height: 60%;
			}
		}

		.status {
			position: absolute;
			width: var(--avatar-status);
			height: var(--avatar-status);
			border-radius: var(--radius-full, 9999px);
			border: 2px solid light-dark(var(--color-bg, #fff), var(--color-bg, #1f2937));
			z-index: 1;

			&.bottom {
				bottom: -1px;
				right: -1px;
			}
			&.top {
				top: -1px;
				right: -1px;
			}

			&.online {
				background-color: var(--color-success, #22c55e);
				animation: avatar-pulse 2s ease-in-out infinite;
			}
			&.away {
				background-color: var(--color-warning, #eab308);
			}
			&.busy {
				background-color: var(--color-error, #ef4444);
			}
			&.offline {
				background-color: light-dark(
					var(--color-text-muted, #9ca3af),
					var(--color-text-muted, #6b7280)
				);
			}
		}

		&.square .status {
			&.bottom {
				bottom: -2px;
				right: -2px;
			}
			&.top {
				top: -2px;
				right: -2px;
			}
		}

		/* Count badges hang off the top-right corner. Anchoring the badge's
		 * LEFT edge to the avatar's right edge (rather than its right edge) makes
		 * it grow outward to the right as the value widens, so long values like
		 * "99+" stay pinned to the side instead of sliding back over the avatar. */
		.badge {
			position: absolute;
			top: 0;
			left: 100%;
			translate: -45% -30%;
			display: flex;
			align-items: center;
			justify-content: center;
			background-color: var(--color-accent, var(--color-error, #ef4444));
			color: var(--color-accent-text, #fff);
			border-radius: var(--radius-full, 9999px);
			font-size: 0.8rem;
			font-weight: 700;
			line-height: 1;
			min-width: 1.5em;
			height: 1.5em;
			padding: 0 0.45em;
			border: 2px solid light-dark(var(--color-bg, #fff), var(--color-bg, #1f2937));
			z-index: 1;
			pointer-events: none;
			white-space: nowrap;

			/* A bare dot is square, so the width never grows — pin it to the
			 * corner directly and let it hug the avatar's edge. */
			&.dot {
				left: auto;
				right: 0;
				width: 0.95em;
				min-width: 0.95em;
				height: 0.95em;
				padding: 0;
				translate: 25% -25%;
			}
		}
		&.size-0 .badge {
			font-size: 0.6rem;
		}
		&.size-2 .badge {
			font-size: 0.85rem;
		}
		&.size-3 .badge {
			font-size: 0.95rem;
		}
		&.size-4 .badge {
			font-size: 1.1rem;
		}
		&.size-5 .badge {
			font-size: 1.3rem;
		}

		&.skeleton {
			pointer-events: none;
		}

		.skeleton-inner {
			width: 100%;
			height: 100%;
			border-radius: var(--avatar-radius);
			background: light-dark(var(--color-border, #e5e7eb), var(--color-border, #374151));
			position: relative;
			overflow: hidden;

			&::after {
				content: '';
				position: absolute;
				top: 0;
				right: 0;
				bottom: 0;
				left: 0;
				transform: translateX(-100%);
				background-image: linear-gradient(
					90deg,
					rgb(from var(--color-text, #000) r g b / 0) 0,
					rgb(from var(--color-text, #000) r g b / 0.08) 20%,
					rgb(from var(--color-text, #000) r g b / 0.15) 60%,
					rgb(from var(--color-text, #000) r g b / 0)
				);
				animation: avatar-shimmer 2s infinite;
			}
		}
	}

	@keyframes avatar-pulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 rgb(from var(--color-success, #22c55e) r g b / 0.4);
		}
		50% {
			box-shadow: 0 0 0 3px rgb(from var(--color-success, #22c55e) r g b / 0);
		}
	}

	@keyframes avatar-shimmer {
		100% {
			transform: translateX(100%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.avatar .status.online {
			animation: none;
		}
		.avatar .skeleton-inner::after {
			animation: none;
		}
	}
</style>
