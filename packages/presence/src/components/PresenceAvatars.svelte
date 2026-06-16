<script lang="ts" module>
	export interface PresenceAvatarsProps {
		/** Avatar diameter in pixels. @default 32 */
		size?: number;
		/** Maximum avatars shown before collapsing into a `+N` chip. @default 5 */
		max?: number;
		/** `'org'` shows everyone online; `'page'` shows only those on this page. @default 'org' */
		scope?: 'org' | 'page';
		/** Include the local user. @default true */
		show_self?: boolean;
		/** Overlap ratio between adjacent avatars (0–1). @default 0.3 */
		overlap?: number;
		/** Additional CSS classes. */
		class?: string;
	}
</script>

<script lang="ts">
	import { tooltip } from '@delightstack/utilities';
	import { getPresence } from '../client/context';
	import type { OnlineUser } from '../types';

	let {
		size = 32,
		max = 5,
		scope = 'org',
		show_self = true,
		overlap = 0.3,
		class: class_name = '',
	}: PresenceAvatarsProps = $props();

	const presence = getPresence();

	const STATUS_RANK = { active: 3, idle: 2, away: 1 } as const;

	const roster = $derived(
		presence.users
			.filter((u) => (show_self || !u.is_self) && (scope === 'org' || u.here))
			.sort((a, b) => {
				if (a.is_self !== b.is_self) return a.is_self ? -1 : 1;
				const rank = STATUS_RANK[b.status] - STATUS_RANK[a.status];
				if (rank !== 0) return rank;
				return a.name.localeCompare(b.name);
			}),
	);

	const visible = $derived(roster.slice(0, max));
	const overflow = $derived(roster.length - visible.length);

	function initials(name: string): string {
		const parts = name.trim().split(/\s+/).filter(Boolean);
		if (parts.length === 0) return '?';
		if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
		return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
	}

	function label(user: OnlineUser): string {
		const who = user.is_self ? `${user.name} (you)` : user.name;
		const state =
			user.status === 'away' ? ' · away' : user.status === 'idle' ? ' · idle' : '';
		return who + state;
	}
</script>

{#if roster.length > 0}
	<div
		class="avatars {class_name}"
		style:--size="{size}px"
		style:--overlap={overlap}
		role="group"
		aria-label="{roster.length} online">
		{#each visible as user (user.id)}
			<div
				class="avatar {user.status}"
				class:self={user.is_self}
				style:--color={user.color}
				{@attach tooltip(label(user))}>
				{#if user.image}
					<img src={user.image} alt={user.name} />
				{:else}
					<span class="initials">{initials(user.name)}</span>
				{/if}
				<span class="status {user.status}" aria-hidden="true"></span>
			</div>
		{/each}
		{#if overflow > 0}
			<div class="avatar overflow" {@attach tooltip(`${overflow} more`)}>+{overflow}</div>
		{/if}
	</div>
{/if}

<style>
	.avatars {
		display: inline-flex;
		align-items: center;
	}

	.avatar {
		position: relative;
		inline-size: var(--size);
		block-size: var(--size);
		border-radius: 50%;
		display: grid;
		place-items: center;
		font-size: calc(var(--size) * 0.4);
		font-weight: 600;
		line-height: 1;
		color: #fff;
		background: var(--color, var(--color-accent, #64748b));
		box-shadow: 0 0 0 2px var(--color-bg, #fff);
		user-select: none;
		transition: opacity 0.2s ease;

		&:not(:first-child) {
			margin-inline-start: calc(var(--size) * var(--overlap) * -1);
		}

		& img {
			inline-size: 100%;
			block-size: 100%;
			border-radius: 50%;
			object-fit: cover;
		}

		& .initials {
			text-shadow: 0 1px 2px rgb(0 0 0 / 0.25);
		}

		&.idle {
			opacity: 0.7;
		}

		&.away {
			opacity: 0.45;
		}

		&.overflow {
			background: light-dark(var(--color-border, #e2e8f0), var(--color-border, #334155));
			color: var(--color-text-muted, #64748b);
			font-size: calc(var(--size) * 0.32);
			font-weight: 700;
		}
	}

	.status {
		position: absolute;
		inset-block-end: 0;
		inset-inline-end: 0;
		inline-size: calc(var(--size) * 0.3);
		block-size: calc(var(--size) * 0.3);
		border-radius: 50%;
		box-shadow: 0 0 0 2px var(--color-bg, #fff);

		&.active {
			background: #22c55e;
		}

		&.idle {
			background: #f59e0b;
		}

		&.away {
			background: #9ca3af;
		}
	}
</style>
