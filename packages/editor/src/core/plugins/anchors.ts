import type { Node as PMNode } from 'prosemirror-model';

/**
 * Content anchoring — finding a remembered piece of text in the document it was
 * remembered from, again, after the document has moved on.
 *
 * Two plugins need this and they are not variations on one feature. ED-08's
 * tracked changes anchor a *proposed edit* an agent made against a markdown
 * projection from another machine; ED-06's annotations anchor a *highlight* a
 * reader dragged over a sentence weeks ago. What they share is the situation:
 * whoever recorded the anchor was not holding this editor's document and could
 * not have taken a position in it, so there is no position to map forward —
 * only text to find again.
 *
 * ## Why re-finding rather than mapping
 *
 * A mapped position is the obvious implementation and it answers the wrong
 * question. Map a range through six months of edits and it always resolves to
 * *something*: a plausible offset in the middle of a sentence nobody wrote when
 * the anchor was made. Re-finding either finds the text or says it cannot,
 * which is the honest pair of answers — and the second one is a fact both hosts
 * want to show a user rather than paper over.
 *
 * Re-finding is also the behaviour the features want. Edit around an anchor and
 * it follows the sentence it was about, because the sentence is still there.
 * Delete the sentence and the anchor goes stale, which is a thing to say out
 * loud rather than a range quietly collapsing to a caret.
 *
 * ## What the score is for
 *
 * The recorded `block_id` is a hint, not an address — a block that was split
 * since is a *renumbered* block, not a deleted one — so a hit in the recorded
 * block outranks every hit elsewhere by a margin ({@link HOME_BONUS}) that the
 * context score can never make up, and finding one there ends the search. Only
 * when the recorded block has nothing does the rest of the document get looked
 * at, which is what keeps a keystroke from costing
 * `O(anchors × document)`.
 *
 * `prefix` and `suffix` break ties between identical occurrences, and they do
 * it *partially* — a nearby edit degrades a match instead of erasing it. When
 * they cannot break a tie the answer is `ambiguous` rather than document order,
 * because document order is not a tie-break: it is the first copy of a repeated
 * phrase deciding which of the user's sentences gets marked up.
 */

/**
 * Where a piece of text was, said in a way that survives the document changing
 * under it.
 *
 * Every field is optional except {@link TextAnchor.text}, and even that may be
 * empty — an anchor with no text of its own is a *point*, which is what a pure
 * insertion is, and it is located by its context instead.
 */
export interface TextAnchor {
	/** Block the anchor was recorded against, if the host recorded one. A hint. */
	block_id?: string;
	/** The exact text to find. Empty for a point anchor. */
	text: string;
	/** Up to a line or so of text immediately before {@link TextAnchor.text}. */
	prefix?: string;
	/** Up to a line or so of text immediately after it. */
	suffix?: string;
}

/** Why an anchor has no place in the document. */
export type AnchorStaleReason =
	/** The text it named is not in the document any more. */
	| 'missing'
	/**
	 * The text is there more than once and nothing distinguishes the copies.
	 * Drawing it would mark up *a* match rather than *the* match, so it does not
	 * get drawn.
	 */
	| 'ambiguous';

/** An anchor the current document still has a place for. */
export interface ResolvedAnchor<T> {
	item: T;
	/** Start of the range. Equal to `to` for a point anchor. */
	from: number;
	/** End of the range. */
	to: number;
}

/** An anchor that went stale, and which of the two ways it went. */
export interface StaleAnchor<T> {
	item: T;
	reason: AnchorStaleReason;
}

/** What {@link resolveAnchors} answers with. */
export interface AnchorResolution<T> {
	resolved: ResolvedAnchor<T>[];
	stale: StaleAnchor<T>[];
}

interface BlockText {
	block_id: string | null;
	/** Document position of offset 0 of `text`. */
	base: number;
	text: string;
	/**
	 * The block itself.
	 *
	 * Carried so a re-resolve can tell which blocks actually moved: ProseMirror
	 * nodes are immutable, so a block that survived a transaction is the *same
	 * object*, and identity is a whole-document diff that costs nothing. See
	 * {@link AnchorCache}.
	 */
	node: PMNode;
}

/**
 * Text of one textblock, with every non-text inline node standing in as its own
 * width in spaces. The padding is what keeps `base + index` a real document
 * position — `textContent` would silently close the gap an inline atom leaves
 * and every match after it would resolve a character or two to the left.
 *
 * Cached per node, which is safe for the reason ProseMirror documents are cheap
 * to hold at all: nodes are immutable, so a block that survived a transaction is
 * the *same object*, and typing in one paragraph leaves the other few hundred
 * untouched. Without this every keystroke rebuilt the text of every block in the
 * document to search the one that changed. A `WeakMap` so an old document's
 * blocks go when the document does.
 */
