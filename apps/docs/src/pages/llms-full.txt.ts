import type { APIRoute } from 'astro';
import { getDocsEntries, markdownUrl, toMarkdown } from '../lib/llms';

export const GET: APIRoute = async () => {
	const entries = await getDocsEntries();
	const pages = entries.map(
		(entry) => `<!-- Source: ${markdownUrl(entry)} -->\n\n${toMarkdown(entry)}`,
	);
	const text = `<!-- DelightStack — full documentation for LLMs. Index: https://docs.thedelight.co/llms.txt -->\n\n${pages.join('\n\n---\n\n')}`;

	return new Response(text, {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
};
