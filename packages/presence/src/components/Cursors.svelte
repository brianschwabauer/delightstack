<script lang="ts" module>
	export interface CursorsProps {
		/** Also render cursors from the local user's other tabs. @default false */
		show_self?: boolean;
		/** Additional CSS classes for the overlay. */
		class?: string;
	}
</script>

<script lang="ts">
	import { getPresence } from '../client/context';
	import { denormalizeCursor } from '../core/coordinates';

	let { show_self = false, class: class_name = '' }: CursorsProps = $props();

	const presence = getPresence();

	// Remote cursors are anchored to page content, so reposition them on scroll
	// and resize even though the peer state itself hasn't changed.
	let tick = $state(0);
	$effect(() => {
		let scheduled = false;
		const bump = () => {
			if (scheduled) return;
			scheduled = true;
			requestAnimationFrame(() => {
				scheduled = false;
				tick += 1;
			});
		};
		window.addEventListener('scroll', bump, { passive: true, capture: true });
		window.addEventListener('resize', bump);
		return () => {
			window.removeEventListener('scroll', bump, {
				capture: true,
			} as EventListenerOptions);
			window.removeEventListener('resize', bump);
		};
	});

	const cursors = $derived.by(() => {
		void tick; // recompute on scroll/resize
		const me = presence.user?.id;
		const out: Array<{
			id: string;
			name: string;
			color: string;
			x: number;
			y: number;
			message: string | null;
			active: boolean;
		}> = [];
		for (const peer of presence.here) {
			if (!peer.state.cursor) continue;
			if (!show_self && peer.user.id === me) continue;
			const point = denormalizeCursor(peer.state.cursor);
			if (!point) continue;
			out.push({
				id: peer.presence_id,
				name: peer.user.name,
				color: peer.user.color,
				x: point.x,
				y: point.y,
				message: peer.state.message?.text ?? null,
				active: (peer.state.status ?? 'active') === 'active',
			});
		}
		return out;
	});
</script>

<div class="cursors {class_name}" aria-hidden="true">
	{#each cursors as cursor (cursor.id)}
		<div
			class="cursor"
			class:idle={!cursor.active}
			style:transform="translate({cursor.x}px, {cursor.y}px)"
			style:--color={cursor.color}>
			<svg width="24" height="36" viewBox="0 0 24 36" fill="none" class="arrow">
				<path
					d="M5.65 12.37H5.46l-.14.13L.5 16.88V1.2l11.28 11.17H5.65Z"
					fill="var(--color)"
					stroke="#fff"
					stroke-width="1.5"
					stroke-linejoin="round" />
			</svg>
			<div class="tag">
				{#if cursor.message}
					<span class="bubble">{cursor.message}</span>
				{/if}
				<span class="name">{cursor.name}</span>
			</div>
		</div>
	{/each}
</div>

<style>
	.cursors {
		position: fixed;
		inset: 0;
		pointer-events: none;
		z-index: 2147483000;
		overflow: hidden;
	}

	.cursor {
		position: absolute;
		inset-block-start: 0;
		inset-inline-start: 0;
		will-change: transform;
		transition: transform 90ms linear;

		&.idle {
			opacity: 0.5;
			transition:
				transform 90ms linear,
				opacity 0.3s ease;
		}
	}

	.arrow {
		display: block;
		filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.25));
	}

	.tag {
		position: absolute;
		inset-block-start: 18px;
		inset-inline-start: 14px;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.25rem;
		white-space: nowrap;
	}

	.name {
		padding: 0.1rem 0.45rem;
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1.4;
		color: #fff;
		background: var(--color);
		border-radius: 0.5rem;
		text-shadow: 0 1px 2px rgb(0 0 0 / 0.2);
	}

	.bubble {
		max-inline-size: 16rem;
		padding: 0.3rem 0.6rem;
		font-size: 0.8rem;
		line-height: 1.35;
		color: var(--color-text, #111);
		background: var(--color-bg, #fff);
		border: 2px solid var(--color);
		border-radius: 0.75rem;
		border-end-start-radius: 0.125rem;
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.15);
		white-space: normal;
		overflow-wrap: anywhere;
	}

	@media (prefers-reduced-motion: reduce) {
		.cursor {
			transition: none;
		}
	}
</style>
