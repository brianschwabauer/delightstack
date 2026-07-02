import { flushSync, mount, unmount } from 'svelte';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view';
import type { BlockSpec } from '../../types/index.js';
import type { Editor } from '../editor.svelte.js';
import { BlockViewProps } from './block-props.svelte.js';
import BlockWrapper from '../../components/BlockWrapper.svelte';
import TodoItemView from '../../components/blocks/TodoItemView.svelte';

/**
 * Builds the ProseMirror `nodeViews` map from the editor's block specs.
 * Every spec with a Svelte `component` gets a bridge NodeView; specs without
 * one render statically through their schema `toDOM`.
 */
export function svelteNodeViews(editor: Editor): Record<string, NodeViewConstructor> {
	const views: Record<string, NodeViewConstructor> = {};
	for (const [name, spec] of editor.blocks) {
		if (!spec.component) continue;
		views[name] = (node, view, getPos) =>
			new SvelteNodeView(spec, editor, node, view, getPos);
	}
	// Base-schema todo items render the design system's Checkbox (animations
	// and all) instead of a CSS-drawn box. Registered here — not a BlockSpec —
	// because todo_item is part of the base schema, not a registered block.
	if (editor.schema.nodes.todo_item && !views.todo_item) {
		const spec = {
			name: 'todo_item',
			schema: {},
			component: TodoItemView,
			interactive: false,
			wrapper_tag: 'li',
		} as unknown as BlockSpec;
		views.todo_item = (node, view, getPos) =>
			new SvelteNodeView(spec, editor, node, view, getPos);
	}
	return views;
}

/**
 * NodeView ↔ Svelte 5 bridge. Fixes the prior-art pain of hand-rolled
 * imperative node views:
 * - the bridge owns the wrapper `dom` (never the component's root, so Svelte
 *   re-renders can't desync ProseMirror)
 * - `contentDOM` is claimed synchronously via the `content` attachment
 *   (flushSync during mount) for non-atom blocks
 * - node updates mutate ONE reactive props object; the component is never
 *   re-mounted
 * - everything outside `contentDOM` is opaque to ProseMirror
 *   (stopEvent/ignoreMutation), so component UI can't corrupt the document
 */
class SvelteNodeView implements NodeView {
	dom: HTMLElement;
	contentDOM: HTMLElement | undefined;

	#spec: BlockSpec;
	#node: PMNode;
	#props: BlockViewProps;
	#instance: Record<string, unknown>;

	constructor(
		spec: BlockSpec,
		editor: Editor,
		node: PMNode,
		_view: EditorView,
		getPos: () => number | undefined,
	) {
		this.#spec = spec;
		this.#node = node;
		this.dom = document.createElement(
			spec.wrapper_tag ?? (node.isInline ? 'span' : 'div'),
		);
		this.dom.classList.add('ds-block');
		this.dom.dataset.block = spec.name;

		this.#props = new BlockViewProps({
			editor,
			attrs: node.attrs,
			pos: getPos,
			content: (el) => {
				el.setAttribute('data-editor-content', '');
				this.contentDOM = el;
				return () => {
					if (this.contentDOM === el) this.contentDOM = undefined;
				};
			},
		});

		const interactive = spec.interactive === false ? false : (spec.interactive ?? {});
		let instance: Record<string, unknown>;
		flushSync(() => {
			instance =
				interactive === false
					? (mount(spec.component!, {
							target: this.dom,
							props: this.#props as never,
						}) as Record<string, unknown>)
					: (mount(BlockWrapper, {
							target: this.dom,
							props: { props: this.#props, spec, interactive },
						}) as Record<string, unknown>);
		});
		this.#instance = instance!;
	}

	update(node: PMNode): boolean {
		if (node.type.name !== this.#spec.name) return false;
		this.#node = node;
		this.#props.syncAttrs(node.attrs);
		return true;
	}

	selectNode(): void {
		this.#props.selected = true;
		this.dom.classList.add('selected');
	}

	deselectNode(): void {
		this.#props.selected = false;
		this.#props.settings_open = false;
		this.dom.classList.remove('selected');
	}

	stopEvent(event: Event): boolean {
		// Let ProseMirror handle events inside the editable content hole and
		// drag events (so block reordering works); everything else belongs to
		// the component's own UI.
		if (event.type.startsWith('drag')) return false;
		const target = event.target;
		if (!(target instanceof Node)) return true;
		return !this.contentDOM?.contains(target);
	}

	ignoreMutation(
		mutation: MutationRecord | { type: 'selection'; target: Node },
	): boolean {
		if (mutation.type === 'selection') {
			return !this.contentDOM?.contains(mutation.target);
		}
		return !this.contentDOM || !this.contentDOM.contains(mutation.target);
	}

	destroy(): void {
		unmount(this.#instance, { outro: false });
	}
}
