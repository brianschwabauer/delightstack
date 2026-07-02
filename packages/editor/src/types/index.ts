import type { NodeSpec, Schema } from 'prosemirror-model';
import type { Command as PMCommand, EditorState, Plugin } from 'prosemirror-state';
import type { InputRule } from 'prosemirror-inputrules';
import type { Component } from 'svelte';

/** A ProseMirror document (or fragment) as plain JSON — the storage format. */
export interface JSONContent {
	type: string;
	attrs?: Record<string, unknown>;
	content?: JSONContent[];
	marks?: { type: string; attrs?: Record<string, unknown> }[];
	text?: string;
}

/** Where a registered command surfaces in the UI. */
export type Surface = 'slash' | 'plus' | 'toolbar' | 'floating' | 'turn_into';

/**
 * A command definition. One definition powers the slash menu, plus menu,
 * toolbar, and floating menu consistently.
 */
export interface EditorCommand {
	/** Unique name, e.g. `heading_2`, `image` */
	name: string;
	label: string;
	description?: string;
	/** An inline SVG string or a Svelte component rendered at 20x20 */
	icon?: string | Component;
	/** Extra fuzzy-search terms for the slash menu */
	keywords?: string[];
	/** Slash/plus menu section, e.g. 'Basic', 'Media' */
	group?: string;
	/** Keyboard shortcut in ProseMirror keymap syntax, e.g. 'Mod-Alt-2' */
	keyboard?: string;
	/** Which UIs show this command. Default: ['slash', 'plus'] */
	surfaces?: Surface[];
	/** Toolbar pressed state */
	is_active?: (editor: EditorLike) => boolean;
	is_enabled?: (editor: EditorLike) => boolean;
	run: (
		editor: EditorLike,
		ctx?: { range?: { from: number; to: number } },
	) => boolean | void | Promise<boolean | void>;
}

/**
 * Structural type for the Editor class, used in definitions that must not
 * import the (Svelte-compiled) core module — e.g. worker-safe schema files.
 * The real `Editor` class satisfies this.
 */
export interface EditorLike {
	readonly schema: Schema;
	readonly state: EditorState;
	/** The document as JSON — reading it is reactive (re-runs on doc changes) */
	readonly doc: JSONContent;
	readonly active_marks: Record<string, Record<string, unknown> | true>;
	readonly active_block: {
		name: string;
		attrs: Record<string, unknown>;
		pos: number;
	} | null;
	readonly can_undo: boolean;
	readonly can_redo: boolean;
	readonly uploads: UploadState[];
	readonly uploader: Uploader | undefined;
	undo(): boolean;
	redo(): boolean;
	run(name: string, params?: Record<string, unknown>): boolean;
	exec(command: PMCommand): boolean;
	toggleMark(name: string, attrs?: Record<string, unknown>): boolean;
	setBlock(name: string, attrs?: Record<string, unknown>): boolean;
	insertBlock(name: string, attrs?: Record<string, unknown>, pos?: number): boolean;
	updateNodeAttrs(pos: number, patch: Record<string, unknown>): void;
	deleteNode(pos: number): void;
	selectNode(pos: number): void;
	focus(position?: 'start' | 'end' | number): void;
	uploadFiles(files: File[] | FileList, pos?: number): void;
}

/** A snap point for block resizing (all units are pixels of rendered width). */
/** Breakout width tier for blocks that can escape the text column. */
export type WidthMode = 'normal' | 'wide' | 'full';

export interface SnapPoint {
	value: number;
	/** Shown as a ghost badge while the drag is engaged, e.g. 'wide' */
	label?: string;
	/** Distance at which the magnet engages. Default 60 */
	engage_radius?: number;
	/** Distance required to escape once engaged. Default 100 */
	escape_radius?: number;
	/** Width mode this snap commits to (breakout blocks only). Default 'normal' */
	mode?: WidthMode;
}

export interface ResizeOptions<Attrs> {
	/** The attr that stores the committed size */
	attr: keyof Attrs & string;
	/** v1 supports horizontal resizing only */
	axis?: 'x';
	/** Unit of the committed attr value. Default 'percent' (of the container) */
	unit?: 'percent' | 'px';
	snap_points?: (ctx: { container_width: number; editor: EditorLike }) => SnapPoint[];
	/** Bounds in px of rendered width. Default min 120 */
	min?: number;
	max?: number;
	/**
	 * Allow dragging past the text column into the page: adds snap points at
	 * the wide (`--editor-wide-width`, default `min(1100px, 100vw - 2rem)`)
	 * and full (`--editor-full-width`, default `100vw`) breakout widths, and
	 * commits the tier to the block's `width_mode` attr (which the block's
	 * schema must declare). Hosts with off-center or clipped layouts can
	 * override the two CSS custom properties (e.g. to `100%`) and the
	 * centering math degrades gracefully. Default false
	 */
	breakout?: boolean;
}

