import type { BlockSchemaSpec, BlockSpec } from '../types/index.js';

/**
 * Identity helper for defining the isomorphic (worker-safe) half of a block:
 * its name + ProseMirror NodeSpec. Put these in a file shared between client
 * and worker if you plan to use collaborative editing.
 */
export function defineBlockSchema(spec: BlockSchemaSpec): BlockSchemaSpec {
	return spec;
}

/**
 * Identity helper for defining a block with full type inference. Registers
 * everything about a block in one object: schema, Svelte node view,
 * interactive chrome, settings, commands, paste matching, and server
 * rendering.
 *
 * ```ts
 * const callout = defineBlock<{ variant: string }>({
 *   name: 'callout',
 *   schema: { group: 'block', content: 'block+', attrs: { variant: { default: 'info' } }, ... },
 *   component: CalloutBlock,
 *   settings: [{ attr: 'variant', label: 'Variant', control: 'select', options: [...] }],
 *   commands: [{ name: 'callout', label: 'Callout', group: 'Basic', run: (e) => e.insertBlock('callout') }],
 * });
 * ```
 */
export function defineBlock<
	Attrs extends Record<string, unknown> = Record<string, unknown>,
>(spec: BlockSpec<Attrs>): BlockSpec<Attrs> {
	return spec;
}
