import { describe, expect, it } from 'vitest';
import { ReplaceStep } from 'prosemirror-transform';
import { LoroDoc } from '../loro.client.js';
import {
	LoroPmMapping,
	crdtBindingFromDoc,
	pmDocFromLoro,
	redo,
	restorePmDoc,
	undo,
	writePmDocToLoro,
} from '../prosemirror/index.js';
import { TEST_SCHEMA, createPeer, sync, syncBoth } from './pm_harness.js';

const S = TEST_SCHEMA;

function richDoc() {
	return S.node('doc', null, [
		S.node('heading', { level: 2, block_id: 'h1' }, [S.text('Title')]),
		S.node('paragraph', { block_id: 'p1' }, [
			S.text('plain '),
			S.text('bold', [S.mark('bold')]),
			S.text(' then '),
			S.node('wikilink', { node_id: 'n1' }),
			S.text(' tail', [S.mark('link', { href: 'https://example.com' })]),
		]),
		S.node('blockquote', { block_id: 'q1' }, [
			S.node('paragraph', { block_id: 'p2' }, [S.text('quoted')]),
		]),
		S.node('horizontal_rule', { block_id: 'r1' }),
	]);
}

describe('pm_doc ⇄ Loro round trip', () => {
	it('survives nesting, marks, inline atoms and attrs', () => {
		const doc = new LoroDoc();
		const pm_doc = richDoc();
		writePmDocToLoro(doc, pm_doc);
		doc.commit();

		expect(pmDocFromLoro(S, doc).toJSON()).toEqual(pm_doc.toJSON());
	});

	it('writing the same document twice produces no operations', () => {
		const doc = new LoroDoc();
		const mapping = new LoroPmMapping();
		const pm_doc = richDoc();
		writePmDocToLoro(doc, pm_doc, mapping);
		doc.commit();

		const before = doc.opCount();
		writePmDocToLoro(doc, pm_doc, mapping);
		doc.commit();
		// An empty update blob is still 22 bytes of header, so count operations.
		expect(doc.opCount()).toBe(before);
	});

	it('an untouched Loro document projects to an empty pm_doc', () => {
		expect(pmDocFromLoro(S, new LoroDoc()).toJSON()).toEqual(
			S.topNodeType.createAndFill()?.toJSON(),
		);
	});

	it('editing one word rewrites only that block, character by character', () => {
		const doc = new LoroDoc();
		const mapping = new LoroPmMapping();
		writePmDocToLoro(doc, richDoc(), mapping);
		doc.commit();

		const edited = richDoc();
		const next = edited.type.schema.nodes.paragraph.create(
			{ block_id: 'p2' },
			S.text('quoted!'),
		);
		const pm_doc = S.node('doc', null, [
			edited.child(0),
			edited.child(1),
			S.node('blockquote', { block_id: 'q1' }, [next]),
			edited.child(3),
		]);

		const before = doc.opCount();
		writePmDocToLoro(doc, pm_doc, mapping);
		doc.commit();

		// One character appended is one operation. More would mean the binding
		// replaced a container it should have reconciled — which would also have
		// destroyed any concurrent edit inside it.
		expect(doc.opCount()).toBe(before + 1);
		expect(pmDocFromLoro(S, doc).toJSON()).toEqual(pm_doc.toJSON());
	});
});

