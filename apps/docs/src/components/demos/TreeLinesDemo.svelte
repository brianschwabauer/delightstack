<script>
	import { Tree } from '@delightstack/components/display';

	const fileTree = [
		{
			id: 'src',
			label: 'src',
			children: [
				{
					id: 'lib',
					label: 'lib',
					children: [
						{ id: 'auth', label: 'auth.ts' },
						{ id: 'db', label: 'db.ts' },
					],
				},
				{
					id: 'routes',
					label: 'routes',
					children: [
						{ id: 'home', label: '+page.svelte' },
						{ id: 'about', label: 'about/+page.svelte' },
					],
				},
				{ id: 'app', label: 'app.html' },
			],
		},
		{ id: 'static', label: 'static', children: [{ id: 'favicon', label: 'favicon.png' }] },
		{ id: 'package', label: 'package.json' },
	];

	let expanded = $state(['src', 'lib', 'routes', 'static']);
</script>

<Tree data={fileTree} show_lines bind:expanded />
