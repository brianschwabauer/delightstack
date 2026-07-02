import type { Editor } from '../editor.svelte.js';

/**
 * The reactive props carrier shared between a ProseMirror NodeView and the
 * Svelte component it mounts. The bridge mutates `attrs`/`selected` in place
 * on node updates; components dispatch changes back with `update_attrs`
 * (props in, transactions out — never DOM/CSS back-channels).
 */
export class BlockViewProps<
	Attrs extends Record<string, unknown> = Record<string, unknown>,
> {
	attrs = $state<Attrs>({} as Attrs);
	selected = $state(false);
	settings_open = $state(false);

	readonly editor: Editor;
	readonly pos: () => number | undefined;
	readonly update_attrs: (patch: Partial<Attrs>) => void;
	readonly delete_node: () => void;
	readonly open_settings: () => void;
	readonly content: (el: HTMLElement) => void | (() => void);

	get editable(): boolean {
		return this.editor.editable;
	}

	constructor(options: {
		editor: Editor;
		attrs: Attrs;
		pos: () => number | undefined;
		content: (el: HTMLElement) => void | (() => void);
	}) {
		this.editor = options.editor;
		this.attrs = { ...options.attrs };
		this.pos = options.pos;
		this.content = options.content;
		this.update_attrs = (patch) => {
			const pos = this.pos();
			if (pos === undefined) return;
			this.editor.updateNodeAttrs(pos, patch);
		};
		this.delete_node = () => {
			const pos = this.pos();
			if (pos === undefined) return;
			this.editor.deleteNode(pos);
		};
		this.open_settings = () => {
			this.settings_open = true;
		};
	}

	/** @internal bridge-side: sync attrs from a new node (handles removed keys) */
	syncAttrs(attrs: Attrs): void {
		for (const key of Object.keys(this.attrs)) {
			if (!(key in attrs)) delete this.attrs[key as keyof Attrs];
		}
		Object.assign(this.attrs, attrs);
	}
}
