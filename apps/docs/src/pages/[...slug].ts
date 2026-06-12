import type { APIRoute, GetStaticPaths } from 'astro';
import { getDocsEntries, toMarkdown } from '../lib/llms';

// Serves every docs page as plain markdown at `<page-url>.md`
// (e.g. /components/navigation/bottom-sheet.md) for AI agents and curl users.
export const getStaticPaths: GetStaticPaths = async () => {
	const entries = await getDocsEntries();
	return entries.map((entry) => ({
		params: { slug: `${entry.id === '' ? 'index' : entry.id}.md` },
		props: { entry },
	}));
};

export const GET: APIRoute = ({ props }) => {
	return new Response(toMarkdown(props.entry), {
		headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
	});
};
