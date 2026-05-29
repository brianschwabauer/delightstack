<script>
	import { AvatarGroup } from '@delightstack/components/display';

	const team = [
		{ name: 'Alice Johnson' },
		{ name: 'Bob Smith' },
		{ name: 'Charlie Brown' },
		{ name: 'Diana Prince' },
		{ name: 'Eve Martin' },
		{ name: 'Frank Lee' },
	];
	let last_overflow = $state('');
</script>

<AvatarGroup
	avatars={team}
	max={3}
	onoverflowclick={({ remaining }) =>
		(last_overflow = remaining.map((a) => a.name).join(', '))} />

{#if last_overflow}
	<p style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--color-text-secondary);">
		Remaining: {last_overflow}
	</p>
{/if}