describe('remote changes', () => {
	it('arrive as a minimal transaction and keep the caret on its character', () => {
		const a = createPeer();
		a.edit((tr) => tr.insertText('AAAAAAAAAA', 1));
		a.select(11);
		expect(a.host.state.selection.anchor).toBe(11);

		const b_doc = new LoroDoc();
		sync(a.doc, b_doc);
		const b = createPeer(b_doc);
		b.edit((tr) => tr.insertText('BBBBB', 1));

		const dispatched_before = a.host.dispatched.length;
		sync(b.doc, a.doc);

		expect(a.pm_doc.textContent).toBe('BBBBBAAAAAAAAAA');
		// The spike's binding scored 11 here — the caret kept its absolute
		// position while the text moved out from under it.
		expect(a.host.state.selection.anchor).toBe(16);

		expect(a.host.dispatched.length).toBe(dispatched_before + 1);
		const steps = a.host.last?.steps ?? [];
		expect(steps.length).toBe(1);
		const step = steps[0];
		expect(step).toBeInstanceOf(ReplaceStep);
		// Not a whole-document replace: the range is the five inserted
		// characters' insertion point, not `0 … doc.content.size`.
		expect({ from: (step as ReplaceStep).from, to: (step as ReplaceStep).to }).toEqual({
			from: 1,
			to: 1,
		});
	});

	it('a remote edit after the caret leaves it alone', () => {
		const a = createPeer();
		a.edit((tr) => tr.insertText('AAAAA', 1));
		a.select(3);

		const b_doc = new LoroDoc();
		sync(a.doc, b_doc);
		const b = createPeer(b_doc);
		b.edit((tr) => tr.insertText('ZZ', 6));
		sync(b.doc, a.doc);

		expect(a.pm_doc.textContent).toBe('AAAAAZZ');
		expect(a.host.state.selection.anchor).toBe(3);
	});

	it('carries marks, and applying one does not rewrite the text', () => {
		const a = createPeer();
		a.edit((tr) => tr.insertText('make this bold', 1));

		const b_doc = new LoroDoc();
		sync(a.doc, b_doc);
		const b = createPeer(b_doc);
		const ops_before = b.doc.opCount();
		b.edit((tr) => tr.addMark(11, 15, S.mark('bold')));
		// A style operation (Loro records a mark as its two anchors), not a
		// re-insert of the four characters.
		expect(b.doc.opCount()).toBe(ops_before + 2);

		sync(b.doc, a.doc);
		expect(a.pm_doc.textContent).toBe('make this bold');
		const marked = a.pm_doc.child(0).lastChild;
		expect(marked?.text).toBe('bold');
		expect(marked?.marks.map((mark) => mark.type.name)).toEqual(['bold']);

		sync(a.doc, b.doc);
		b.edit((tr) => tr.removeMark(11, 15, S.marks.bold));
		sync(b.doc, a.doc);
		expect(a.pm_doc.child(0).childCount).toBe(1);
		expect(a.pm_doc.child(0).firstChild?.marks).toEqual([]);
	});

	it('a remote insert exactly at the caret pushes the caret forward', () => {
		const a = createPeer();
		a.edit((tr) => tr.insertText('abcdef', 1));
		a.select(4);

		const b_doc = new LoroDoc();
		sync(a.doc, b_doc);
		const b = createPeer(b_doc);
		b.edit((tr) => tr.insertText('XY', 4));
		sync(b.doc, a.doc);

		expect(a.pm_doc.textContent).toBe('abcXYdef');
		expect(a.host.state.selection.anchor).toBe(6);
	});

	it('keeps the caret on its character when a peer re-marks the range around it', () => {
		const a = createPeer();
		a.edit((tr) => tr.insertText('make this bold', 1));
		a.select(13); // between the "b" and the "o" of "bold"

		const b_doc = new LoroDoc();
		sync(a.doc, b_doc);
		const b = createPeer(b_doc);
		b.edit((tr) => tr.addMark(11, 15, S.mark('bold')));
		sync(b.doc, a.doc);

		// The mark splits one text node into two, so the diff replaces the
		// paragraph's content and ProseMirror's own step mapping collapses the
		// caret to the end of the replaced range (15). Only the Loro cursor knows
		// which character the caret was actually on.
		expect(a.host.state.selection.anchor).toBe(13);
	});

	it('leaves block ids and untouched blocks alone', () => {
		const a = createPeer();
		a.edit((tr) =>
			tr.replaceWith(0, tr.doc.content.size, [
				S.node('paragraph', { block_id: 'one' }, [S.text('first')]),
				S.node('paragraph', { block_id: 'two' }, [S.text('second')]),
				S.node('paragraph', { block_id: 'three' }, [S.text('third')]),
			]),
		);

		const b_doc = new LoroDoc();
		sync(a.doc, b_doc);
		const b = createPeer(b_doc);
		const middle_start = b.pm_doc.child(0).nodeSize + 1;
		b.edit((tr) => tr.insertText('!', middle_start + 6));

		const first_before = a.pm_doc.child(0);
		const third_before = a.pm_doc.child(2);
		sync(b.doc, a.doc);

		expect(a.pm_doc.child(1).textContent).toBe('second!');
		expect(a.pm_doc.children.map((node) => node.attrs.block_id)).toEqual([
			'one',
			'two',
			'three',
		]);
		// Reference equality, not just deep equality: the projection reused the
		// cached nodes, which is what keeps the ProseMirror diff cheap and the
		// node views alive.
		expect(a.pm_doc.child(0)).toBe(first_before);
		expect(a.pm_doc.child(2)).toBe(third_before);
	});
});

describe('convergence', () => {
	it('two bound editors typing in different blocks converge', () => {
		const a = createPeer();
		a.edit((tr) =>
			tr.replaceWith(0, tr.doc.content.size, [
				S.node('paragraph', { block_id: 'one' }, [S.text('alpha')]),
				S.node('paragraph', { block_id: 'two' }, [S.text('beta')]),
			]),
		);

		const b_doc = new LoroDoc();
		sync(a.doc, b_doc);
		const b = createPeer(b_doc);

		a.edit((tr) => tr.insertText(' one', 6));
		b.edit((tr) => tr.insertText(' two', b.pm_doc.child(0).nodeSize + 5));

		syncBoth(a.doc, b.doc);

		expect(a.pm_doc.toJSON()).toEqual(b.pm_doc.toJSON());
		expect(a.pm_doc.child(0).textContent).toBe('alpha one');
		expect(a.pm_doc.child(1).textContent).toBe('beta two');
	});

	it('two bound editors typing in the same paragraph converge', () => {
		const a = createPeer();
		a.edit((tr) => tr.insertText('hello', 1));

		const b_doc = new LoroDoc();
		sync(a.doc, b_doc);
		const b = createPeer(b_doc);

		a.edit((tr) => tr.insertText('A', 1));
		b.edit((tr) => tr.insertText('B', 6));

		syncBoth(a.doc, b.doc);

		expect(a.pm_doc.toJSON()).toEqual(b.pm_doc.toJSON());
		expect(a.pm_doc.textContent).toContain('hello');
		expect(a.pm_doc.textContent.length).toBe(7);
	});
});

