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
</script>

<AvatarGroup avatars={team} max={3} expandable />
