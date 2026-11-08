import { DelightError } from '@delightstack/utilities';
import {
	applyDefaults,
	compileInputSchema,
	formatViolations,
	validateInput,
} from './schema.js';
import type {
	JsonValue,
	McpContent,
	McpTool,
	McpToolContext,
	McpToolInput,
	McpToolResult,
	McpToolReturn,
} from './types.js';

/**
 * The tool registry: definition, listing, and the one call path.
 *
 * A tool's `run` returns whatever is natural — a string, content blocks, a
 * plain object — and this module normalizes it. The normalization always
 * produces *both* a text block and `structuredContent` when the return is
 * structured, because clients differ on which one they show, and a tool whose
 * result is invisible in half of them is a tool that gets called twice.
 */

/**
 * Defines one tool.
 *
 * Purely an identity function with inference attached: it exists so a tool
 * literal gets checked against {@link McpTool} at its definition site rather
 * than at the point it is put in a list, where the error would name the list.
 */
export function defineTool<Input extends Record<string, unknown>, Locals = unknown>(
	tool: McpTool<Input, Locals>,
): McpTool<Input, Locals> {
	return tool;
}

/** A tool as `tools/list` publishes it. Wire keys, so camelCase. */
export interface McpToolDescriptor {
	name: string;
	title?: string;
	description: string;
	inputSchema: ReturnType<typeof compileInputSchema>;
	annotations?: Record<string, unknown>;
	_meta?: Record<string, unknown>;
}

export interface McpToolRegistry<Locals = unknown> {
	/** Every registered tool, in definition order. */
	all(): McpTool<never, Locals>[];
	get(name: string): McpTool<never, Locals> | undefined;
	/** The `tools/list` payload, filtered to the scopes the caller holds. */
	list(scopes?: string[] | null): McpToolDescriptor[];
	call(name: string, args: unknown, ctx: McpToolContext<Locals>): Promise<McpToolResult>;
}

const NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Builds the registry.
 *
 * `has_scope` is injected rather than being a set membership test, because
 * scopes are frequently a ladder — `vault:admin` implying `vault:write`
 * implying `vault:read` — and only the application knows the shape of its own.
 * The default is plain membership.
 */
export function createToolRegistry<Locals = unknown>(
	tools: McpTool<never, Locals>[],
	options?: {
		has_scope?: (granted: string[], required: string) => boolean;
	},
): McpToolRegistry<Locals> {
	const by_name = new Map<string, McpTool<never, Locals>>();
	for (const tool of tools) {
		if (!NAME_PATTERN.test(tool.name)) {
			throw new DelightError({
				message: `Invalid MCP tool name "${tool.name}"`,
				status: 500,
				detail:
					'Tool names are stable API: lowercase, digits and underscores, starting with a letter, at most 64 characters.',
			});
		}
		if (by_name.has(tool.name)) {
			throw new DelightError({
				message: `Duplicate MCP tool "${tool.name}"`,
				status: 500,
			});
		}
		by_name.set(tool.name, tool);
	}

	const hasScope =
		options?.has_scope ??
		((granted: string[], required: string) => granted.includes(required));

	const describe = (tool: McpTool<never, Locals>): McpToolDescriptor => {
		const descriptor: McpToolDescriptor = {
			name: tool.name,
			description: tool.description,
			inputSchema: compileInputSchema(tool.input as McpToolInput),
		};
		if (tool.title) descriptor.title = tool.title;
		if (tool.annotations) descriptor.annotations = { ...tool.annotations };
		if (tool.scope) descriptor._meta = { 'co.thedelight/scope': tool.scope };
		return descriptor;
	};

	return {
		all: () => [...by_name.values()],
		get: (name) => by_name.get(name),
		list(scopes) {
			// A tool the caller cannot call is a tool the caller should not see:
			// listing it only invites a call that fails, and the model has no way
			// to tell "you may not" from "this is broken".
			const visible = scopes
				? [...by_name.values()].filter((t) => !t.scope || hasScope(scopes, t.scope))
				: [...by_name.values()];
			return visible.map(describe);
		},
		async call(name, args, ctx) {
			const tool = by_name.get(name);
			if (!tool) {
				throw new DelightError({ message: `Unknown tool "${name}"`, status: 404 });
			}
			if (tool.scope) {
				const granted = ctx.auth?.scopes ?? [];
				if (!hasScope(granted, tool.scope)) {
					throw new DelightError({
						message: `This token is missing ${tool.scope}`,
						status: 403,
						code: 'insufficient_scope',
						detail: tool.scope,
					});
				}
			}

			const validation = validateInput(args, tool.input as McpToolInput);
			if (!validation.valid) {
				// Reported as a *protocol* error rather than an `isError` result.
				// Malformed arguments never reached the tool, so nothing happened
				// that the model needs to reason about — it needs to retry.
				throw new DelightError({
					message: `Invalid arguments for "${name}" — ${formatViolations(validation.violations)}`,
					status: 400,
					code: 'invalid_arguments',
				});
			}

			const prepared = applyDefaults(
				(args as Record<string, unknown> | undefined) ?? {},
				tool.input as McpToolInput,
			);
			const returned = await tool.run(prepared as never, ctx);
			return normalizeResult(returned);
		},
	};
}

/** Turns whatever a tool returned into the MCP result shape. */
export function normalizeResult(value: McpToolReturn): McpToolResult {
	if (typeof value === 'string') {
		return { content: [{ type: 'text', text: value }] };
	}
	if (Array.isArray(value) && value.every(isContentBlock)) {
		return { content: value as McpContent[] };
	}
	if (isToolResult(value)) {
		return value;
	}
	// Structured returns get both representations — see the note at the top.
	const text = JSON.stringify(value, null, 2) ?? String(value);
	return {
		content: [{ type: 'text', text }],
		structuredContent: value as JsonValue,
	};
}

function isContentBlock(value: unknown): boolean {
	if (typeof value !== 'object' || value === null) return false;
	const type = (value as { type?: unknown }).type;
	return (
		type === 'text' || type === 'image' || type === 'audio' || type === 'resource_link'
	);
}

function isToolResult(value: unknown): value is McpToolResult {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const content = (value as { content?: unknown }).content;
	return Array.isArray(content) && content.every(isContentBlock);
}

/** Builds the `isError` result a failed tool call reports to the model. */
export function toolError(message: string, detail?: string): McpToolResult {
	return {
		content: [{ type: 'text', text: detail ? `${message}\n\n${detail}` : message }],
		isError: true,
	};
}
