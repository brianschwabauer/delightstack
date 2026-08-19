import { EMPTY_FRONTIER } from './frontier.js';
import type { Checkpoint, EditSession, UpdateMeta } from '../types.js';

/** The gap that ends an edit session. Five minutes, per `04-crdt-and-history.md`. */
export const DEFAULT_SESSION_GAP_MS = 300_000;

/**
 * Group op-log rows into sessions: same actor, gap under `gap_ms`, and no
 * checkpoint between them.
 *
 * Sessions are **derived at read time and never stored**. That is a deliberate
 * design choice rather than a shortcut: the grouping gap is a UI tuning knob,
 * and storing the grouping would turn "make sessions 3 minutes instead of 5"
 * into a data migration over every document that ever existed.
 *
 * The input is metadata only — the caller reads `seq, actor, frontier,
 * byte_size, created_at` with `LENGTH(update_blob)` computed in SQLite — so
 * listing a document's whole history never pulls an update blob into the
 * isolate. That is what makes the history rail cheap enough to open on every
 * document.
 */
export function deriveSessions(
	updates: readonly UpdateMeta[],
	checkpoints: readonly Checkpoint[],
	gap_ms: number = DEFAULT_SESSION_GAP_MS,
): EditSession[] {
	const checkpoint_frontiers = new Set(
		checkpoints.map((checkpoint) => checkpoint.frontier),
	);
	const sessions: EditSession[] = [];
	// The frontier a session starts *from* is the frontier before its first op,
	// so the caller can diff `start_frontier → end_frontier` and see exactly
	// what the session did.
	let previous_frontier = EMPTY_FRONTIER;

	for (const update of updates) {
		const current = sessions[sessions.length - 1];
		const continues =
			current !== undefined &&
			current.actor === update.actor &&
			update.created_at - current.ended_at < gap_ms &&
			// A checkpoint is a deliberate "this is a moment" marker; a session
			// that spanned one would make the marker un-diffable.
			!checkpoint_frontiers.has(current.end_frontier);

		if (continues) {
			current.end_frontier = update.frontier;
			current.ended_at = update.created_at;
			current.op_count += 1;
			current.byte_size += update.byte_size;
		} else {
			sessions.push({
				actor: update.actor,
				start_frontier: previous_frontier,
				end_frontier: update.frontier,
				started_at: update.created_at,
				ended_at: update.created_at,
				op_count: 1,
				byte_size: update.byte_size,
			});
		}
		previous_frontier = update.frontier;
	}

	return sessions;
}
