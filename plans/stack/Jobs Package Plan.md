# @delightstack/jobs — Design Spec

## Why this package exists

Every real product needs work that happens *outside* a request: send the digest
in an hour, retry the failed webhook sync, purge expired uploads at 3am, charge
trials when they end. Today the stack has no answer — images and ai each
hand-rolled their own DO-alarm loop, auth's session cleanup had to be bolted
onto `refreshSession`, and app developers have nothing at all. A jobs package
turns "background work" from a per-package improvisation into a stack
primitive, and it unblocks features in the other packages (email digests,
stripe reconciliation sweeps, dead-webhook retries, log retention).

The delight moment: `defineJobs` infers a typed job map, so
`locals.jobs.enqueue('send-digest', payload)` is **typo-proof and
payload-typed end-to-end** — a misspelled job name or wrong payload shape is a
compile error, not a 3am production mystery.

## Decision (locked)

**Engine: Durable Object alarms** — a `JobsServer` DO with a SQLite job table
and an alarm chain. Same pattern images/ai already use, generalized.
Not Cloudflare Queues: Queues adds per-app setup (producer binding + consumer
worker), and its batching/concurrency model doesn't fit the "one config object,
works everywhere DOs do" stack philosophy. The driver seam is kept narrow so a
Queues-backed engine could be added later for high-throughput users.

## Semantics (documented honestly)

- **At-least-once.** Handlers must be idempotent; `unique_key` helps.
- Jobs within one JobsServer instance run serially per alarm batch; no
  cross-instance coordination.
- Granularity: the app picks the DO id. Default/recommended: one app-level
  instance (`idFromName('jobs')`). Per-org instances (`idFromName(org_id)`)
  work for org-scoped jobs — document both, the package doesn't care.
  **example-app uses the app-level instance** (locked — keeps the wiring and
  docs simple; per-org is just a different id at the call site).
- The engine **owns the DO's alarm**. A subclass must not call `setAlarm`
  itself; the config exposes hooks instead.

## Package layout

```
packages/jobs/
├── src/
│   ├── index.ts                 # re-exports types + config factory
│   ├── types/
│   │   └── index.ts             # Job, JobOptions, JobsDefinition, JobStatus
│   ├── server/
│   │   ├── index.ts
│   │   ├── jobs.config.ts       # defineJobs()
│   │   ├── jobs.handler.ts      # createJobsHandle() (locals.jobs)
│   │   └── cron.helper.ts       # cron parsing/next-occurrence
│   └── worker/
│       ├── index.ts
│       └── jobs.server.ts       # JobsServer extends DurableObject
├── vite.config.ts               # vitest, environment: edge-runtime
├── tsconfig.json
├── package.json                 # exports: ., ./types, ./server, ./worker
└── README.md
```

## SQLite schema (inside JobsServer)

```sql
CREATE TABLE IF NOT EXISTS job (
	id TEXT PRIMARY KEY,             -- generateTimestampID() from utilities (lexicographically sortable; plain generateID() is NOT)
	name TEXT NOT NULL,              -- handler key
	payload TEXT,                    -- JSON
	status TEXT NOT NULL,            -- 'pending' | 'running' | 'done' | 'failed' | 'dead'
	run_at INTEGER NOT NULL,         -- ms epoch; next attempt time
	attempts INTEGER NOT NULL DEFAULT 0,
	max_attempts INTEGER NOT NULL,
	timeout_ms INTEGER NOT NULL,
	unique_key TEXT,                 -- dedupe key (nullable)
	cron TEXT,                       -- non-null for cron-managed jobs
	last_error TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS job_due ON job (status, run_at);
CREATE UNIQUE INDEX IF NOT EXISTS job_unique ON job (unique_key) WHERE unique_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS job_cron ON job (name, cron) WHERE cron IS NOT NULL AND status = 'pending';
```