export interface CropOptions<Attrs = Record<string, unknown>> {
	/** Attr storing the cropped aspect ratio (width/height); null = uncropped */
	aspect_attr: keyof Attrs & string;
	/**
	 * Natural aspect ratio (width/height) of the media. Cropping only
	 * shortens: the committed aspect is always >= this. Return null while
	 * unknown (e.g. mid-upload) to disable the handle.
	 */
	natural: (attrs: Attrs) => number | null;
	/** Attr patch applied when the crop is cleared (e.g. reset focal point) */
	reset?: Partial<Attrs>;
	/** Minimum cropped height in px. Default 80 */
	min_height?: number;
}

export interface InteractiveOptions<Attrs = Record<string, unknown>> {
	/** Selection ring + NodeSelection on click. Default true */
	selectable?: boolean;
	/** Participates in gutter-handle drag reordering. Default true */
	draggable?: boolean;
	/** Shows a delete affordance. Default true */
	deletable?: boolean;
	resize?: ResizeOptions<Attrs>;
	/** Bottom handle that crops the media's height (aspect-ratio + cover) */
	crop?: CropOptions<Attrs>;
}

/** Declarative settings rendered by SettingsPopover with form components. */
export interface SettingsField<Attrs = Record<string, unknown>> {
	attr: keyof Attrs & string;
	label: string;
	control: 'text' | 'textarea' | 'select' | 'toggle' | 'range' | 'segmented';
	options?: { value: unknown; label: string }[];
	min?: number;
	max?: number;
	step?: number;
	/** Conditional visibility based on the current attrs */
	when?: (attrs: Attrs) => boolean;
}

/** Props passed to a block's Svelte node-view component. */
export interface BlockProps<Attrs = Record<string, unknown>> {
	/** Reactive — mutated in place when the node updates */
	attrs: Attrs;
	selected: boolean;
	editable: boolean;
	editor: EditorLike;
	/** Current position of the node in the document */
	pos: () => number | undefined;
	/** Dispatches a transaction updating this node's attrs */
	update_attrs: (patch: Partial<Attrs>) => void;
	delete_node: () => void;
	open_settings: () => void;
	/**
	 * Attachment marking an element as the editable content hole
	 * (ProseMirror's contentDOM). Only for non-atom blocks:
	 * `<div {@attach content}>`
	 */
	content: (el: HTMLElement) => void;
	/**
	 * Reactive per-node-view UI state shared with the block's chrome actions
	 * (never persisted in the document). A component can store view modes
	 * here (`ui.managing`) or register handlers for chrome actions to call
	 * (`ui.add_images = () => …`).
	 */
	ui: Record<string, unknown>;
}

/** Context passed to a block's chrome actions (hover-bubble buttons). */
export type BlockActionContext<Attrs = Record<string, unknown>> = Pick<
	BlockProps<Attrs>,
	'attrs' | 'editor' | 'pos' | 'update_attrs' | 'ui'
>;

/**
 * An extra icon button in the block's hover chrome (next to the settings
 * gear and delete button). `run` executes on pointerdown so the editor
 * never loses focus.
 */
export interface BlockChromeAction<Attrs = Record<string, unknown>> {
	name: string;
	/** Tooltip / accessible label */
	label: string;
	/** Inline SVG string */
	icon: string;
	/** Hide the action when this returns false (e.g. no uploader configured) */
	when?: (ctx: BlockActionContext<Attrs>) => boolean;
	/** Render the button in its active state (toggles like a manage mode) */
	is_active?: (ctx: BlockActionContext<Attrs>) => boolean;
	run: (ctx: BlockActionContext<Attrs>) => void;
}

export type SettingsProps<Attrs = Record<string, unknown>> = Pick<
	BlockProps<Attrs>,
	'attrs' | 'editor' | 'update_attrs'
>;

/** Server-safe renderer context (see `@delightstack/editor/render`). */
export interface RenderContext {
	render: (nodes: JSONContent[] | undefined) => string;
	render_text: (nodes: JSONContent[] | undefined) => string;
	esc: (value: unknown) => string;
	image_url: (id: string, variant?: string) => string;
	class_prefix: string;
	/** Text column width in px, used for responsive `sizes`. Default 736 */
	column_px: number;
}

export type BlockRenderer = (node: JSONContent, ctx: RenderContext) => string;
export type MarkRenderer = (
	mark: { type: string; attrs?: Record<string, unknown> },
	inner: string,
	ctx: RenderContext,
) => string;

/** The isomorphic (worker-safe) half of a block: name + ProseMirror schema. */
export interface BlockSchemaSpec {
	/** Node name, e.g. 'image', 'pricing_table' */
	name: string;
	/**
	 * Raw ProseMirror NodeSpec. Keep it plain data (attrs defaults,
	 * content/group strings, toDOM/parseDOM) so it can be imported in a
	 * Worker for server-side step application.
	 */
	schema: NodeSpec;
}

