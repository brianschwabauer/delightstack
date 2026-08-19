# `@delightstack/crdt`

Collaborative document storage for Cloudflare Durable Objects: a [Loro](https://loro.dev)
CRDT wrapper with an append-only op log, derived edit sessions, named checkpoints, time
travel and compaction.

One Durable Object per document. Loro lives **only** inside this package — nothing else in
your app should import `loro-crdt`.

> **Status.** The server half (`@delightstack/crdt/server`) is implemented. The client
> (`/client`) and ProseMirror binding (`/prosemirror`) entries are declared but not yet
> built.

---

## Entry points, and why they are split

Loro ships several wasm builds behind one specifier, and export-condition resolution picks
the wrong one in two of the three environments that matter:

| Environment | Bare `loro-crdt` resolves to | What happens |
|---|---|---|
| workerd | the `browser` build | `new URL('…bg.wasm', import.meta.url)` throws **at module scope** — the Worker never boots |
| Vite dev | the `bundler` build | *"ESM integration proposal for Wasm is not supported"* |
| Browser prod | the `browser` build | boots, but fetches 3.2MB with a **synchronous XHR** and decodes it byte by byte on the main thread |

So the build is pinned per environment instead of being left to resolution, and each entry
point is the only place its build is named:

```ts
import { CrdtDocumentServer } from '@delightstack/crdt/server';  // loro-crdt/bundler
import { … } from '@delightstack/crdt/client';                   // loro-crdt/web (streaming)
import type { Frontier } from '@delightstack/crdt';              // types only, no wasm
```

Importing `/server` into a browser bundle, or `/client` into workerd, is a build error
waiting to happen. Import the entry that matches where the code runs.

---

## The server

```ts
import { DurableObject } from 'cloudflare:workers';
import { CrdtDocumentServer } from '@delightstack/crdt/server';

export class DocDO extends CrdtDocumentServer<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, {
      project: async (doc, frontier) => { /* derive markdown, links, word count */ },
      retention: () => 'default',
      r2: () => env.SNAPSHOTS,
    });
  }
}
```

### API

| Method | Sync? | What it does |
|---|---|---|
| `applyUpdate(op_id, actor, blob)` | sync | Applies one update, deduping on `op_id`. Returns `{ applied, frontier, seq }`. |
| `syncFor(peer_key, peer_version)` | sync | What one peer must be sent — and records it against the compaction floor. |
| `listUpdates({ from, to, limit })` | sync | Op-log metadata. Never reads a blob. |
| `listSessions({ gap_ms, from, to })` | sync | Edit sessions, derived from that metadata. |
| `listCheckpoints()` / `listSnapshots()` | sync | Stored history markers. |
| `checkpoint({ kind, label, actor })` | sync | Names a point in history — a permanent promise it stays readable. |
| `restore(frontier, actor)` | sync | Makes the document equal an old version **by writing forward**. |
| `getVersion(frontier)` | **async** | An importable blob of the document at that point. |
| `snapshot('shallow' \| 'full')` | **async** | Writes a snapshot of the current state. |
| `compact({ force })` | **async** | Trims the op log. See below. |
| `runProjection({ force })` | **async** | Runs `config.project`, at most once per frontier. |
| `notePeer` / `forgetPeer` / `listPeers` / `peerFloor` | sync | The retention floor. |
| `storageStats()` | sync | `{ update_bytes, snapshot_bytes, total_bytes }`. |

**Why three of them are async.** `04-crdt-and-history.md` sketches `getVersion`, `snapshot`
and `compact` as synchronous. Snapshots above `inline_snapshot_max_bytes` (512KB) live in
R2, and R2 is async — a synchronous `getVersion` could only ever read *inline* snapshots,
which would silently cap the document size at which history works. Everything on the hot
path (`applyUpdate`, the list methods, `checkpoint`, `restore`, `syncFor`) stays synchronous,
because DO SQLite and Loro both are.

**No transport.** There is no WebSocket code here. `syncFor()` says *what* to send; the
Durable Object that owns the sockets decides how. That keeps this class testable without a
runtime and leaves the wire protocol yours.

**No auto-projection.** `config.project` runs when you call `runProjection()`. The package
has no opinion about how long "debounced" is, and a markdown serialization on every
keystroke would be absurd.

### Storage

Private SQLite inside the Durable Object — not a `@delightstack/database` schema:

- `crdt_update` — the append-only log. `frontier` (after applying) and `byte_size` are
  stored columns, which is why listing history and deriving sessions never decode a blob.
- `crdt_snapshot` — keyed by frontier. `pinned = 1` marks a snapshot that exists to keep a
  checkpoint reachable; those are never thinned.
- `crdt_checkpoint` — the document's own copy of its checkpoints. The user-visible rows
  belong in your workspace database; compaction needs to answer "which frontiers must stay
  reachable?" *inside the transaction that deletes blobs*, and it cannot ask another Durable
  Object a synchronous question.
- `crdt_peer` — the compaction floor (below).
- `doc_meta` — small key/value bag.

---

## Compaction and retention

`compact()` does four things, in this order:

1. **Choose a boundary** — the head of the log, pulled back to the peer floor.
2. **Snapshot every checkpoint at or before it** that does not already have a snapshot at
   its exact frontier, pinned, **before a single blob is deleted**.
3. **Snapshot the boundary itself.**
4. **Delete** the update blobs at or below the boundary and any unpinned snapshot the
   boundary supersedes.

Steps 2–4 run in one `transactionSync`.

### Compaction can decline

`compact()` returns `{ skipped: true, skipped_reason }` for `below_threshold`,
`peer_floor`, `retention_forever`, `nothing_to_do`, and — the interesting one —
`would_not_shrink`.

Checkpoint snapshots are mandatory and they are not free. On a small document, or on any
document with dense checkpoints, they cost **more** than the op blobs they replace: the
spike measured a 9-op document growing 871B → 1188B, and this package's own test suite has
a 10,000-edit document with 50 checkpoints where the 50 snapshots outweigh the whole log.
So the invariant is not "compaction never grows storage" unconditionally — it is *"at or
above `COMPACT_THRESHOLD_BYTES`, and otherwise the run is rolled back"*. The transaction
measures the result and rolls itself back rather than letting the claim be false.

Pass `{ force: true }` for an explicit "compact now, I want the log gone" action. The daily
alarm should not.

### The peer floor — read this one

This is the sharpest edge in the design, and the Loro API gives no help with it.

Once history is trimmed to a shallow start, a peer whose version predates that start is
**unrecoverable in both directions**:

- it cannot be caught up — a shallow snapshot imported into a document that is behind its
  shallow start returns `{ success: {}, pending: {} }`, throws nothing, and leaves the
  document exactly as it was;
- and its own pending operations can never be accepted, because their dependencies are gone
  on the server too.

Nothing throws. The device simply stops syncing, forever, and both sides believe they are
fine.

So retention takes a floor at the least-advanced live peer:

```ts
server.syncFor('device-b', peer_version_bytes);  // records device-b at the current head
// or, if you drive sync yourself:
server.notePeer('device-b', acked_seq);
server.forgetPeer('device-b');                   // a device that was reset or removed
```

`compact()` never trims past `min(acked_seq)` over peers seen within
`peer_floor_ttl_ms` (**30 days** by default). A device dark for longer stops holding the
floor — otherwise one lost laptop pins a document's history for life — and when it does
reappear, `syncFor()` returns `kind: 'reset'`: it must discard its local copy, which is a
data-losing action your UI has to surface rather than perform quietly.

**A document with no registered peers has no floor.** That is right for a
server-authoritative deployment where clients re-bootstrap on demand, and wrong for one with
real offline devices. If you have offline devices, register them.

`syncFor()` also handles the incremental-vs-full decision, which cannot be delegated:
`export({ mode: 'update', from })` on a shallow document happily returns a blob whose
dependencies were trimmed, and the receiver reports success and stays where it was. The
check is `shallowSinceVV().compare(peer_version)`, made here, before anything is sent.

### Retention

`config.retention()` returns `'default'` or `'forever'`. `'forever'` never discards an op
blob — set it on manuscripts. Age-based thinning (one snapshot per day after 30 days, one
per month after a year) is not implemented yet; `compact()` currently trims to the boundary
and keeps every pinned checkpoint snapshot.

---

## Time travel

`getVersion(frontier)` returns an importable blob of the document at that point. Three
things about it are load-bearing, and none is the obvious choice:

1. **Replay onto a throwaway document, never `forkAt()`.** `forkAt` is not implemented on
   shallow documents — it works right up until the first compaction and then throws forever.
2. **Replay only *up to* the target, then export.** Exporting a document that has been
   `checkout()`-ed exports its whole oplog state, not the checked-out state. "Replay
   everything, check out the past, export" silently returns the *present*.
3. **An unreachable point is reported, not approximated.** A version whose blobs were
   discarded and which is not a checkpoint throws `frontier_unreachable` (410). Serving the
   nearest snapshot as if it were exact is how a history feature loses someone's work.

`restore(frontier, actor)` **writes forward**: it appends operations that make the document
equal the old version, then records a `restore` checkpoint. History is append-only always,
so undoing a restore is just another restore. It uses Loro's `revertTo`, which needs the
target inside *retained* history — a checkpoint that survives only as a snapshot after
compaction can still be read, but reverting to it needs a content-aware diff and belongs to
the editor layer.

---

## Tests

```bash
npx vitest run                      # 50 convergence scenarios + the invariant suite
CRDT_SCENARIOS=500 npx vitest run   # the nightly budget
```

**`src/__tests__/convergence.test.ts`** is the most important test in the package. Merge
bugs do not throw; they produce a document that is plausible and quietly different on one
device. Each scenario forks 2–5 peers from a common base, runs a random edit script per peer
(insert, delete, replace, split, join, move, format, image, and everyone typing at the same
offset), partitions and heals the network at random, and delivers every update in a random
order **with duplicates** — then asserts every peer agrees on content, markdown projection,
block ids and version vector. Seeded, so a failure is a seed and a seed goes in
`REGRESSION_SEEDS` as a permanent case. 50 scenarios by default (the CI budget); set
`CRDT_SCENARIOS=500` for the nightly run.

Plus explicit cases for same-offset typing, deleting a block another peer is editing, a peer
offline for 1,000 operations, duplicate delivery, out-of-causal-order delivery, and a
compacted peer merging with an uncompacted one.

**`src/__tests__/invariants.test.ts`** is one test per invariant, including the real version
of invariant 3: 10,000 edits with 50 checkpoints scattered through, compaction run to
completion, then all 50 checked out and compared byte for byte against what the document
said at the time.

The Durable Object harness (`src/__tests__/do_harness.ts`) runs the real class against real
SQLite via `node:sqlite`. A mock that records SQL strings can prove the statements were
issued; only an engine can prove they were right.
