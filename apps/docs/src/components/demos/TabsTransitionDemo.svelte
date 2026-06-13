<script>
	import { Tabs } from '@delightstack/components/navigation';

	let mode = $state(2); // 0=none, 1=fade, 2=slide
	let tab = $state(0);
</script>

{#snippet planet(name, blurb)}
	<div style="padding: 0.25rem 0;">
		<strong>{name}</strong>
		<p style="margin: 0.25rem 0 0;">{blurb}</p>
	</div>
{/snippet}

<div class="transition-demo">
	<Tabs
		boxed
		bind:tab={mode}
		tabs={[{ label: 'None' }, { label: 'Fade' }, { label: 'Slide' }]} />

	<div style="width: 100%;">
		<Tabs
			bind:tab
			transition={['none', 'fade', 'slide'][mode]}
			tabs={[
				{
					label: 'Mercury',
					content: mercury,
				},
				{ label: 'Venus', content: venus },
				{ label: 'Earth', content: earth },
			]} />
	</div>
</div>

{#snippet mercury()}
	{@render planet('Mercury', 'The smallest planet, closest to the Sun.')}
{/snippet}
{#snippet venus()}
	{@render planet('Venus', 'Shrouded in thick, reflective clouds.')}
{/snippet}
{#snippet earth()}
	{@render planet('Earth', 'The only world known to harbor life.')}
{/snippet}

<style>
	.transition-demo {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: 100%;
	}
</style>