const block_text_cache = new WeakMap<PMNode, string>();

function blockText(node: PMNode): string {
	const cached = block_text_cache.get(node);
	if (cached !== undefined) return cached;
	let text = '';
	node.forEach((child) => {
		if (child.isText) text += child.text ?? '';
		else text += ' '.repeat(child.nodeSize);
	});
	block_text_cache.set(node, text);
	return text;
}

function blocksOf(doc: PMNode): BlockText[] {
	const blocks: BlockText[] = [];
	doc.descendants((node, pos) => {
		if (!node.isTextblock) return true;
		const id = node.attrs.block_id;
		blocks.push({
			block_id: typeof id === 'string' && id ? id : null,
			base: pos + 1,
			text: blockText(node),
			node,
		});
		return false;
	});
	return blocks;
}

/** One occurrence: where it starts, and how long the text that matched is. */
interface Occurrence {
	index: number;
	/** Length **in the document**, which is the needle's only after a raw hit. */
	length: number;
}

/**
 * The spellings of `needle` worth trying, in order.
 *
 * An anchor's text arrives as a string produced somewhere else — over MCP, out
 * of a JSON body, out of a markdown projection that went through a different
 * runtime, out of a `Selection.toString()` in another browser — and `'café'` has
 * two encodings that are the same text and not the same string. `indexOf`
 * compares code units, so one composed `é` never finds a decomposed one and the
 * anchor goes stale over a fact about Unicode rather than a fact about the
 * document.
 *
 * Only the *needle* is renormalized, never the block text: `base + index` is a
 * real document position, and NFC/NFD change a string's length, so normalizing
 * the haystack would move every match after the first accent by a character or
 * two. Trying both forms of the needle against the untouched haystack covers
 * both directions — an NFD anchor against an NFC document and the reverse — and
 * leaves the position arithmetic alone.
 */
function spellings(needle: string): string[] {
	const forms = [needle];
	for (const form of ['NFC', 'NFD'] as const) {
		const variant = needle.normalize(form);
		if (!forms.includes(variant)) forms.push(variant);
	}
	return forms;
}

/**
 * Every occurrence of `needle` in `haystack`, under the first of its spellings
 * that occurs at all.
 */
function occurrences(haystack: string, needle: string): Occurrence[] {
	if (!needle) return [];
	for (const spelling of spellings(needle)) {
		const found: Occurrence[] = [];
		for (
			let index = haystack.indexOf(spelling);
			index !== -1;
			index = haystack.indexOf(spelling, index + 1)
		) {
			found.push({ index, length: spelling.length });
		}
		if (found.length) return found;
	}
	return [];
}

/**
 * How well an occurrence at `index` agrees with the context the anchor was
 * recorded with. Prefix and suffix are worth a point each, and a partial match
 * of either — the tail of the prefix, the head of the suffix — is worth a
 * fraction, so that a nearby edit degrades the score instead of erasing it.
 */
function contextScore(
	text: string,
	index: number,
	length: number,
	anchor: TextAnchor,
): number {
	let score = 0;
	if (anchor.prefix) {
		const before = text.slice(0, index);
		// Same Unicode caution as `occurrences`: the context arrives from the
		// same place the text did and can be spelled the other way.
		const prefix =
			spellings(anchor.prefix).find((form) => before.endsWith(form)) ?? anchor.prefix;
		if (before.endsWith(prefix)) score += 1;
		else {
			// Longest suffix of `before` that is also a suffix of `prefix`.
			let overlap = 0;
			const max = Math.min(before.length, prefix.length);
			for (let size = max; size > 0; size--) {
				if (before.endsWith(prefix.slice(prefix.length - size))) {
					overlap = size;
					break;
				}
			}
			score += overlap / prefix.length;
		}
	}
	if (anchor.suffix) {
		const after = text.slice(index + length);
		const suffix =
			spellings(anchor.suffix).find((form) => after.startsWith(form)) ?? anchor.suffix;
		if (after.startsWith(suffix)) score += 1;
		else {
			let overlap = 0;
			const max = Math.min(after.length, suffix.length);
			for (let size = max; size > 0; size--) {
				if (after.startsWith(suffix.slice(0, size))) {
					overlap = size;
					break;
				}
			}
			score += overlap / suffix.length;
		}
	}
	return score;
}

