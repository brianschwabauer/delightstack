// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import svelte from '@astrojs/svelte';
// import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
	site: 'https://docs.thedelight.co',
	integrations: [
		starlight({
			title: 'DelightStack',
			logo: {
				// Theme-aware wordmark: gradient icon with deep-teal text in light mode
				// and white text in dark mode. (currentColor can't cross an <img>, so
				// the header uses pre-baked light/dark files instead.)
				light: './src/assets/delightstack_logo_light.svg',
				dark: './src/assets/delightstack_logo_dark.svg',
				// The wordmark already includes "delightstack", so hide the text title.
				replacesTitle: true,
			},
			favicon: '/delightstack_brandmark.svg',
			head: [
				{
					tag: 'link',
					attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
				},
				{
					// Re-apply the visitor's saved theme overrides (written by the
					// theme customizer) before first paint so there's no flash of
					// the default theme. Must stay in sync with the CSS_KEY /
					// STYLE_ID constants in src/components/theme-store.svelte.ts.
					tag: 'script',
					content: `try{var c=localStorage.getItem('delightstack:theme-css');if(c){var s=document.createElement('style');s.id='delightstack-theme-overrides';s.textContent=c;document.head.appendChild(s);}}catch(e){}`,
				},
			],
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/brianschwabauer' },
			],
			customCss: ['./src/styles/design-tokens.css'],
			components: {
				// Custom splash hero (the home page is the only page with a hero).
				Hero: './src/components/Hero.astro',
				// Site chrome rebuilt on delightstack components (dogfooding).
				ThemeSelect: './src/components/ThemeSelect.astro',
				Sidebar: './src/components/Sidebar.astro',
				Pagination: './src/components/Pagination.astro',
				SocialIcons: './src/components/SocialIcons.astro',
				Search: './src/components/Search.astro',
			},
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Introduction', slug: 'getting-started/introduction' },
						{ label: 'Installation', slug: 'getting-started/installation' },
						{ label: 'Quick Start: Components', slug: 'getting-started/quick-start' },
						{
							label: 'Quick Start: Full Stack',
							slug: 'getting-started/quick-start-stack',
						},
						{ label: 'Architecture', slug: 'getting-started/architecture' },
						{ label: 'Dashboard Demo', link: '/demo/' },
					],
				},
				{
					label: 'Guides',
					items: [
						{ label: 'Design Tokens', slug: 'guides/design-tokens' },
						{ label: 'Theming', slug: 'guides/theming' },
						{ label: 'Dark Mode', slug: 'guides/dark-mode' },
						{ label: 'Scrolling', slug: 'guides/scrolling' },
						{ label: 'Accessibility', slug: 'guides/accessibility' },
						{ label: 'Working with Forms', slug: 'guides/forms' },
						{ label: 'AI Agents', slug: 'guides/ai-agents' },
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
				{
					label: 'Packages',
					items: [
						{ label: 'Overview', slug: 'packages/overview' },
						{ label: 'Auth', slug: 'packages/auth' },
						{ label: 'Database', slug: 'packages/database' },
						{ label: 'Realtime', slug: 'packages/websocket' },
						{ label: 'Presence', slug: 'packages/presence' },
						{ label: 'AI', slug: 'packages/ai' },
						{ label: 'Billing', slug: 'packages/stripe' },
						{ label: 'Images', slug: 'packages/images' },
						{ label: 'Rate Limiter', slug: 'packages/rate-limiter' },
					],
				},
			],
		}),
		svelte(),
	],
	// The backend docs moved from /stack/* during the 2026-06 IA restructure.
	redirects: {
		'/stack/overview': '/packages/overview',
		'/stack/quickstart': '/getting-started/quick-start-stack',
		'/stack/architecture': '/getting-started/architecture',
		'/stack/auth': '/packages/auth',
		'/stack/database': '/packages/database',
		'/stack/websocket': '/packages/websocket',
		'/stack/ai': '/packages/ai',
		'/stack/stripe': '/packages/stripe',
		'/stack/images': '/packages/images',
		'/stack/rate-limiter': '/packages/rate-limiter',
	},
	// adapter: cloudflare({}),
	vite: {
		// Force a single Svelte instance across the app and every workspace
		// component library (@delightstack/components, /presence, …). Without this,
		// a long-running dev server can re-optimize into two Svelte copies after a
		// dependency is added, and every island then fails to hydrate with
		// `lifecycle_outside_component` / `effect_orphan` errors.
		resolve: {
			dedupe: ['svelte'],
		},
		// hls.js is an optional peer dep of <Video>, pulled in via a dynamic
		// import only for HLS sources. Pre-bundle it so Vite resolves it instead
		// of stubbing it as an "absent" optional peer dependency in dev.
		optimizeDeps: {
			include: ['hls.js'],
		},
		build: {
			rollupOptions: {
				// Optional peer deps of @delightstack/components media components
				external: ['three', 'pdfjs-dist'],
			},
		},
	},
});