/** Everything needed to register a block in the editor, in one object. */
export interface BlockSpec<
	Attrs extends Record<string, unknown> = Record<string, unknown>,
> extends BlockSchemaSpec {
	/** Svelte node view. Omit to render statically via the schema's toDOM. */
	component?: Component<BlockProps<Attrs>>;
	/**
	 * Tag for the node view's wrapper element (default `div`, or `span` for
	 * inline nodes). Set when the node must render as a specific element,
	 * e.g. `li` for list items.
	 */
	wrapper_tag?: string;
	/** Interactive chrome (ring/drag/resize/settings/delete). Default: enabled when `component` is set. */
	interactive?: InteractiveOptions<Attrs> | false;
	/** Declarative settings fields, or a custom settings component */
	settings?: SettingsField<Attrs>[] | Component<SettingsProps<Attrs>>;
	/** Extra icon buttons in the block's hover chrome (before settings/delete) */
	chrome?: BlockChromeAction<Attrs>[];
	/** Slash/plus/toolbar entries contributed by this block */
	commands?: EditorCommand[];
	keymap?: Record<string, PMCommand>;
	input_rules?: (schema: Schema) => InputRule[];
	plugins?: (ctx: { schema: Schema }) => Plugin[];
	paste?: {
		/** Claim a pasted URL (e.g. youtube.com → embed attrs) */
		match_url?: (url: URL) => Partial<Attrs> | null;
		/** Claim a pasted/dropped file — routes it to the uploader with this block as target */
		match_file?: (file: File) => boolean;
	};
	/** Upload kind used when `paste.match_file` claims a file */
	upload_kind?: UploadKind;
	/** Server-safe HTML renderer used by `renderHTML` and SSR */
	render?: BlockRenderer;
	/** Plaintext extraction used by `renderText`/`getText` */
	render_text?: (node: JSONContent) => string;
}

export type UploadKind = 'image' | 'video' | 'audio' | 'file';

/** Result of an upload. Provide `image` for images, `file` for anything else. */
export interface UploadResult {
	/** Simple case: a single URL (used when `image`/`file` are absent) */
	url?: string;
	/** ImageRecord-compatible shape (see @delightstack/images) */
	image?: UploadedImage;
	file?: { url: string; name: string; size: number; mime: string };
}

export interface UploadedImage {
	id: string;
	width: number;
	height: number;
	aspect_ratio?: number;
	thumbhash?: string | null;
	background_color?: string | null;
	/** Pre-built src/srcset if the app doesn't serve via image_url(id) */
	src?: string;
	srcset?: string;
	variants?: unknown[];
	alt?: string;
	/** Editable caption shown in gallery lightboxes and under images */
	caption?: string;
}

/**
 * App-provided upload backend. The editor never talks to a network itself.
 * Wire `@delightstack/images` (or anything else) by implementing this.
 */
export interface Uploader {
	upload(
		file: File,
		ctx: {
			kind: UploadKind;
			signal: AbortSignal;
			on_progress?: (fraction: number) => void;
		},
	): Promise<UploadResult>;
}

/** An in-flight upload, surfaced reactively as `editor.uploads`. */
export interface UploadState {
	upload_id: string;
	kind: UploadKind;
	file_name: string;
	/** 0..1 */
	progress: number;
	error: string | null;
}

/**
 * Transport seam for collaborative editing (phase 2). V1 only defines the
 * interface so the collab extension can be built without core changes.
 */
export interface EditorTransport {
	open(doc_id: string): Promise<{ doc: JSONContent; version: number }>;
	sendSteps(payload: {
		doc_id: string;
		version: number;
		steps: unknown[];
		client_id: string;
	}): void;
	pull(since: number): void;
	onUpdate(
		cb: (update: { version: number; steps: unknown[]; client_ids: string[] }) => void,
	): () => void;
	onReject(cb: (info: { version: number }) => void): () => void;
	readonly connected: boolean;
}

/**
 * Implemented (with `$state`) by menu components; the generic suggestion
 * plugin routes trigger/typing/keydown events here so all UI state lives in
 * Svelte while the ProseMirror plugin stays dumb.
 */
export interface SuggestionHandler {
	open(ctx: SuggestionContext): void;
	update(ctx: SuggestionContext): void;
	close(): void;
	/** Return true if the key was handled (plugin stops propagation) */
	keydown(event: KeyboardEvent): boolean;
}

export interface SuggestionContext {
	/** Text typed after the trigger char (not including it) */
	query: string;
	/** Doc range covering the trigger char + query */
	range: { from: number; to: number };
	/** Viewport rect of the trigger position, for menu placement */
	rect: DOMRect | null;
	/**
	 * Dismiss the suggestion (same as Escape): the menu closes and won't
	 * reopen until this trigger is deleted. Lets handlers auto-close on
	 * hopeless queries.
	 */
	dismiss: () => void;
}
