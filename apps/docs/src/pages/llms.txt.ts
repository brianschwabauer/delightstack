import type { APIRoute } from 'astro';
import type { CollectionEntry } from 'astro:content';
import { SITE, getDocsEntries, markdownUrl } from '../lib/llms';

const SECTIONS: { label: string; prefix: string }[] = [
	{ label: 'Getting Started', prefix: 'getting-started/' },
	{ label: 'The Stack', prefix: 'stack/' },
	{ label: 'Guides', prefix: 'guides/' },
	{ label: 'Components: Actions', prefix: 'components/actions/' },
	{ label: 'Components: Display', prefix: 'components/display/' },
	{ label: 'Components: Feedback', prefix: 'components/feedback/' },
	{ label: 'Components: Form', prefix: 'components/form/' },
	{ label: 'Components: Media', prefix: 'components/media/' },
	{ label: 'Components: Navigation', prefix: 'components/navigation/' },
];

function line(entry: CollectionEntry<'docs'>): string {
	const description = entry.data.description ? `: ${entry.data.description}` : '';
	return `- [${entry.data.title}](${markdownUrl(entry)})${description}`;
}

export const GET: APIRoute = async () => {
	const entries = await getDocsEntries();
	const overview = entries.find((e) => e.id === 'components/overview');

	const sections = SECTIONS.map(({ label, prefix }) => {
		const items = entries.filter(
			(e) => e.id.startsWith(prefix) && e.id !== 'components/overview',
		);
		return `## ${label}\n\n${items.map(line).join('\n')}`;
	});

	const text = [
		'# DelightStack',
		'',
		'> DelightStack is a Svelte 5 component library (@delightstack/components, 50+ accessible,',
		'> themeable components) plus a Cloudflare-native backend stack (auth, database, realtime,',
		'> AI, billing, images) for building delightful apps.',
		'',
		'Every docs page is available as plain markdown by appending `.md` to its URL.',
		'Key conventions: components import from `@delightstack/components`; props are snake_case,',
		'callbacks are camelCase; design tokens come from `@delightstack/styles`.',
		'',
		`- [Agent skill / AGENTS.md snippet](${SITE}/skill.md): compact instructions for AI coding agents`,
		`- [Full documentation in one file](${SITE}/llms-full.txt)`,
		overview ? line(overview) : '',
		'',
		sections.join('\n\n'),
		'',
	].join('\n');

	return new Response(text, {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
};