/**
 * What a hit in the block the host recorded is worth. Larger than any context
 * score (prefix and suffix are 1 each) so that the recorded block always wins —
 * which is what lets the search stop as soon as it finds something there.
 */
export const HOME_BONUS = 10;

/**
 * What a caller keeps between resolves so a stale anchor stops costing a
 * whole-document scan on every keystroke.
 *
 * **The problem is specific and it is not the resolver being slow.** An anchor
 * that *resolves* is cheap: the recorded block answers and the search stops. An
 * anchor that has gone **stale** is the opposite — it finds nothing in its
 * recorded block, so it falls through to scanning every other block in the
 * document, and it does that again on the next keystroke, and the one after
 * that. Twenty stale anchors over a long clip measured 3.7ms per keystroke, all
 * of it re-deciding a fact that had not moved.
 *
 * **The observation that fixes it: a missing anchor can only come back in a
 * block that changed.** If an unchanged block contained the text, the anchor
 * would not have been missing. So on a re-resolve, an anchor previously found
 * missing is scanned against the blocks whose nodes are *new* — which after a
 * keystroke is one block, not four hundred — and if it is still not there, it is
 * still missing, without the document being walked.
 *
 * Two things it deliberately does not cache, because caching them would be
 * wrong rather than merely unhelpful:
 *
 * - **`ambiguous`.** Ambiguity is a fact about the whole document: deleting one
 *   of two identical paragraphs elsewhere resolves it. An ambiguous anchor takes
 *   the full path every time.
 * - **Anything that resolved.** A resolved anchor's range moves with every edit
 *   before it, so there is nothing about it that survives a change — and it was
 *   never the expensive case.
 *
 * Correctness rests on the cache being invalidated by *content*, through node
 * identity, rather than by a version counter a caller could forget to bump: a
 * block that survived a transaction is the same immutable object, and one that
 * did not is a different one. A caller that passes a cache built against a
 * different document simply sees every block as new and takes the slow path.
 *
 * Create one with {@link createAnchorCache} and hand the same one to every
 * resolve for one editor. It is optional everywhere; omitting it is the
 * behaviour this function always had.
 */
export interface AnchorCache {
	/** The blocks the last resolve saw, by node identity. */
	seen: WeakSet<PMNode>;
	/** Whether anything has been seen yet — a `WeakSet` cannot answer that. */
	primed: boolean;
	/** Anchor key → the verdict, for anchors that were `missing`. */
	missing: Map<string, true>;
}

/** A fresh cache. One per editor; hand it to every resolve. */
export function createAnchorCache(): AnchorCache {
	return { seen: new WeakSet(), primed: false, missing: new Map() };
}

/**
 * What makes two anchors the same anchor, for caching.
 *
 * Every field the search reads, joined with a separator that cannot occur in a
 * `block_id`. Not the caller's item id: two rows with the same id and different
 * text are a row that was edited, and its cached verdict is about the old text.
 */
function anchorKey(anchor: TextAnchor): string {
	return `${anchor.block_id ?? ''}\u0000${anchor.text}\u0000${anchor.prefix ?? ''}\u0000${anchor.suffix ?? ''}`;
}

/**
 * Resolve a list of anchored items against the current document, by content.
 *
 * `anchorOf` is how a caller's own row shape becomes a {@link TextAnchor}
 * without this file knowing anything about suggestions, annotations, or
 * whatever the third one turns out to be. Results come back in document order,
 * carrying the caller's item untouched.
 */
