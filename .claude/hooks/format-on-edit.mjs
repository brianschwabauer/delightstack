#!/usr/bin/env node
// PostToolUse hook — auto-formats the file an agent just edited with oxfmt.
//
// Wired up in .claude/settings.json for Write|Edit|MultiEdit. It reads the hook
// payload from stdin, pulls out tool_input.file_path, and runs the local oxfmt
// binary on that one file (oxfmt writes in place by default).
//
// Designed to be completely non-blocking: a missing payload, a non-formattable
// extension, a missing file, or a missing/failing oxfmt all exit 0 silently so
// the agent's workflow is never interrupted. The repo's .oxfmtrc.json governs style.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, resolve } from 'node:path';

// Extensions oxfmt can format (mirrors .oxfmtrc.json coverage, incl. svelte:true).
const FORMATTABLE = new Set([
	'.ts',
	'.tsx',
	'.mts',
	'.cts',
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
	'.svelte',
	'.css',
	'.scss',
	'.less',
	'.json',
	'.jsonc',
	'.json5',
	'.yaml',
	'.yml',
	'.html',
]);

const exit = () => process.exit(0); // always succeed; this hook must never block

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

let payload;
try {
	payload = JSON.parse(readFileSync(0, 'utf8'));
} catch {
	exit();
}

const filePath = payload?.tool_input?.file_path;
if (!filePath || typeof filePath !== 'string') exit();

const absPath = isAbsolute(filePath) ? filePath : resolve(projectDir, filePath);
if (!existsSync(absPath)) exit();
if (!FORMATTABLE.has(extname(absPath).toLowerCase())) exit();

const binName = process.platform === 'win32' ? 'oxfmt.cmd' : 'oxfmt';
const bin = resolve(projectDir, 'node_modules', '.bin', binName);
if (!existsSync(bin)) exit();

// oxfmt defaults to --write (format in place). Ignore all I/O; never throw.
try {
	spawnSync(bin, [absPath], { cwd: projectDir, stdio: 'ignore' });
} catch {
	/* swallow */
}
exit();
