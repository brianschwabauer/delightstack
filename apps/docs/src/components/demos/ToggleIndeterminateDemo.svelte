<script>
	import { Toggle } from '@delightstack/components/form';

	let moderation = $state(null);

	const description = $derived(
		moderation === true
			? 'All comments are held for review'
			: moderation === false
				? 'Comments are posted immediately'
				: 'Only flagged comments are held for review',
	);
</script>

<div style="display: flex; flex-direction: column; gap: 0.5rem;">
	<Toggle indeterminate bind:checked={moderation} label="Comment moderation" />
	<span style="font-size: 0.875em; opacity: 0.7;">
		checked = <code>{JSON.stringify(moderation)}</code>
		— {description}
	</span>
</div>
