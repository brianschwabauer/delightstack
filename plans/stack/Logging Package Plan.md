# @delightstack/logging — Design Spec

## Why this package exists

Nothing in the stack is observable today. Auth sign-ins, Stripe webhook
outcomes, slow database queries, websocket disconnect storms — all of it is
either silent or ad-hoc `console.log` lines with no structure, no request
correlation, and no error context. The first time someone runs a real product
on delightstack and a webhook silently fails, they have nothing to debug with.

The fix deliberately is **not** an APM. Cloudflare already provides transport
(Workers Logs, Logpush, `wrangler tail` all ingest structured console output) —
what's missing is the shape: one logger with structured JSON lines, request ids
that tie a request's logs together, user/org context attached automatically,
errors serialized usefully, and a seam (`sinks`) for shipping to Sentry or
anywhere else without buying into an SDK. Once this exists, the other packages
can finally emit through it (`logger?` config option) instead of every package
inventing its own logging story.

## Scope (and non-goals)

In: structured logger, levels, child/bound context, sinks (console default,
Sentry optional), SvelteKit request handle with request ids + summary lines,
error capture helper, DelightError-aware + redacting serialization.

Out (v1): metrics/tracing/spans, sampling, log querying UI, OpenTelemetry.
The sink interface is the extension point if any of those matter later.

## Package layout

```
packages/logging/
├── src/
│   ├── index.ts                 # createLogger, types (isomorphic — works in
│   │                            #   Workers, DOs, and the browser)
│   ├── types/
│   │   └── index.ts             # Logger, LogLevel, LogRecord, LogSink
│   ├── server/
│   │   ├── index.ts
│   │   ├── logging.handler.ts   # createLoggingHandle(), captureError()
│   │   └── serialize.helper.ts  # error serialization + redaction
│   └── sinks/
│       ├── index.ts
│       ├── console.sink.ts
│       └── sentry.sink.ts       # plain fetch to the envelope API, no SDK
├── vite.config.ts               # vitest, environment: edge-runtime
├── tsconfig.json
├── package.json                 # exports: ., ./types, ./server, ./sinks
└── README.md
```

No `worker/` entry — loggers are plain objects; DOs construct one directly.

## Core types

```ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
	level: LogLevel;
	message: string;
	time: number;                          // ms epoch
	service?: string;
	fields: Record<string, unknown>;       // merged bound context + call fields
}

export interface LogSink {
	id: string;
	min_level?: LogLevel;                  // per-sink floor (e.g. sentry: 'error')
	write(record: LogRecord): void | Promise<void>;
}

export interface Logger {
	debug(message: string, fields?: Record<string, unknown>): void;
	info(message: string, fields?: Record<string, unknown>): void;
	warn(message: string, fields?: Record<string, unknown>): void;
	error(message: string, fields?: Record<string, unknown>): void;
	/** New logger with extra bound context merged into every record */
	child(fields: Record<string, unknown>): Logger;
}

export interface LoggerConfig {
	service?: string;
	level?: LogLevel;                      // global floor @default 'info' ('debug' when dev)
	sinks?: LogSink[];                     // @default [consoleSink()]
	dev?: boolean;
	/** Field names redacted in output (case-insensitive substring match)
	 * @default ['password','secret','token','authorization','cookie','set-cookie','api_key','jwt','private_key'] */
	redact?: string[];
	/** Run sink promises without blocking; pass ctx.waitUntil where available */
	wait_until?: (p: Promise<unknown>) => void;
}

export function createLogger(config?: LoggerConfig): Logger;
export function noopLogger(): Logger;     // default for packages' `logger?` option
```

Behavioral notes:
- Logging never throws and never blocks: sink errors are swallowed (after one
  `console.error` per sink id per isolate, so a broken sink is visible once,
  not on every line). Async sink writes go through `wait_until` when provided.
- `child()` merges fields shallowly; later keys win. Child of child works.
- Levels: a record is dropped unless it clears both the global floor and the
  sink's `min_level`.

## Serialization & redaction (serialize.helper.ts)

- Any field value that is an `Error`: serialize to
  `{ name, message, stack, ...(DelightError.is → { status, code, detail }) }`.
  Convention: pass errors as `{ error }` field; the helper normalizes.
- Redaction: case-insensitive key match against the redact list at any nesting
  depth → value replaced with `'[redacted]'`. Applied before sinks see the record.
- Cycle-safe JSON (`WeakSet` guard); depth-capped (default 6) so a logged DO
  stub or request object can't explode a log line; non-serializable values
  become their `String()` form.

## Sinks

### consoleSink

```ts
consoleSink(options?: { pretty?: boolean }): LogSink
```

- Default sink. JSON line via the level-matching console method
  (`console.error` for error, etc. — Workers Logs preserves the level).
- `pretty: true` (default when `dev`): human-readable single line —
  `12:31:04 INFO  image processed  image_id=… duration_ms=42` — because raw
  JSON in `wrangler dev` output is miserable.

### sentrySink

```ts
sentrySink(options: { dsn: string; environment?: string; release?: string }): LogSink
```

