<script>
	import { Code } from '@delightstack/components/display';
	import { Button } from '@delightstack/components/actions';

	let loading = $state(true);

	const snippet =
		"function greet(name) {\n\tconsole.log(`Hello, ${name}!`);\n}\n\ngreet('World');";
</script>

<div class="skeleton-demo">
	<Button dense onclick={() => (loading = !loading)}>
		{loading ? 'Show loaded' : 'Show skeleton'}
	</Button>
	<div style="width: 100%;">
		<Code skeleton={loading} code={loading ? '' : snippet} language="javascript" />
	</div>
</div>

<style>
	.skeleton-demo {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		align-items: flex-start;
		width: 100%;
	}
</style>
