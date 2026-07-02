import { Node as PMNode, type Attrs, type Schema } from 'prosemirror-model';
import {
	EditorState,
	NodeSelection,
	Plugin,
	PluginKey,
	TextSelection,
	type Command as PMCommand,
	type Transaction,
} from 'prosemirror-state';
import { DecorationSet, EditorView, type NodeViewConstructor } from 'prosemirror-view';
import { history, redo, redoDepth, undo, undoDepth } from 'prosemirror-history';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { untrack } from 'svelte';
import { DelightError } from '@delightstack/utilities';
import type {
	BlockSpec,
	EditorCommand,
	JSONContent,
	UploadState,
	Uploader,
} from '../types/index.js';
import { buildSchema, type BuildSchemaOptions } from '../schema/index.js';
import { buildKeymaps } from './keymap.js';
import { buildInputRules } from './input-rules.js';
import { insertNode, toggleBlockType, toggleMark } from './commands.js';
import { placeholder, type PlaceholderOption } from './plugins/placeholder.js';
import { blockIds } from './plugins/block-id.js';
import { todoClicks } from './plugins/todo.js';
import { uploads } from './plugins/upload.svelte.js';
import { paste, type PasteOptions } from './plugins/paste.js';
import { animateBlockMoves, captureBlockRects, dragAutoScroll } from './plugins/drop.js';
import { renderText } from '../render/index.js';
import { inputRules, type InputRule } from 'prosemirror-inputrules';
import { CommandRegistry } from './registry.svelte.js';
import { keymap } from 'prosemirror-keymap';
import { builtinCommands } from './builtin-commands.js';
import { suggestion, type SuggestionOptions } from './plugins/suggestion.js';
import type { SuggestionHandler } from '../types/index.js';

export interface EditorOptions {
	/** Initial document as ProseMirror JSON */
	content?: JSONContent | null;
	/** Block specs to register (see `defineBlock`). Include `defaultBlocks()` for the built-in media/callout/code blocks. */
	blocks?: BlockSpec[];
	/** Extra commands for the slash/plus/toolbar menus */
	commands?: EditorCommand[];
	/** Upload backend for images/files. Without one, upload entry points are hidden. */
	uploader?: Uploader;
	editable?: boolean;
	/** Placeholder for the empty document */
	placeholder?: PlaceholderOption;
	/** Extra marks or overrides for the base schema */
	marks?: BuildSchemaOptions['marks'];
	/** Escape hatch for raw ProseMirror plugins (appended after built-ins) */
	plugins?: (ctx: { schema: Schema; editor: Editor }) => Plugin[];
	/**
	 * Undo/redo. `false` disables, an options object configures
	 * prosemirror-history, and a factory replaces it entirely (the seam the
	 * collab extension uses to install rebase-aware history).
	 */
	history?: boolean | { new_group_delay?: number } | ((schema: Schema) => Plugin[]);
	/** Paste behavior (markdown parsing, custom HTML transform) */
	paste?: PasteOptions;
	link?: {
		/** Normalize/validate an href; return null to reject */
		validate?: (href: string) => string | null;
	};
}

export type EditorEvent = 'update' | 'selection' | 'focus' | 'blur' | 'transaction';

export interface SelectionInfo {
	from: number;
	to: number;
	empty: boolean;
	type: 'text' | 'node' | 'all' | 'gap';
}

export interface ActiveBlockInfo {
	name: string;
	attrs: Record<string, unknown>;
	pos: number;
	depth: number;
}

type DecorationBuilder = (state: EditorState) => DecorationSet;

const decorationSourcesKey = new PluginKey<null>('decoration_sources');

/**
 * The delightstack editor. Owns the ProseMirror state/view and mirrors the
 * interesting parts into Svelte 5 runes so menus, toolbars, and app UI can
 * react to it directly.
 *
 * ```svelte
 * <script>
 *   import { Editor as EditorClass, defaultBlocks } from '@delightstack/editor';
 *   import { Editor } from '@delightstack/editor/components';
 *   const editor = new EditorClass({ blocks: defaultBlocks() });
 * </script>
 * <Editor {editor} />
 * ```
 */
export class Editor {
	readonly schema: Schema;
	readonly commands = new CommandRegistry();
	readonly blocks: ReadonlyMap<string, BlockSpec>;
	readonly uploader: Uploader | undefined;

