import { getCollection, type CollectionEntry } from 'astro:content';

export const SITE = 'https://docs.thedelight.co';

/**
 * Converts a docs MDX entry body into plain agent-friendly markdown:
 * - `<ComponentPreview code={`…`}>` blocks become fenced ```svelte code blocks
 * - JSX wrappers (Aside, Steps, Tabs, Cards, demo islands) are unwrapped or dropped
 * - import statements and MDX comments are removed
 */
export function toMarkdown(entry: CollectionEntry<'docs'>): string {
	let body = entry.body ?? '';

	// 1. ComponentPreview blocks → fenced svelte code (must run before fence-aware
	// processing because the code prop is a JSX template literal, not a fence yet).
	body = body.replace(
		/<ComponentPreview([^>]*?)code={`((?:\\.|[^`\\])*)`}([^>]*?)>[\s\S]*?<\/ComponentPreview>/g,
		(_match, before: string, code: string, after: string) => {
			const title = /title="([^"]*)"/.exec(before + ' ' + after)?.[1];
			const cleaned = code
				// MDX strips literal tabs, so pages indent via ${'  '} interpolations.
				.replace(/\$\{'((?:[^'\\]|\\.)*)'\}/g, '$1')
				.replace(/\\`/g, '`')
				.replace(/\\\$/g, '$')
				.trim();
			const heading = title ? `**${title}**\n\n` : '';
			return `${heading}\`\`\`svelte\n${cleaned}\n\`\`\``;
		},
	);

	// 2. Everything else is processed outside code fences only.
	const segments = body.split(/(^```[\s\S]*?^```)/m);
	body = segments
		.map((segment, i) => (i % 2 === 0 ? transformProse(segment) : segment))
		.join('');

	const title = entry.data.title;
	const description = entry.data.description;
	const header = `# ${title}\n\n${description ? `> ${description}\n\n` : ''}`;
	return `${header}${body.trim()}\n`;
}

function transformProse(text: string): string {
	return (
		text
			// MDX import statements
			.replace(/^import\s+[\s\S]*?from\s+'[^']*';?\s*$/gm, '')
			// MDX comments
			.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
			// Demo islands and other self-closing client components
			.replace(/<[A-Z]\w*[^>]*\bclient:\w+[^>]*\/>/g, '')
			// LinkCard → markdown link bullet
			.replace(/<LinkCard([^>]*)\/>/g, (_m, attrs: string) => {
				const title = /title="([^"]*)"/.exec(attrs)?.[1] ?? '';
				const href = /href="([^"]*)"/.exec(attrs)?.[1] ?? '';
				const description = /description="([^"]*)"/.exec(attrs)?.[1];
				return `- [${title}](${href})${description ? ` — ${description}` : ''}`;
			})
			// Aside → labeled note (content stays at top level so nested fences survive)
			.replace(/<Aside\b([^>]*)>/g, (_m, attrs: string) => {
				const type = /type="([^"]*)"/.exec(attrs)?.[1] ?? 'note';
				const title = /title="([^"]*)"/.exec(attrs)?.[1];
				const label = title ?? type.charAt(0).toUpperCase() + type.slice(1);
				return `**${label}:**`;
			})
			// TabItem / Card / CategoryCard → bold label, keep content
			.replace(/<(?:TabItem|Card|CategoryCard)\b([^>]*?)\/?>/g, (_m, attrs: string) => {
				const title = /(?:label|title)="([^"]*)"/.exec(attrs)?.[1];
				return title ? `**${title}**` : '';
			})
			// SectionHeading → markdown heading
			.replace(/<SectionHeading\b([^>]*?)\/?>/g, (_m, attrs: string) => {
				const title = /title="([^"]*)"/.exec(attrs)?.[1];
				return title ? `### ${title}` : '';
			})
			// Remaining capitalized JSX wrappers (Steps, Tabs, CardGrid, closers, …):
			// drop the tags, keep the children.
			.replace(/<\/?[A-Z]\w*(?:\s[^<>]*?)?\/?>/g, '')
			// Collapse the blank-line debris left behind
			.replace(/\n{3,}/g, '\n\n')
	);
}

/** All docs entries in sidebar-ish order, with stable section grouping. */
export async function getDocsEntries(): Promise<CollectionEntry<'docs'>[]> {
	const entries = await getCollection('docs');
	const sectionOrder = ['', 'getting-started', 'stack', 'guides', 'components'];
	const section = (id: string) => sectionOrder.indexOf(id.split('/')[0]);
	return entries.sort((a, b) => {
		const diff = section(a.id) - section(b.id);
		return diff !== 0 ? diff : a.id.localeCompare(b.id);
	});
}

/** URL of the agent-friendly markdown version of a docs entry. */
export function markdownUrl(entry: CollectionEntry<'docs'>): string {
	return `${SITE}/${entry.id === 'index' || entry.id === '' ? 'index' : entry.id}.md`;
}
