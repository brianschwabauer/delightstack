# `@delightstack/crdt`

Collaborative document storage for Cloudflare Durable Objects: a [Loro](https://loro.dev)
CRDT wrapper with an append-only op log, derived edit sessions, named checkpoints, time
travel and compaction.

One Durable Object per document. Loro lives **only** inside this package — nothing else in
your app should import `loro-crdt`.

> **Status.** The server (`@delightstack/crdt/server`) and client
> (`@delightstack/crdt/client`) halves are implemented. The ProseMirror binding
> (`/prosemirror`) is not yet built.

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

## The client

```ts
import { CrdtClient } from '@delightstack/crdt/client';

const crdt = new CrdtClient({
  transport,                 // you supply this — see below
  storage: 'opfs',
  actor: 'user:abc',
  quota_bytes: 2_000_000_000,
});

const handle = await crdt.open(node_id);
await handle.ready();        // ← the bootstrap gate. Not optional. Read the next section.

handle.transact((doc) => doc.getText('content').insert(0, 'hello'));
const stop = handle.subscribe((event) => render(event));

crdt.close(node_id);         // resident for 5 more minutes, then snapshotted and dropped
```

### API

| Member | Sync? | What it does |
|---|---|---|
| `open(node_id)` | async | Replays local storage (no network), returns a handle. |
| `close(node_id)` | sync | Drops one reader. Idle documents are evicted after `idle_evict_ms`. |
| `evict(node_id)` | async | Snapshot to storage, drop the Loro instance. Memory only. |
| `purge(node_id)` | async | **Delete** the local copy. The recovery path from a `reset`. |
| `flush()` / `destroy()` | async | Land every issued write; tear down. |
| `enforceQuota()` | async | LRU-sweep local storage back under `quota_bytes`. |
| `sync_state` | `$state` | `synced` / `syncing` / `offline` / `error`. |
| `pending_count` | `$state` | Local commits not yet acked, across all open documents. |

| Handle member | Sync? | What it does |
|---|---|---|
| `doc` | — | The live `LoroDoc`. Read freely; write only via `transact`. |
| `frontier` | `$state` | Current point in history, as the opaque `Frontier` string. |
| `loading` / `ready()` | `$state` / async | The bootstrap gate. |
| `pending_count` | `$state` | This document's unacked commits. |
| `transact(fn, opts?)` | **sync** | Apply a change, persist it, queue it for send. |
| `subscribe(fn)` | sync | Loro events. Returns an unsubscribe function. |

Reactive members are Svelte 5 runes, so `svelte` is an **optional peer dependency**. Nothing
else in the client needs it; a non-Svelte consumer reads the same properties as plain
getters.

### The bootstrap ordering rule — the one that bites

**Never mount an editor on a handle before `await handle.ready()`.**

A Loro shallow snapshot imports only into a document whose version already covers the
snapshot's shallow start — an *empty* document being the special case that always works. A
rich-text editor's very first transaction writes an empty document into the CRDT. One
operation is enough. After it, a compacted server can never bootstrap that device: `import()`
returns `{ success: {}, pending: {} }`, throws nothing, and leaves the document untouched.
Nothing in the Loro API signals this, both sides believe they are fine, and the device simply
stops syncing forever. This is exactly how the Milestone 0 spike failed.

So `open()` returns a handle that is `loading`, and the gate clears on the **first** of:

1. the first `sync` message from the server;
2. local storage already holding operations (the document cannot be "empty and dirty", so
   there is nothing left to protect);
3. `bootstrap_timeout_ms` (default **1.5s**) — what makes a genuinely offline first run
   usable.

And the gate has teeth: **`transact()` throws `bootstrap_pending` while `loading`.** Writing
the rule down was not enough the first time.

### Transport is injected, never owned

There is no WebSocket in this package, on either side. `CrdtClient` takes a `CrdtTransport`:

```ts
interface CrdtTransport {
  readonly connected: boolean;
  send(message: CrdtOutboundMessage): void;
  onMessage(handler: (m: CrdtInboundMessage) => void): () => void;
  onConnectionChange(handler: (connected: boolean) => void): () => void;
}
```

Messages are structured objects carrying `Uint8Array` payloads, not frames — framing is a
wire decision. The set maps one-to-one onto the server: `subscribe` → `syncFor()`, `update` →
`applyUpdate()`, and the server's `sync` / `broadcast` / `ack` / `error` come back. Wire it to
`@delightstack/websocket`, to a `BroadcastChannel`, or to a test double.

The reason is not purity. In a real app one connection carries metadata sync, presence and
document bodies; a CRDT package that opens its own is a second socket, a second reconnect
policy and a second auth handshake. It also makes partitioning a client mid-edit a two-line
test.

**Your transport must fire `onConnectionChange`.** Re-subscribing on reconnect *is* the
catch-up protocol — the server answers with a version-vector diff, which covers an offline
session of any length — so a transport that reconnects silently leaves documents stuck.

### Durability: what `transact()` actually promises

`transact()` is synchronous, and the update blob is appended to the local pending log before
it returns. Persistence completing and the network send are fire-and-forget.

That promise is only enforceable with `createSyncAccessHandle()`, whose `write()` is genuinely
synchronous — and which exists **only in a worker**. Run this layer in a SharedWorker. On the
main thread `OpfsCrdtStorage` still works, via `createWritable()`, but the write is merely
*queued* synchronously; the instance reports which you got as `opfs.durable`.

Local storage per document is a snapshot plus an append-only log of framed records (updates
and ack tombstones), folded into a fresh snapshot every `snapshot_every` records. Remote blobs
are logged too — the snapshot is only rewritten periodically and everything since it has to
survive a reload. Unacked *local* blobs are re-appended after a fold even though the snapshot
already contains their operations: the snapshot preserves the content, but only a log record
preserves the `op_id`, and without it a reload loses the ability to resend.

Sends are debounced by `send_debounce_ms` (default **200ms**) and a run of never-sent commits
is coalesced into one update by re-exporting from the first one's version vector. The spike
measured ~90 bytes of CRDT inside a ~175 byte frame per keystroke — half the traffic was
framing. Blobs that have already been sent are never re-coalesced: that would change their
`op_id` and defeat the server's deduplication.

`storage: 'idb'` throws `not_implemented`. IndexedDB cannot offer the synchronous append, so
an IndexedDB backend would silently weaken the contract rather than widen support. Pass a
`CrdtStorage` of your own, or `MemoryCrdtStorage` for a deliberately non-durable one.

### Eviction and quota

Two different things, deliberately named differently:

- **Memory eviction.** A document stays resident `idle_evict_ms` (default **5 minutes**) after
  its last reader closes it, then its snapshot is written and the Loro instance is dropped. A
  later `open()` restores from storage. A document holding unacked commits is *not* evicted —
  dropping it would leave nothing in memory to resend from.
- **Quota eviction.** `quota_bytes` (default **2GB**) is a soft cap on total local body
  storage. `enforceQuota()` deletes whole documents, least-recently-used first. It never
  touches a resident document, and **never a document holding unacked local commits** — quota
  pressure must not be a route to losing an edit the server has not seen, so a workspace whose
  entire quota is unsynced work simply stays over quota.

### `reset` — the data-losing case

If the server answers a `subscribe` with `kind: 'reset'`, this device holds state that
predates the retained history. Its commits can never be accepted and the server's snapshot can
never be imported on top of them. The client **does not apply it**: it marks the handle
unusable (`transact()` throws `reset_required`), sets `sync_state` to `error`, and calls
`config.on_reset({ node_id, unacked_ops })`. Discarding a user's offline work is a decision a
UI makes, not a library. Recover with `await crdt.purge(node_id)` then `await crdt.open(...)`.

Register your devices with the server (`syncFor` / `notePeer`) and this stays rare — see the
peer floor above.

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

**`src/__tests__/client.test.ts`** drives `CrdtClient` against the **real**
`CrdtDocumentServer` over real SQLite, through a loopback transport a test can partition. It
covers the offline-edit-survives-reload path, the empty-doc-then-compacted-server trap (both
that it is real and that the gate prevents it), in-order resend with duplicate delivery,
eviction and restore, and the quota sweeper's refusal to drop unacked work.

OPFS does not exist in Node and no DOM shim implements it, so storage is tested through
`MemoryCrdtStorage` — the same `CrdtStorage` interface storing the **same framed bytes**, so
framing, tombstones, log replay, snapshot folding and the quota sweep are all real. What that
does not cover: that `createSyncAccessHandle().write()` really is synchronous in a browser, the
main-thread positional-append path, two-worker handle contention, and browser-initiated
eviction. Those need a browser.

**`src/__tests__/invariants.test.ts`** is one test per invariant, including the real version
of invariant 3: 10,000 edits with 50 checkpoints scattered through, compaction run to
completion, then all 50 checked out and compared byte for byte against what the document
said at the time.

The Durable Object harness (`src/__tests__/do_harness.ts`) runs the real class against real
SQLite via `node:sqlite`. A mock that records SQL strings can prove the statements were
issued; only an engine can prove they were right.