Schema versioning: use the same `schema` version table + upgrade-array pattern
as `AuthDatabaseServer.initializeDB` (packages/auth/src/server/auth.db.server.ts).

`status: 'failed'` = retryable failure awaiting next attempt;
`'dead'` = exhausted attempts (kept for inspection, swept by retention).

## Public API

### Definition (in the app's server worker)

```ts
import { JobsServer, defineJobs } from '@delightstack/jobs/worker';

const jobs = defineJobs({
	handlers: {
		'send-digest': async (payload: { user_id: string }, ctx) => { ... },
		'cleanup-uploads': async (_payload: undefined, ctx) => { ... },
	},
	crons: [
		{ name: 'cleanup-uploads', cron: '0 3 * * *' },
	],
	defaults: { max_attempts: 3, timeout_ms: 30_000 },   // optional
	onDeadJob: async (job, ctx) => { ... },              // alert/log/email
});

export class AppJobsServer extends JobsServer<typeof jobs> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env, jobs);
	}
}
```

`HandlerContext (ctx)` provides: `{ env, job (id/name/attempts), enqueue }` —
handlers can enqueue follow-up jobs. `env` is the worker env so handlers reach
other bindings (email DO, R2, etc.).

### Type inference (the core trick)

```ts
export type JobMap<D extends JobsDefinition> = {
	[K in keyof D['handlers']]: Parameters<D['handlers'][K]>[0];
};
// enqueue<K extends keyof JobMap>(name: K, payload: JobMap[K], options?: JobOptions)
```

`defineJobs` must be declared `<const D extends JobsDefinition>(d: D): D` so
literal handler keys survive. The app exports `type AppJobs = typeof jobs` and
the SvelteKit side imports it for typed `locals.jobs`.

### Enqueue/manage (RPC methods on the DO, exposed via locals)

```ts
interface JobsClient<M extends JobMap = JobMap> {
	enqueue<K extends keyof M>(name: K, payload: M[K], options?: {
		delay_seconds?: number;       // or
		run_at?: number;              // ms epoch
		max_attempts?: number;
		timeout_ms?: number;
		unique_key?: string;          // existing pending/running job with same key → returns its id, no insert
	}): Promise<{ id: string; deduped: boolean }>;
	cancel(id: string): Promise<boolean>;            // only pending jobs
	get(id: string): Promise<Job | undefined>;
	list(options?: { status?: JobStatus; name?: string; limit?: number; offset?: number }): Promise<Job[]>;
	retry(id: string): Promise<boolean>;             // re-arm a dead job
}
```

