<script>
	import { Expand } from '@delightstack/components/display';

	const sections = [
		{
			id: 'about',
			title: 'About',
			content: 'We are a team dedicated to building great developer tools.',
		},
		{
			id: 'features',
			title: 'Features',
			content: 'Smooth animations, accessible by default, and easy to customize.',
		},
		{
			id: 'pricing',
			title: 'Pricing',
			content: 'Free for open-source projects. Contact us for enterprise plans.',
		},
	];

	let active = $state('about');
</script>

<div style="border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
	{#each sections as section}
		<div style="border-bottom: 1px solid #e0e0e0;">
			<button
				onclick={() => (active = active === section.id ? '' : section.id)}
				style="display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 0.75rem 1rem; background: none; border: none; cursor: pointer; font-size: 0.9375rem; font-weight: 500; text-align: left;">
				{section.title}
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					style="transform: rotate({active === section.id
						? '180deg'
						: '0deg'}); transition: transform 0.2s;">
					<polyline points="6 9 12 15 18 9" />
				</svg>
			</button>
			<Expand show={active === section.id}>
				<div style="padding: 0 1rem 0.75rem;">
					<p style="margin: 0; color: #555;">{section.content}</p>
				</div>
			</Expand>
		</div>
	{/each}
</div>