describe('undo', () => {
	it('undoes this peer and never the other one', () => {
		const a = createPeer();
		a.edit((tr) => tr.insertText('alpha', 1));

		const b_doc = new LoroDoc();
		sync(a.doc, b_doc);
		const b = createPeer(b_doc);
		// Both kinds of remote edit at once: a new block of its own, and text
		// inside the very paragraph A is about to undo.
		b.edit((tr) =>
			tr
				.insertText('!', 6)
				.insert(
					tr.doc.content.size,
					S.node('paragraph', { block_id: 'from_b' }, [S.text('beta')]),
				),
		);
		syncBoth(a.doc, b.doc);
		expect(a.pm_doc.textContent).toBe('alpha!beta');

		expect(undo(a.host.state, (tr) => a.host.dispatch(tr))).toBe(true);

		// A's five characters go; the other peer's `!` in the same container and
		// its paragraph both stay. This is the bug `06-editor.md` names — a
		// ProseMirror history stack would have taken all three.
		expect(a.pm_doc.child(0).textContent).toBe('!');
		expect(a.pm_doc.childCount).toBe(2);
		expect(a.pm_doc.child(1).textContent).toBe('beta');

		expect(redo(a.host.state, (tr) => a.host.dispatch(tr))).toBe(true);
		expect(a.pm_doc.child(0).textContent).toBe('alpha!');
	});

	it("keeps a peer's text when undoing the edit that created the container", () => {
		// The regression. A types into a brand new, empty paragraph, so the local
		// edit is what creates the paragraph's text container. B types into that
		// same container. If the container's creation is inside A's undo step,
		// undoing it deletes the container — and B's text goes with it, because a
		// deleted container leaves nothing to rebase onto.
		const a = createPeer();
		a.edit((tr) => tr.insertText('local', 1));

		const b_doc = new LoroDoc();
		sync(a.doc, b_doc);
		const b = createPeer(b_doc);
		b.edit((tr) => tr.insertText('R', 6));
		syncBoth(a.doc, b.doc);
		expect(a.pm_doc.textContent).toBe('localR');

		expect(undo(a.host.state, (tr) => a.host.dispatch(tr))).toBe(true);

		expect(a.pm_doc.textContent).toBe('R');
		syncBoth(a.doc, b.doc);
		expect(b.pm_doc.textContent).toBe('R');

		// And there is nothing left on the stack that could take it on a second
		// press: the container's creation is not an edit anybody made, so it is
		// never pushed at all.
		expect(undo(a.host.state, (tr) => a.host.dispatch(tr))).toBe(false);
		expect(a.pm_doc.textContent).toBe('R');
	});

	it('undoes same-paragraph typing without touching the other peer', () => {
		const a = createPeer();
		a.edit((tr) => tr.insertText('shared ', 1));

		const b_doc = new LoroDoc();
		sync(a.doc, b_doc);
		const b = createPeer(b_doc);
		syncBoth(a.doc, b.doc);

		a.edit((tr) => tr.insertText('mine', 8));
		syncBoth(a.doc, b.doc);
		b.edit((tr) => tr.insertText('theirs', b.pm_doc.content.size - 1));
		syncBoth(a.doc, b.doc);
		expect(a.pm_doc.textContent).toBe('shared minetheirs');

		expect(undo(a.host.state, (tr) => a.host.dispatch(tr))).toBe(true);
		expect(a.pm_doc.textContent).toBe('shared theirs');
		syncBoth(a.doc, b.doc);
		expect(b.pm_doc.textContent).toBe('shared theirs');
	});

	it('reports nothing to undo on a freshly opened document', () => {
		const a = createPeer();
		expect(undo(a.host.state, () => {})).toBe(false);
	});
});

describe('restore', () => {
	it('makes the document equal an old version by writing forward', () => {
		const a = createPeer();
		a.edit((tr) => tr.insertText('original', 1));
		const original = a.pm_doc;
		const original_frontier = a.doc.frontiers();

		a.edit((tr) => tr.insertText(' and more', 9));
		expect(a.pm_doc.textContent).toBe('original and more');

		restorePmDoc(a.binding, original);

		expect(a.pm_doc.toJSON()).toEqual(original.toJSON());
		// Append-only: the restore is a new version, not a rewind.
		expect(a.doc.frontiers()).not.toEqual(original_frontier);
	});

	it('works against a bare document with no editor bound', () => {
		const doc = new LoroDoc();
		const crdt = crdtBindingFromDoc(doc);
		restorePmDoc(crdt, richDoc());
		expect(pmDocFromLoro(S, doc).toJSON()).toEqual(richDoc().toJSON());
	});
});