`createJobsHandle({ getJobsServer })` assigns a lazy `event.locals.jobs`
(getter pattern, same as the db locals in example-app's hooks). No HTTP routes
in v1 — management is code-level; an admin UI can come later.

## Engine internals

### Alarm loop

```
alarm():
1. now = Date.now()
2. recover: any job stuck 'running' with updated_at < now - timeout_ms - grace
   → treat as failed attempt (DO died mid-run)
3. batch = SELECT due pending/failed jobs ORDER BY run_at LIMIT 10
4. for each: mark running (sync) → run handler with Promise.race(timeout, AbortSignal)
   - success → status done
   - throw/timeout → attempts++; attempts >= max_attempts
       ? status dead + onDeadJob (wrapped in try/catch: a throwing onDeadJob is
         logged and swallowed — it must never wedge the alarm loop)
       : status failed, run_at = now + backoff(attempts)
5. if more due jobs remain → setAlarm(now)  (immediate re-fire, bounded batches)
   else → setAlarm(min future run_at) if any
6. retention sweep (throttled, ~hourly): delete done/dead older than
   retention_days (default 7)
```

- `backoff(n)`: `d = min(cap, base * 2^n)` with base 30s, cap 1h; final delay
  is `d` scaled by a uniform random factor in [0.8, 1.2] (jitter applied to the
  clamped result).
- Every write that changes the earliest `run_at` (enqueue, retry, cancel) calls
  the shared `scheduleAlarm(storage, run_at)` helper: set the alarm if none
  exists or the new time is earlier. **Extract this helper into
  @delightstack/utilities** from the near-identical copies in images/ai, and
  refactor those packages to use it (separate commit).
- Batch size 10 keeps each alarm invocation well under DO CPU limits; the
  immediate re-fire in step 5 drains backlogs without a long-running invocation.

### Cron

- On DO start (and whenever the definition version changes — hash the cron
  config into the schema table), upsert one pending job per cron entry with
  `run_at = nextOccurrence(cron, now)`; remove pending cron jobs whose entry
  was deleted from config.
- On completion (success OR dead), insert the next occurrence. Crons never
  stop because one run failed.
- Parser: 5-field cron (minute hour dom month dow), UTC. **First implementation
  step (before building anything on it)**: spike `croner` under the
  edge-runtime vitest environment and in `wrangler dev`. If it imports and
  computes next-occurrences cleanly, use it; otherwise vendor a minimal parser
  (5 fields, lists/ranges/steps — ~100 lines) in cron.helper.ts. Don't defer
  this decision past day one — the cron lifecycle code depends on its API.

## Wiring (example-app)

1. `server/src/index.ts`: define handlers + export `AppJobsServer`.
2. `server/wrangler.toml`: add to `new_sqlite_classes` migration + DO binding `JOBS`.
3. App `wrangler.jsonc`: cross-script binding `JOBS` → `delightstack-example-server`.
4. `hooks.server.ts`: `createJobsHandle({ getJobsServer: (event) => event.platform?.env?.JOBS })`
   in the `sequence()`; add `JOBS` to `Platform.env` types.
5. Example use: enqueue a job from a route; one cron (e.g. expired-upload sweep).

## Implementation checklist

1. Scaffold package; types + `defineJobs` + inference tests
   (`expectTypeOf`/`assertType` — wrong payload shape must fail compile).
2. Extract `scheduleAlarm` to utilities; refactor images/ai to use it.
3. JobsServer: schema init/versioning, enqueue/cancel/get/list/retry RPC.
4. Alarm loop: due selection, timeout, backoff, dead-letter, stuck-running
   recovery, immediate re-fire, retention sweep.
5. Cron: helper + upsert/reschedule lifecycle.
6. `createJobsHandle` + typed locals.
7. example-app wiring (above).
8. README + docs page: semantics (at-least-once, idempotency), DO granularity
   guidance, "don't touch the alarm" warning, cron syntax, dead-job handling.
9. Changeset.

## Testing strategy

Mirror websocket's mocked-DO test approach (`vi.mock('cloudflare:workers')`,
fake ctx/storage with an in-memory alarm) + fake timers:

- enqueue → alarm fires → handler runs → done.
- failure → backoff schedule → dead after max_attempts → onDeadJob called once.
- timeout kills a hung handler; AbortSignal observed.
- unique_key dedupe (pending and running); released after done.
- stuck-running recovery after simulated DO death.
- cron: initial upsert, reschedule-on-complete, config change adds/removes,
  next-occurrence math (incl. month/dow edge cases).
- backlog drain: 50 due jobs complete across chained alarms in batches of 10.
- retention sweep.
- Type-level tests for the JobMap inference.

## Risks & mitigations

- **DO CPU limits on long handlers** — default 30s timeout, batch of 10,
  document "chunk your work, enqueue continuations" (ctx.enqueue exists for this).
- **Alarm is a singleton per DO** — engine owns it; loud documentation; the
  config hook surface means subclasses shouldn't need their own alarm.
- **Clock/eviction edge cases** — stuck-running recovery handles eviction
  mid-run; alarms persist across eviction (platform guarantee).
- **Unbounded job table** — retention sweep + `list` for inspection.
- **croner compatibility** — verify under edge-runtime first; vendoring
  fallback is scoped and acceptable.
