<script>
	import { AvatarGroup } from '@delightstack/components/display';

	const team = [
		{ name: 'Alice Johnson' },
		{ name: 'Bob Smith' },
		{ name: 'Charlie Brown' },
		{ name: 'Diana Prince' },
	];
	let last_click = $state('');
</script>

<AvatarGroup
	avatars={team}
	onclick={({ avatar }) => (last_click = avatar.name)} />

{#if last_click}
	<p style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--color-text-secondary);">
		Clicked: {last_click}
	</p>
{/if}
