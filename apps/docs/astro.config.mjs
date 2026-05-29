// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import svelte from '@astrojs/svelte';
// import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'DelightStack',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/brianschwabauer' },
			],
			customCss: ['./src/styles/design-tokens.css'],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Introduction', slug: 'getting-started/introduction' },
						{ label: 'Installation', slug: 'getting-started/installation' },
						{ label: 'Quick Start', slug: 'getting-started/quick-start' },
						{ label: 'Dashboard Demo', link: '/demo/' },
					],
				},
				{
					label: 'Guides',
					items: [
						{ label: 'Design Tokens', slug: 'guides/design-tokens' },
						{ label: 'Theming', slug: 'guides/theming' },
						{ label: 'Dark Mode', slug: 'guides/dark-mode' },
						{ label: 'Accessibility', slug: 'guides/accessibility' },
						{ label: 'Working with Forms', slug: 'guides/forms' },
					],
				},
				{
					label: 'Components',
					items: [
						{ label: 'Overview', slug: 'components/overview' },
						{
							label: 'Actions',
							collapsed: true,
							autogenerate: { directory: 'components/actions' },
						},
						{
							label: 'Display',
							collapsed: true,
							autogenerate: { directory: 'components/display' },
						},
						{
							label: 'Feedback',
							collapsed: true,
							autogenerate: { directory: 'components/feedback' },
						},
						{
							label: 'Form',
							collapsed: true,
							autogenerate: { directory: 'components/form' },
						},
						{
							label: 'Media',
							collapsed: true,
							autogenerate: { directory: 'components/media' },
						},
						{
							label: 'Navigation',
							collapsed: true,
							autogenerate: { directory: 'components/navigation' },
						},
					],
				},
			],
		}),
		svelte(),
	],
	// adapter: cloudflare({}),
	vite: {
		build: {
			rollupOptions: {
				// Optional peer deps of @delightstack/components media components
				external: ['three', 'pdfjs-dist'],
			},
		},
	},
});
