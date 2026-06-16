<script lang="ts" module>
	export interface ReactionsProps {
		/**
		 * Optional emoji set. When provided, renders an inline trigger bar whose
		 * buttons broadcast a reaction. Floating reactions render regardless.
		 */
		bar?: string[];
		/** How long each floating reaction lives (ms). @default 2400 */
		duration?: number;
		/** Additional CSS classes for the trigger bar. */
		class?: string;
	}

	let next_id = 0;
</script>

<script lang="ts">
	import { getPresence } from '../client/context';
	import { denormalizeCursor } from '../core/coordinates';
	import type { PresenceReactionMessage } from '../types';

	let { bar, duration = 2400, class: class_name = '' }: ReactionsProps = $props();

	const presence = getPresence();

	type FloatingReaction = { id: number; emoji: string; x: number; y: number };
	let floating = $state<FloatingReaction[]>([]);

	$effect(() => {
		const unsub = presence.onReaction((message) => spawn(message));
		return unsub;
	});

	function spawn(message: PresenceReactionMessage) {
		// Anchor to the sender's cursor when we can see it; otherwise bottom-center.
		let x = window.innerWidth / 2;
		let y = window.innerHeight - 80;
		const peer = presence.here.find((p) => p.presence_id === message.presence_id);
		if (peer?.state.cursor) {
			const point = denormalizeCursor(peer.state.cursor);
			if (point) {
				x = point.x;
				y = point.y;
			}
		}
		const id = next_id++;
		floating.push({ id, emoji: message.emoji, x, y });
		setTimeout(() => {
			floating = floating.filter((r) => r.id !== id);
		}, duration);
	}
</script>

<div class="layer" aria-hidden="true" style:--duration="{duration}ms">
	{#each floating as reaction (reaction.id)}
		<span class="float" style:left="{reaction.x}px" style:top="{reaction.y}px">
			{reaction.emoji}
		</span>
	{/each}
</div>

{#if bar && bar.length > 0}
	<div class="bar {class_name}" role="group" aria-label="Send a reaction">
		{#each bar as emoji (emoji)}
			<button
				type="button"
				onclick={() => presence.react(emoji)}
				aria-label="React {emoji}">
				{emoji}
			</button>
		{/each}
	</div>
{/if}

<style>
	.layer {
		position: fixed;
		inset: 0;
		pointer-events: none;
		z-index: 2147483100;
		overflow: hidden;
	}

	.float {
		position: absolute;
		font-size: 1.75rem;
		line-height: 1;
		transform: translate(-50%, -50%);
		animation: delight-presence-react var(--duration) ease-out forwards;
	}

	@keyframes -global-delight-presence-react {
		0% {
			opacity: 0;
			transform: translate(-50%, -50%) scale(0.4);
		}
		15% {
			opacity: 1;
			transform: translate(-50%, -90%) scale(1.1);
		}
		100% {
			opacity: 0;
			transform: translate(-50%, -260%) scale(1);
		}
	}

	.bar {
		display: inline-flex;
		gap: 0.25rem;
		padding: 0.25rem;
		background: var(--color-bg, #fff);
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 999px;
		box-shadow: 0 2px 8px rgb(0 0 0 / 0.08);

		& button {
			display: grid;
			place-items: center;
			inline-size: 2rem;
			block-size: 2rem;
			font-size: 1.1rem;
			line-height: 1;
			background: transparent;
			border: 0;
			border-radius: 50%;
			cursor: pointer;
			transition:
				transform 0.12s ease,
				background 0.12s ease;

			&:hover {
				background: var(--color-bg-subtle, #f1f5f9);
				transform: scale(1.15);
				/* Snap the tint in; keep the scale easing. Base rule eases both out. */
				transition: transform 0.12s ease;
			}

			&:active {
				transform: scale(0.95);
			}
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.float {
			animation-duration: 0.01ms;
		}
	}
</style>
