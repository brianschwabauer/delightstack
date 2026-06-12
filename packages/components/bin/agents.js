#!/usr/bin/env node
/**
 * `delightstack-agents` — sets up AI coding agents to use DelightStack well.
 *
 * - Installs the DelightStack skill at .claude/skills/delightstack/SKILL.md
 *   (picked up automatically by Claude Code)
 * - Appends a short pointer section to AGENTS.md (read by most coding agents;
 *   created if missing) referencing the skill and the markdown docs
 *
 * Run from your project root: `pnpm exec delightstack-agents`
 * Pass `--print` to write the skill to stdout instead of touching any files.
 */
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	appendFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const skillSource = join(dirname(fileURLToPath(import.meta.url)), '..', 'SKILL.md');

if (process.argv.includes('--print')) {
	process.stdout.write(readFileSync(skillSource, 'utf-8'));
	process.exit(0);
}

const root = process.cwd();
if (!existsSync(join(root, 'package.json'))) {
	console.error('No package.json found — run this from your project root.');
	process.exit(1);
}

// 1. Install the skill for Claude Code (and any agent that reads .claude/skills)
const skillDir = join(root, '.claude', 'skills', 'delightstack');
mkdirSync(skillDir, { recursive: true });
copyFileSync(skillSource, join(skillDir, 'SKILL.md'));
console.log('✓ Installed .claude/skills/delightstack/SKILL.md');

// 2. Point AGENTS.md at the skill (idempotent via marker comment)
const MARKER = '<!-- delightstack-agents -->';
const SECTION = `\n${MARKER}\n## UI components: DelightStack\n\nThis project uses DelightStack (\`@delightstack/components\`) for UI. Before building\nor changing UI, read \`.claude/skills/delightstack/SKILL.md\` (also at\n\`node_modules/@delightstack/components/SKILL.md\`) — it has the component index and\nconventions. Full docs as markdown: https://docs.thedelight.co/llms.txt (append \`.md\`\nto any docs page URL).\n`;

const agentsFile = join(root, 'AGENTS.md');
const existing = existsSync(agentsFile) ? readFileSync(agentsFile, 'utf-8') : '';
if (existing.includes(MARKER)) {
	console.log('✓ AGENTS.md already references DelightStack — left unchanged');
} else {
	appendFileSync(
		agentsFile,
		(existing && !existing.endsWith('\n') ? '\n' : '') + SECTION,
	);
	console.log(
		`✓ ${existing ? 'Updated' : 'Created'} AGENTS.md with a DelightStack section`,
	);
}

console.log('\nAgents in this project now know how to use DelightStack.');
console.log(
	'Tip: if you use CLAUDE.md instead of AGENTS.md, move the appended section there.',
);
