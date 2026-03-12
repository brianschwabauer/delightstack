<script lang="ts" module>
	export interface AvatarData {
		src?: string;
		name: string;
		href?: string;
	}
</script>

<script lang="ts">
	import Avatar from './Avatar.svelte';
	import { tooltip } from '@delightstack/utilities';

	const propId = $props.id();

	let {
		/** Array of avatar data */
		avatars = [] as AvatarData[],

		/** Maximum visible avatars */
		max = 5,

		/** Avatar size preset */
		size = '1' as '0' | '1' | '2' | '3' | '4' | '5',

		/** Overlap ratio (0-1) */
		overlap = 0.25,

		/** Stack direction */
		direction = 'right' as 'left' | 'right',

		/** Ring color around each avatar */
		ringColor = 'var(--color-bg)' as string,

		/** Click overflow to reveal all */
		expandable = false,

		/** Show loading skeleton */
		skeleton = false,

		/** Number of skeleton circles */
		skeletonCount = 4,

		/** Individual avatar clicked */
		onclick = undefined as ((payload: { avatar: AvatarData; index: number }) => void) | undefined,

		/** Overflow indicator clicked */
		onoverflowclick = undefined as ((payload: { remaining: AvatarData[] }) => void) | undefined,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: className = '',
	} = $props();

	const size_map: Record<string, number> = {
		'0': 24,
		'1': 32,
		'2': 40,
		'3': 56,
		'4': 80,
		'5': 120,
	};

	const font_map: Record<string, string> = {
		'0': '0.5rem',
		'1': '0.625rem',
		'2': '0.75rem',
		'3': '0.875rem',
		'4': '1.125rem',
		'5': '1.5rem',
	};

	let is_expanded = $state(false);

	const avatar_size = $derived(size_map[size] || 32);
	const overlap_px = $derived(Math.round(avatar_size * overlap));
	const effective_max = $derived(is_expanded ? avatars.length : max);
	const visible_avatars = $derived(avatars.slice(0, effective_max));
	const remaining_avatars = $derived(avatars.slice(effective_max));
	const overflow_count = $derived(remaining_avatars.length);
	const has_overflow = $derived(overflow_count > 0);

	function handleAvatarClick(avatar: AvatarData, index: number) {
		onclick?.({ avatar, index });
	}

	function handleOverflowClick() {
		if (expandable) {
			is_expanded = !is_expanded;
		}
		onoverflowclick?.({ remaining: remaining_avatars });
	}

	function handleOverflowKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			handleOverflowClick();
		}
	}
</script>

<div
	{id}
	class={['avatar-group', `direction-${direction}`, className].filter(Boolean).join(' ')}
	style:--avatar-size="{avatar_size}px"
	style:--overlap="{overlap_px}px"
	style:--ring-color={ringColor}
	style:--overflow-font={font_map[size] || '0.625rem'}
	role="group"
	aria-label="Avatar group">

	{#if skeleton}
		{#each { length: skeletonCount } as _, i}
			<div
				class="avatar-wrapper"
				style:z-index={direction === 'right' ? skeletonCount - i : i + 1}>
				<Avatar {size} skeleton ring {ringColor} />
			</div>
		{/each}
	{:else}
		{#each visible_avatars as avatar, i}
			<div
				class="avatar-wrapper"
				class:interactive={!!onclick}
				style:z-index={direction === 'right' ? visible_avatars.length - i : i + 1}
				{@attach tooltip(avatar.name)}>
				{#if avatar.href}
					<a href={avatar.href} class="avatar-link" aria-label={avatar.name}>
						<Avatar
							src={avatar.src}
							name={avatar.name}
							{size}
							ring
							{ringColor}
							onclick={onclick ? () => handleAvatarClick(avatar, i) : undefined} />
					</a>
				{:else}
					<Avatar
						src={avatar.src}
						name={avatar.name}
						{size}
						ring
						{ringColor}
						onclick={onclick ? () => handleAvatarClick(avatar, i) : undefined} />
				{/if}
			</div>
		{/each}

		{#if has_overflow}
			<!-- svelte-ignore a11y_no_static_element_interactions a11y_no_noninteractive_tabindex -->
			<div
				class="avatar-wrapper overflow-wrapper"
				class:interactive={expandable || !!onoverflowclick}
				style:z-index={direction === 'right' ? 0 : visible_avatars.length + 1}
				{@attach tooltip(`${overflow_count} more`)}>
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div
					class="overflow-indicator"
					role={expandable || onoverflowclick ? 'button' : undefined}
					tabindex={expandable || onoverflowclick ? 0 : undefined}
					aria-label={`${overflow_count} more avatars`}
					onclick={expandable || onoverflowclick ? handleOverflowClick : undefined}
					onkeydown={expandable || onoverflowclick ? handleOverflowKeyDown : undefined}>
					+{overflow_count}
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.avatar-group {
		display: inline-flex;
		align-items: center;
		flex-wrap: nowrap;
	}

	.avatar-wrapper {
		position: relative;
		transition: transform 150ms ease, z-index 0ms;

		&:not(:first-child) {
			margin-inline-start: calc(-1 * var(--overlap));
		}

		&:hover {
			z-index: 100 !important;
			transform: translateY(-2px);
		}

		&.interactive {
			cursor: pointer;
		}
	}

	.avatar-group.direction-left {
		flex-direction: row-reverse;
		justify-content: flex-end;

		.avatar-wrapper:not(:first-child) {
			margin-inline-start: 0;
			margin-inline-end: calc(-1 * var(--overlap));
		}
	}

	.avatar-link {
		display: inline-flex;
		text-decoration: none;
		border-radius: var(--radius-round, 9999px);
		outline: none;

		&:focus-visible {
			box-shadow:
				0 0 0 2px var(--color-bg, #fff),
				0 0 0 4px var(--color-accent, currentColor);
			border-radius: var(--radius-round, 9999px);
		}
	}

	.overflow-indicator {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--avatar-size);
		height: var(--avatar-size);
		border-radius: var(--radius-round, 9999px);
		background: light-dark(
			var(--color-border, #d1d5db),
			var(--color-border, #4b5563)
		);
		color: light-dark(
			var(--color-text-muted, #6b7280),
			var(--color-text-muted, #9ca3af)
		);
		font-size: var(--overflow-font);
		font-weight: 600;
		line-height: 1;
		user-select: none;
		flex-shrink: 0;
		box-shadow: 0 0 0 2px var(--ring-color);
		letter-spacing: -0.02em;
		outline: none;
		transition: background 150ms ease;

		&[role='button'] {
			cursor: pointer;

			&:hover {
				background: light-dark(
					var(--color-border, #c4c9d0),
					var(--color-border, #5b6577)
				);
			}

			&:focus-visible {
				box-shadow:
					0 0 0 2px var(--ring-color),
					0 0 0 4px var(--color-accent, currentColor);
			}
		}
	}
</style>
