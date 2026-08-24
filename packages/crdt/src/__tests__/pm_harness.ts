/**
 * Two bound editors, no DOM.
 *
 * The binding drives a {@link PmHost}, not an `EditorView`, precisely so the
 * interesting questions — does a remote edit produce a *small* transaction,
 * does the caret land on the right character, does undo skip the other peer —
 * can be asked without a browser. An `EditorView` satisfies the same interface,
 * so what is exercised here is the shipped path.
 */

import { DelightError } from '@delightstack/utilities';
import { Schema, type Node as PmNode } from 'prosemirror-model';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { LoroDoc } from '../loro.client.js';
import {
	crdtBindingFromDoc,
	loroPlugins,
	loroSyncKey,
	type LoroPmBinding,
	type PmHost,
} from '../prosemirror/index.js';

/**
 * Enough schema to be interesting: nested blocks, an inline atom, an
 * `inclusive: false` mark, and a `block_id` attr on everything blocky —
 * `@delightstack/editor`'s shape, minus the parts a binding cannot see.
 */
export const TEST_SCHEMA = new Schema({
	nodes: {
		doc: { content: 'block+' },
		paragraph: {
			content: 'inline*',
			group: 'block',
			attrs: { block_id: { default: null } },
		},
		heading: {
			content: 'inline*',
			group: 'block',
			attrs: { level: { default: 1 }, block_id: { default: null } },
		},
		blockquote: {
			content: 'block+',
			group: 'block',
			attrs: { block_id: { default: null } },
		},
		horizontal_rule: { group: 'block', attrs: { block_id: { default: null } } },
		wikilink: {
			group: 'inline',
			inline: true,
			atom: true,
			attrs: { node_id: { default: '' } },
		},
		text: { group: 'inline' },
	},
	marks: {
		bold: {},
		link: { attrs: { href: { default: '' } }, inclusive: false },
	},
});

/** A host that records what it was asked to dispatch. */
export class TestHost implements PmHost {
	state: EditorState;
	readonly dispatched: Transaction[] = [];

	constructor(state: EditorState) {
		this.state = state;
	}

	dispatch(tr: Transaction): void {
		this.dispatched.push(tr);
		this.state = this.state.apply(tr);
	}

	/** The last transaction the binding produced, for asserting on its steps. */
	get last(): Transaction | undefined {
		return this.dispatched[this.dispatched.length - 1];
	}
}

export interface Peer {
	doc: LoroDoc;
	host: TestHost;
	binding: LoroPmBinding;
	detach(): void;
	/** Apply a local edit exactly as the editor would. */
	edit(build: (tr: Transaction) => Transaction | void): void;
	/** Move the caret without changing anything. */
	select(position: number): void;
	get pm_doc(): PmNode;
}

/**
 * Bind an editor to a document.
 *
 * A second peer must import the first peer's state **before** it binds — that
 * is the bootstrap rule the client's gate enforces in the app, and skipping it
 * here would have both peers seed a root container concurrently and lose one.
 */
export function createPeer(doc: LoroDoc = new LoroDoc()): Peer {
	const state = EditorState.create({
		schema: TEST_SCHEMA,
		plugins: loroPlugins({ crdt: crdtBindingFromDoc(doc), merge_interval_ms: 0 }),
	});
	const host = new TestHost(state);
	const sync_state = loroSyncKey.getState(state);
	if (!sync_state) {
		throw new DelightError({
			message: 'The Loro sync plugin is not installed.',
			status: 500,
			code: 'pm_sync_plugin_missing',
		});
	}
	const detach = sync_state.binding.attach(host);

	return {
		doc,
		host,
		binding: sync_state.binding,
		detach,
		edit(build) {
			const tr = host.state.tr;
			const result = build(tr) ?? tr;
			host.dispatch(result);
		},
		select(position) {
			const tr = host.state.tr;
			tr.setSelection(TextSelection.create(tr.doc, position));
			host.dispatch(tr);
		},
		get pm_doc() {
			return host.state.doc;
		},
	};
}

/** Move everything `from` has that `to` does not. */
export function sync(from: LoroDoc, to: LoroDoc): void {
	const blob = from.export({ mode: 'update', from: to.oplogVersion() });
	if (blob.length > 0) to.import(blob);
}

/** Both directions, twice, so a concurrent pair actually converges. */
export function syncBoth(a: LoroDoc, b: LoroDoc): void {
	sync(a, b);
	sync(b, a);
}