	#options: EditorOptions;
	#view: EditorView | null = null;
	#pmState: EditorState;
	#historyEnabled: boolean;
	#decorationSources = new Map<string, DecorationBuilder>();
	#listeners = new Map<EditorEvent, Set<(editor: Editor, tr?: Transaction) => void>>();
	#dispatchWrappers: ((tr: Transaction, next: (tr: Transaction) => void) => void)[] = [];
	/** Node view factories injected by block resolution (Svelte bridge) */
	#nodeViews: Record<string, NodeViewConstructor> = {};

	// ---- reactive state (runes) ----
	#tick = $state(0); // bumped on every transaction
	#docTick = $state(0); // bumped on doc changes
	#docCache: { tick: number; json: JSONContent } | null = null;
	#selection = $state<SelectionInfo>({ from: 0, to: 0, empty: true, type: 'text' });
	#active_marks = $state<Record<string, Record<string, unknown> | true>>({});
	#active_block = $state<ActiveBlockInfo | null>(null);
	#can_undo = $state(false);
	#can_redo = $state(false);
	#is_empty = $state(true);
	#focused = $state(false);
	#editable = $state(true);
	#readonly_preview = $state(false);
	uploads = $state<UploadState[]>([]);

	constructor(options: EditorOptions = {}) {
		this.#options = options;
		this.uploader = options.uploader;
		this.#editable = options.editable !== false;
		this.#historyEnabled = options.history !== false;

		const blocks = new Map<string, BlockSpec>();
		for (const block of options.blocks ?? []) blocks.set(block.name, block);
		this.blocks = blocks;
		this.schema = buildSchema([...blocks.values()], { marks: options.marks });

		this.commands.register(...builtinCommands(this.schema));
		for (const block of blocks.values()) {
			if (block.commands?.length) this.commands.register(...block.commands);
		}
		if (options.commands?.length) this.commands.register(...options.commands);

		this.#pmState = EditorState.create({
			doc: this.#parseContent(options.content),
			schema: this.schema,
			plugins: this.#buildPlugins(),
		});
		this.#syncFromState(null);
	}

	// ---- reactive getters ----

	/** The document as JSON (lazily serialized; reading it is reactive) */
	get doc(): JSONContent {
		const tick = this.#docTick;
		if (this.#docCache?.tick !== tick) {
			this.#docCache = { tick, json: this.#pmState.doc.toJSON() as JSONContent };
		}
		return this.#docCache.json;
	}

	get selection(): SelectionInfo {
		return this.#selection;
	}

	/** Marks active at the selection: `{ bold: true, link: { href } }` */
	get active_marks(): Record<string, Record<string, unknown> | true> {
		return this.#active_marks;
	}

	/** The innermost block at the selection head */
	get active_block(): ActiveBlockInfo | null {
		return this.#active_block;
	}

	get can_undo(): boolean {
		return this.#can_undo;
	}

	get can_redo(): boolean {
		return this.#can_redo;
	}

	get is_empty(): boolean {
		return this.#is_empty;
	}

	get focused(): boolean {
		return this.#focused;
	}

	get editable(): boolean {
		return this.#editable && !this.#readonly_preview;
	}

	set editable(value: boolean) {
		this.#editable = value;
		// setProps re-invokes the `editable()` view prop synchronously, which
		// reads the state written above — untrack so a caller's $effect doesn't
		// subscribe to its own write and loop.
		untrack(() => this.#view?.setProps({}));
	}

	get view(): EditorView | null {
		return this.#view;
	}

	get state(): EditorState {
		return this.#pmState;
	}

	// ---- lifecycle ----

	/** Mounts the ProseMirror view. Usually called by the `<Editor>` component. */
	mount(dom: HTMLElement): void {
		if (this.#view) throw new DelightError('Editor is already mounted');
		dom.replaceChildren();
		// mount() is typically called from an attachment ($effect context);
		// constructing the view synchronously invokes editable() and mounts
		// node views, all of which read reactive state — untrack so the
		// attachment doesn't re-run (remounting the view) on every change.
		untrack(() => {
			this.#view = new EditorView(
				{ mount: dom },
				{
					state: this.#pmState,
					editable: () => this.editable,
					nodeViews: this.#nodeViews,
					dispatchTransaction: (tr) => this.dispatch(tr),
					handleDOMEvents: {
						focus: () => {
							this.#focused = true;
							this.#emit('focus');
							return false;
						},
						blur: () => {
							this.#focused = false;
							this.#emit('blur');
							return false;
						},
					},
				},
			);
		});
	}

	/** Detaches the view (the editor can be re-mounted; listeners survive). */
	unmount(): void {
		this.#view?.destroy();
		this.#view = null;
		this.#focused = false;
	}

	destroy(): void {
		this.unmount();
		this.#listeners.clear();
	}

	// ---- content ----

	setContent(content: JSONContent | null, opts: { add_to_history?: boolean } = {}): void {
		const doc = this.#parseContent(content);
		if (opts.add_to_history) {
			const tr = this.#pmState.tr.replaceWith(
				0,
				this.#pmState.doc.content.size,
				doc.content,
			);
			this.dispatch(tr);
			return;
		}
		const state = EditorState.create({
			doc,
			schema: this.schema,
			plugins: this.#pmState.plugins,
		});
		this.setState(state);
	}

	getJSON(opts: { strip_uploading?: boolean } = {}): JSONContent {
		const json = this.#pmState.doc.toJSON() as JSONContent;
		if (opts.strip_uploading === false) return json;
		return stripUploading(json) ?? { type: 'doc', content: [{ type: 'paragraph' }] };
	}

	/** Plaintext extraction (search indexing, AI context) */
	getText(): string {
		const text: Record<string, (node: JSONContent) => string> = {};
		for (const [name, block] of this.blocks) {
			if (block.render_text) text[name] = block.render_text;
		}
		return renderText(this.getJSON(), { text });
	}

	// ---- commands ----

	/** Runs a registered `EditorCommand` by name. */
	run(name: string, params?: Record<string, unknown>): boolean {
		const command = this.commands.get(name);
		if (!command) return false;
		if (command.is_enabled && !command.is_enabled(this)) return false;
		const result = command.run(this, params as { range?: { from: number; to: number } });
		return result !== false;
	}

	/** Runs a raw ProseMirror command with focus restored to the editor. */
	exec(command: PMCommand): boolean {
		const view = this.#view;
		if (view) {
			view.focus();
			return command(view.state, view.dispatch, view);
		}
		return command(this.#pmState, (tr) => this.dispatch(tr));
	}

	undo(): boolean {
		return this.#historyEnabled && this.exec(undo);
	}

	redo(): boolean {
		return this.#historyEnabled && this.exec(redo);
	}

	toggleMark(name: string, attrs?: Record<string, unknown>): boolean {
		const mark = this.schema.marks[name];
		if (!mark) return false;
		return this.exec(toggleMark(mark, attrs as Attrs));
	}

	/** Sets the selected textblock(s) to a type, toggling back to paragraph. */
	setBlock(name: string, attrs?: Record<string, unknown>): boolean {
		const type = this.schema.nodes[name];
		if (!type) return false;
		return this.exec(toggleBlockType(type, attrs as Attrs));
	}

	insertBlock(name: string, attrs?: Record<string, unknown>, pos?: number): boolean {
		const type = this.schema.nodes[name];
		if (!type) return false;
		return this.exec(insertNode(type, attrs as Attrs, pos));
	}

	updateNodeAttrs(pos: number, patch: Record<string, unknown>): void {
		const node = this.#pmState.doc.nodeAt(pos);
		if (!node) return;
		this.dispatch(this.#pmState.tr.setNodeMarkup(pos, null, { ...node.attrs, ...patch }));
	}

	deleteNode(pos: number): void {
		const node = this.#pmState.doc.nodeAt(pos);
		if (!node) return;
		this.dispatch(this.#pmState.tr.delete(pos, pos + node.nodeSize).scrollIntoView());
	}

	selectNode(pos: number): void {
		const node = this.#pmState.doc.nodeAt(pos);
		if (!node || node.type.spec.selectable === false) return;
		this.dispatch(
			this.#pmState.tr.setSelection(NodeSelection.create(this.#pmState.doc, pos)),
		);
	}

	focus(position?: 'start' | 'end' | number): void {
		const view = this.#view;
		if (!view) return;
		if (position !== undefined) {
			const size = view.state.doc.content.size;
			const pos =
				position === 'start' ? 0 : position === 'end' ? size : Math.min(position, size);
			const selection = TextSelection.near(
				view.state.doc.resolve(pos),
				position === 'start' ? 1 : -1,
			);
			view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
		}
		view.focus();
	}

	/** Entry point for programmatic uploads. Wired by the upload plugin. */
	uploadFiles(files: File[] | FileList, pos?: number): void {
		this.#uploadHandler?.(Array.from(files), pos);
	}

	#uploadHandler: ((files: File[], pos?: number) => void) | null = null;

	/** @internal — the upload plugin registers itself here */
	setUploadHandler(handler: ((files: File[], pos?: number) => void) | null): void {
		this.#uploadHandler = handler;
	}

	// ---- transaction funnel ----

	#loop_guard = { count: 0, window: 0 };

	/** Every transaction flows through here (the collab/extension seam). */
	dispatch = (tr: Transaction): void => {
		// Safety net: a plugin/effect feedback loop shows up as a transaction
		// storm. Throwing surfaces a stack trace instead of freezing the tab.
		const now = Date.now();
		if (now - this.#loop_guard.window > 1000) {
			this.#loop_guard = { count: 0, window: now };
		}
		if (++this.#loop_guard.count > 500) {
			throw new DelightError('editor dispatch loop detected (>500 tx/s)');
		}
		let index = -1;
		const next = (t: Transaction): void => {
			index++;
			const wrapper = this.#dispatchWrappers[index];
			if (wrapper) wrapper(t, next);
			else this.#apply(t);
		};
		next(tr);
	};

	/** Wraps the dispatch funnel (outermost last). Returns an unwrap fn. */
	wrapDispatch(
		wrapper: (tr: Transaction, next: (tr: Transaction) => void) => void,
	): () => void {
		this.#dispatchWrappers.push(wrapper);
		return () => {
			this.#dispatchWrappers = this.#dispatchWrappers.filter(
				(entry) => entry !== wrapper,
			);
		};
	}

	#apply(tr: Transaction): void {
		// FLIP-animate block reordering on drops
		const flip =
			tr.docChanged && tr.getMeta('uiEvent') === 'drop' && this.#view
				? captureBlockRects(this.#view)
				: null;
		const state = this.#pmState.apply(tr);
		this.#pmState = state;
		untrack(() => {
			this.#view?.updateState(state);
			if (flip && this.#view) animateBlockMoves(this.#view, flip);
		});
		this.#syncFromState(tr);
		this.#emit('transaction', tr);
		if (tr.docChanged) this.#emit('update', tr);
		if (tr.selectionSet || tr.docChanged) this.#emit('selection', tr);
	}

	// ---- phase-2 seams ----

	/**
	 * Registers a named decoration source (presence cursors, comments, …).
	 * Pass `null` to remove. Sources from all keys are merged and rendered.
	 */
	setDecorations(key: string, build: DecorationBuilder | null): void {
		if (build) this.#decorationSources.set(key, build);
		else this.#decorationSources.delete(key);
		// Repaint
		if (this.#view) this.dispatch(this.#pmState.tr.setMeta(decorationSourcesKey, true));
	}

	/**
	 * Adds plugins to the live state (state is reconfigured in place).
	 * `prepend` puts them before the built-ins so their key handlers win
	 * over the base keymaps (menus need Enter/Tab before splitBlock sees it).
	 */
	registerPlugins(plugins: Plugin[], opts: { prepend?: boolean } = {}): void {
		const state = this.#pmState.reconfigure({
			plugins: opts.prepend
				? [...plugins, ...this.#pmState.plugins]
				: [...this.#pmState.plugins, ...plugins],
		});
		this.setState(state);
	}

	removePlugins(plugins: Plugin[]): void {
		const state = this.#pmState.reconfigure({
			plugins: this.#pmState.plugins.filter((plugin) => !plugins.includes(plugin)),
		});
		this.setState(state);
	}

	/**
	 * Registers a trigger-character menu ('/' slash menu, '@' mentions, …).
	 * The handler ref is late-bound so a Svelte component can own all menu
	 * state. Returns an unregister fn.
	 */
	suggest(
		char: string,
		handler: () => SuggestionHandler | null,
		opts: Omit<SuggestionOptions, 'char' | 'handler'> = {},
	): () => void {
		const plugin = suggestion({ char, handler, ...opts });
		this.registerPlugins([plugin], { prepend: true });
		return () => this.removePlugins([plugin]);
	}

	/**
	 * Resolves viewport coordinates to the top-level block underneath them
	 * (used by the gutter plus button / drag handle).
	 */
	blockAt(coords: { x: number; y: number }): {
		pos: number;
		name: string;
		block_id: string | null;
		rect: DOMRect;
	} | null {
		const view = this.#view;
		if (!view) return null;
		// Clamp x into the content box so hovering the gutter strip (left of
		// the contenteditable) still resolves the block on that line
		const bounds = view.dom.getBoundingClientRect();
		const x = Math.max(bounds.left + 1, Math.min(coords.x, bounds.right - 1));
		const found = view.posAtCoords({ left: x, top: coords.y });
		if (!found) return null;
		const doc = view.state.doc;
		const raw = Math.max(
			0,
			Math.min(found.inside >= 0 ? found.inside : found.pos, doc.content.size),
		);
		const resolved = doc.resolve(raw);
		let pos: number;
		if (resolved.depth === 0) {
			if (!resolved.nodeAfter) return null;
			pos = raw;
		} else {
			pos = resolved.before(1);
		}
		const node = doc.nodeAt(pos);
		if (!node) return null;
		const dom = view.nodeDOM(pos);
		if (!(dom instanceof HTMLElement)) return null;
		return {
			pos,
			name: node.type.name,
			block_id: typeof node.attrs.block_id === 'string' ? node.attrs.block_id : null,
			rect: dom.getBoundingClientRect(),
		};
	}

	/** Swaps the entire editor state (used by version preview). */
	setState(state: EditorState, opts: { readonly?: boolean } = {}): void {
		this.#pmState = state;
		this.#readonly_preview = opts.readonly ?? false;
		// View updates re-enter reactive reads (editable(), node view mounts)
		// synchronously — untrack so calling from an $effect can't loop.
		untrack(() => {
			this.#view?.updateState(state);
			this.#view?.setProps({});
		});
		this.#syncFromState(null);
		this.#emit('update');
	}

	/** Reads a plugin's state reactively (re-evaluates on every transaction). */
	pluginState<T>(key: PluginKey<T>): T | undefined {
		void this.#tick;
		return key.getState(this.#pmState);
	}

	on(
		event: EditorEvent,
		handler: (editor: Editor, tr?: Transaction) => void,
	): () => void {
		let handlers = this.#listeners.get(event);
		if (!handlers) this.#listeners.set(event, (handlers = new Set()));
		handlers.add(handler);
		return () => handlers.delete(handler);
	}

	/** @internal — block resolution injects Svelte node views here before mount */
	setNodeViews(nodeViews: Record<string, NodeViewConstructor>): void {
		Object.assign(this.#nodeViews, nodeViews);
		this.#view?.setProps({ nodeViews: this.#nodeViews });
	}

	// ---- internals ----

	#emit(event: EditorEvent, tr?: Transaction): void {
		const handlers = this.#listeners.get(event);
		if (!handlers) return;
		for (const handler of handlers) handler(this, tr);
	}

	#parseContent(content: JSONContent | null | undefined): PMNode {
		if (!content) {
			return this.schema.node('doc', null, [this.schema.node('paragraph')]);
		}
		try {
			return PMNode.fromJSON(this.schema, content);
		} catch (error) {
			throw new DelightError({
				message: `Invalid editor content: ${error instanceof Error ? error.message : String(error)}`,
				status: 400,
				code: 'invalid_editor_content',
			});
		}
	}

	#buildPlugins(): Plugin[] {
		const plugins: Plugin[] = [];
		const historyOption = this.#options.history;

		// Block-contributed keymaps + input rules bind tighter than the base
		for (const block of this.blocks.values()) {
			if (block.keymap) plugins.push(keymap(block.keymap));
		}
		plugins.push(buildInputRules(this.schema));
		const blockRules: InputRule[] = [];
		for (const block of this.blocks.values()) {
			if (block.input_rules) blockRules.push(...block.input_rules(this.schema));
		}
		if (blockRules.length) plugins.push(inputRules({ rules: blockRules }));
		plugins.push(...buildKeymaps(this.schema, { history: this.#historyEnabled }));

		if (typeof historyOption === 'function') {
			plugins.push(...historyOption(this.schema));
		} else if (historyOption !== false) {
			const config = typeof historyOption === 'object' ? historyOption : {};
			plugins.push(history({ newGroupDelay: config.new_group_delay ?? 250 }));
		}

		plugins.push(
			dropCursor({ class: 'ds-dropcursor', width: 2 }),
			dragAutoScroll(),
			gapCursor(),
			placeholder(this.#options.placeholder),
			blockIds(),
			todoClicks(),
		);
		if (this.uploader) plugins.push(uploads(this));
		plugins.push(paste(this, this.#options.paste));

		for (const block of this.blocks.values()) {
			if (block.plugins) plugins.push(...block.plugins({ schema: this.schema }));
		}
		if (this.#options.plugins) {
			plugins.push(...this.#options.plugins({ schema: this.schema, editor: this }));
		}

		// Merged decoration sources (presence/comments seam) — last so it can't
		// be shadowed by block plugins.
		const sources = this.#decorationSources;
		plugins.push(
			new Plugin({
				key: decorationSourcesKey,
				props: {
					decorations(state) {
						if (!sources.size) return DecorationSet.empty;
						const all = [...sources.values()].flatMap((build) => build(state).find());
						return all.length
							? DecorationSet.create(state.doc, all)
							: DecorationSet.empty;
					},
				},
			}),
		);

		return plugins;
	}

	#syncFromState(tr: Transaction | null): void {
		// This can be called from inside a consumer $effect (e.g. a menu
		// registering its suggestion plugin). untrack so increments like
		// #tick++ don't subscribe that effect to the state it writes —
		// otherwise every transaction would re-run the effect in a loop.
		untrack(() => {
			const state = this.#pmState;
			this.#tick++;
			if (!tr || tr.docChanged) this.#docTick++;

			const { from, to, empty } = state.selection;
			const type = state.selection instanceof NodeSelection ? 'node' : 'text';
			this.#selection = { from, to, empty, type };

			if (!tr || tr.docChanged || tr.selectionSet || tr.storedMarksSet) {
				this.#active_marks = computeActiveMarks(state);
				this.#active_block = computeActiveBlock(state);
			}
			if (this.#historyEnabled) {
				this.#can_undo = undoDepth(state) > 0;
				this.#can_redo = redoDepth(state) > 0;
			}
			this.#is_empty =
				state.doc.childCount === 1 &&
				state.doc.firstChild?.type.name === 'paragraph' &&
				state.doc.firstChild.content.size === 0;
		});
	}
}

function computeActiveMarks(
	state: EditorState,
): Record<string, Record<string, unknown> | true> {
	const active: Record<string, Record<string, unknown> | true> = {};
	const { empty, from, to, $from: fromPos } = state.selection;
	if (empty) {
		const marks = state.storedMarks ?? fromPos.marks();
		for (const mark of marks) {
			active[mark.type.name] = Object.keys(mark.attrs).length ? { ...mark.attrs } : true;
		}
		return active;
	}
	for (const [name, type] of Object.entries(state.schema.marks)) {
		if (!state.doc.rangeHasMark(from, to, type)) continue;
		// Surface the attrs of the first instance in range (e.g. link href)
		let attrs: Record<string, unknown> | true = true;
		state.doc.nodesBetween(from, to, (node) => {
			if (attrs !== true) return false;
			const mark = node.marks.find((m) => m.type === type);
			if (mark && Object.keys(mark.attrs).length) attrs = { ...mark.attrs };
			return true;
		});
		active[name] = attrs;
	}
	return active;
}

function computeActiveBlock(state: EditorState): ActiveBlockInfo | null {
	const { $from: fromPos } = state.selection;
	if (state.selection instanceof NodeSelection) {
		const node = state.selection.node;
		return {
			name: node.type.name,
			attrs: { ...node.attrs },
			pos: state.selection.from,
			depth: fromPos.depth,
		};
	}
	for (let depth = fromPos.depth; depth > 0; depth--) {
		const node = fromPos.node(depth);
		if (node.isTextblock || node.type.spec.group?.includes('block')) {
			return {
				name: node.type.name,
				attrs: { ...node.attrs },
				pos: fromPos.before(depth),
				depth,
			};
		}
	}
	return null;
}

function stripUploading(node: JSONContent): JSONContent | null {
	if (node.attrs?.uploading === true) return null;
	if (!node.content) return node;
	const content = node.content
		.map((child) => stripUploading(child))
		.filter((child): child is JSONContent => child !== null);
	return { ...node, content };
}