- `min_level: 'error'` by default.
- Plain `fetch` POST to Sentry's envelope endpoint (parse the DSN for host +
  public key; `x-sentry-auth` header). A malformed DSN throws `DelightError`
  **at sink construction** (fail fast at startup, never silently per-record). Build a minimal event payload: message,
  level, exception (from a serialized error field if present, including stack),
  tags from fields, environment/release. **No @sentry/* dependency** — the
  envelope format for plain events is small and stable, and an SDK drags in
  Node assumptions.
- Document clearly: this is best-effort error shipping, not full Sentry SDK
  features (no breadcrumbs/tracing). Apps wanting those can write their own sink.

## SvelteKit integration (logging.handler.ts)

```ts
export interface LoggingLocals { log: Logger; request_id: string }

export function createLoggingHandle(options: {
	logger: Logger;
	/** Pull extra context per request once other handles have run is impossible
	 *  (this handle runs FIRST) — so context comes from a callback evaluated
	 *  lazily at log time instead: */
	context?: (event: RequestEvent) => Record<string, unknown>;
	/** Log a summary line per request @default true */
	request_summary?: boolean;
	/** Skip noisy paths (assets, health checks) */
	ignore?: (pathname: string) => boolean;
}): Handle;

export function captureError(logger: Logger, error: unknown, event?: RequestEvent): void;
```

- **Placement: first in `sequence()`** so every later handle and route sees
  `locals.log`. Note: example-app's hooks.server.ts currently puts `authHandle`
  first — integrating this package includes that reorder (logging before auth),
  which is safe because auth doesn't depend on any earlier locals.
- Per request: `request_id = generateID()`, `locals.log = logger.child({ request_id })`.
  Because auth runs *after* this handle, user/org ids can't be bound eagerly —
  the `context` callback is invoked when the summary line is written (auth
  locals are populated by then), and route code logging via `locals.log`
  already runs post-auth. Honored response header `x-request-id` is set so
  client errors can reference it.
- Summary line at `info`: `{ method, path, status, duration_ms }` + context().
  4xx logs at `warn`, 5xx at `error`. `resolve()` wrapped in try/catch: thrown
  errors are captured (with stack + request context) and rethrown so
  SvelteKit's own error handling still runs.
- `captureError` is for the app's `handleError` hook in hooks.server.ts —
  catches what the handle can't see (load functions, rendering).
- Uses `event.platform?.context?.waitUntil` for sink flushing when present
  (example-app's `App.Platform` already types `context: ExecutionContext`,
  which includes `waitUntil` — no type changes needed, just optional chaining
  for non-CF environments).

## Threading through the other packages (follow-up, incremental)

Add `logger?: Logger` (default `noopLogger()`) to each package config and emit
at the points that matter — one focused commit per package, after v1 ships:

| Package | What to log |
|---|---|
| auth | sign-in success/failure (no email enumeration in fields), rate-limit hits, session refresh failures |
| stripe | webhook received/processed/deduped/failed (event id + type), sync outcomes, dead webhooks |
| database | slow queries (> threshold ms), migration runs, corrupt-json fallbacks (replace the console.error added 2026-06) |
| websocket | connect/disconnect counts, oversized-message rejections, broadcast failures |
| images | processing duration, failures, retries |
| jobs | job started/done/dead (the jobs package should take `logger?` from day one) |

DOs receive the logger via constructor options (apps construct
`createLogger({ service: 'auth-do', ... })` in the server worker entry).

## Implementation checklist

1. Scaffold package; types; `createLogger` core (levels, child, never-throw) + tests.
2. serialize.helper: error serialization, redaction, cycles/depth + tests
   (assert secrets never appear in output — the critical test).
3. consoleSink (json + pretty) + sentrySink (mocked fetch: DSN parse, envelope
   shape, min_level) + tests.
4. createLoggingHandle + captureError + tests (fake RequestEvents: request id
   propagation, summary levels by status, ignore(), thrown-error capture+rethrow).
5. example-app wiring: logger in hooks.server.ts (first in sequence),
   `captureError` in `handleError`, `x-request-id` visible end-to-end.
6. README + docs page: "where do my logs go" table (wrangler tail / Workers
   Logs dashboard / Logpush / sentrySink), sink-authoring guide.
7. Changeset. Then the per-package threading commits (table above).

## Testing strategy

All unit-testable without infrastructure: in-memory test sink capturing
records; assertions on structure, levels, redaction, child merging; handle
tests with fake events. The one integration check: `wrangler dev` the
example-app and confirm pretty output + Workers Logs ingestion of JSON lines.

## Risks & mitigations

- **Log-volume cost** (Workers Logs bills by volume) — default level `info`,
  `ignore()` for assets, no per-message spam in package threading (counts/
  summaries over per-event lines where high-frequency).
- **Sentry envelope drift** — envelope v7 event payloads are stable; pin the
  format in tests; failure mode is a silently dropped event (sink contract).
- **Accidental secret logging** — redaction list + the serializer test; docs
  warn against logging whole request/env objects (depth cap limits the blast).
- **Handle-ordering confusion** (logging first vs auth-context availability) —
  solved by the lazy `context` callback; document the ordering requirement
  with a hooks.server.ts example.
