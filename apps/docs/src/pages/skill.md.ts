import type { APIRoute } from 'astro';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Serves the agent skill shipped inside @delightstack/components so agents
// (and the `delightstack-agents` setup command docs) can fetch it directly.
const skillPath = fileURLToPath(
	new URL('../../../../packages/components/SKILL.md', import.meta.url),
);

export const GET: APIRoute = () => {
	return new Response(readFileSync(skillPath, 'utf-8'), {
		headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
	});
};