export function resolveAnchors<T>(
	doc: PMNode,
	items: readonly T[],
	anchorOf: (item: T) => TextAnchor,
	cache?: AnchorCache,
): AnchorResolution<T> {
	const blocks = blocksOf(doc);
	const by_id = new Map<string, BlockText>();
	for (const block of blocks) if (block.block_id) by_id.set(block.block_id, block);

	/*
	 * The blocks this resolve has not seen before.
	 *
	 * On the first resolve with a cache that is every block, so nothing is
	 * skipped and the cache is simply filled. On the next keystroke it is the one
	 * paragraph that was typed in — which is the whole saving.
	 */
	const fresh_blocks: BlockText[] = [];
	if (cache) {
		for (const block of blocks) {
			if (!cache.primed || !cache.seen.has(block.node)) fresh_blocks.push(block);
		}
	}
	const next_missing = cache ? new Map<string, true>() : undefined;

	const resolved: ResolvedAnchor<T>[] = [];
	const stale: StaleAnchor<T>[] = [];

	for (const item of items) {
		const anchor = anchorOf(item);
		const key = cache ? anchorKey(anchor) : '';
		if (cache?.primed && cache.missing.has(key)) {
			// It was missing, so no unchanged block holds it — only a block that
			// changed could. Scanning those is the whole cost, and after a keystroke
			// there is one of them.
			const could_be_back = fresh_blocks.some((block) =>
				anchor.text
					? occurrences(block.text, anchor.text).length > 0
					: Boolean(anchor.prefix || anchor.suffix || anchor.block_id),
			);
			if (!could_be_back) {
				stale.push({ item, reason: 'missing' });
				next_missing?.set(key, true);
				continue;
			}
			// It might be back. Fall through to the full scan rather than trying to
			// decide from the changed blocks alone — unstaling is rare, and getting
			// the score and the ambiguity right there is the slow path's job.
		}
		const recorded = anchor.block_id ? by_id.get(anchor.block_id) : undefined;
		let best: { from: number; to: number; score: number } | null = null;
		/*
		 * Whether something else in the document scored exactly as well at a
		 * different place.
		 *
		 * The reason this is tracked rather than broken by "first one wins" is
		 * that first-one-wins is not a tie-break, it is document order deciding
		 * which of the user's sentences gets marked up. An anchor recorded over
		 * "He walked toward" in a chapter containing that phrase three times says
		 * *what* it was about and not *which*, and the honest answer is to say so
		 * — the same answer the missing case already gets, for the same reason.
		 *
		 * A tie only survives when the context cannot break it. `prefix` and
		 * `suffix` are worth a point each, so an anchor recorded with either one
		 * separates its copies as soon as their surroundings differ, and only
		 * genuinely indistinguishable occurrences reach here.
		 */
		let ambiguous = false;

		const offer = (from: number, to: number, score: number): void => {
			if (!best || score > best.score) {
				best = { from, to, score };
				ambiguous = false;
				return;
			}
			if (score === best.score && (from !== best.from || to !== best.to)) {
				ambiguous = true;
			}
		};

		const scan = (block: BlockText, home_bonus: number): void => {
			if (anchor.text) {
				for (const hit of occurrences(block.text, anchor.text)) {
					const score =
						home_bonus + contextScore(block.text, hit.index, hit.length, anchor);
					offer(block.base + hit.index, block.base + hit.index + hit.length, score);
				}
				return;
			}
			// A point anchor has no text of its own to find, so its context is the
			// anchor: after the prefix if there is one, before the suffix if there
			// is not. A point at the very *start* of a paragraph has an empty
			// prefix and nothing else — it is the suffix that says where it goes,
			// and treating that as unanchored sends a perfectly locatable point to
			// the stale list.
			if (anchor.prefix) {
				for (const hit of occurrences(block.text, anchor.prefix)) {
					const at = hit.index + hit.length;
					const score = home_bonus + contextScore(block.text, at, 0, anchor);
					offer(block.base + at, block.base + at, score);
				}
			} else if (anchor.suffix) {
				for (const hit of occurrences(block.text, anchor.suffix)) {
					const score = home_bonus + contextScore(block.text, hit.index, 0, anchor);
					offer(block.base + hit.index, block.base + hit.index, score);
				}
			} else if (home_bonus) {
				// No text and no context at all, but the host named a block. The
				// front of that block is the only honest reading of "here", and it
				// beats calling an anchor we can place stale.
				best ??= { from: block.base, to: block.base, score: home_bonus };
			}
		};

		// The recorded block first — the host told us where this was, and a hit
		// there outranks a better-scoring hit elsewhere by more than the context
		// score can ever make up. Which is also why finding one there ends the
		// search: scanning the rest of the document could not change the answer,
		// and doing it anyway made every keystroke O(anchors × document).
		if (recorded) scan(recorded, HOME_BONUS);
		if (!best) {
			for (const block of blocks) {
				if (block === recorded) continue;
				scan(block, 0);
			}
		}

		if (!best) {
			stale.push({ item, reason: 'missing' });
			next_missing?.set(key, true);
			continue;
		}
		if (ambiguous) {
			// Deliberately not cached: ambiguity is a fact about the whole document,
			// and deleting one of two identical paragraphs elsewhere resolves it.
			stale.push({ item, reason: 'ambiguous' });
			continue;
		}
		const found: { from: number; to: number; score: number } = best;
		resolved.push({ item, from: found.from, to: found.to });
	}

	if (cache && next_missing) {
		for (const block of blocks) cache.seen.add(block.node);
		cache.primed = true;
		cache.missing = next_missing;
	}

	resolved.sort((a, b) => a.from - b.from || a.to - b.to);
	return { resolved, stale };
}
