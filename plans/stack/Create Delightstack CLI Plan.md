# create-delightstack — Design Spec

## Why this package exists

Delightstack's biggest adoption problem isn't capability — it's the first two
hours. Going from zero to a running app today means: clone or study
example-app, understand the two-worker model, hand-write a wrangler.jsonc and
a server/wrangler.toml with cross-script DO bindings and SQLite migrations,
wire eight `create*Handle` factories in the right `sequence()` order, type the
Platform.env bindings, and learn which secrets go where. Every meta-framework
that won developer mindshare (create-t3-app, sv, Redwood) won it at the
scaffold step. `pnpm create delightstack my-app` collapses those two hours
into one command and makes the stack's "everything composed" value visible in
the first five minutes.

Secondary goal (ties into the "delightstack for AI agents" TODO item): a fully
**headless mode** means coding agents can scaffold delightstack apps without
interactive prompts — the CLI is the machine-readable entry point to the stack.

## Decisions

- Package name **`create-delightstack`** (unscoped — required for
  `pnpm create delightstack` / `npm create delightstack` to resolve).
- Lives at `packages/create-delightstack`, versioned/published with the
  monorepo. **Add it to the changesets `linked` array** (.changeset/config.json
  currently lists only the `@delightstack/*` packages) — version-lockstep with
  the stack is what makes baked-in dependency versions correct by construction.
- Prompts via `@clack/prompts`; every prompt has a flag equivalent.
- The template is a real, valid, typecheckable project — **marker comments**,
  not a template language. Anti-drift CI builds the scaffolded output.

## Package layout

```
packages/create-delightstack/
├── src/
│   ├── index.ts                 # #!/usr/bin/env node entry, arg parsing
│   ├── prompts.ts               # interactive flow (@clack/prompts)
│   ├── scaffold.ts              # copy template, strip markers, rename, inject versions
│   ├── markers.ts               # marker-stripping engine
│   ├── packages.ts              # registry: per-package files/markers/bindings/secrets/deps
│   └── steps.ts                 # post-scaffold: install, git init, next-steps output
├── template/                    # the scaffold source (see below)
├── tests/
│   ├── scaffold.test.ts
│   └── fixtures/
├── package.json                 # "bin": { "create-delightstack": "./dist/index.js" },
│                                # "files": ["dist", "template"]
├── tsconfig.json
└── vite.config.ts               # vitest, environment: node (this is a Node CLI)
```

Build: this package is plain TS targeting Node (not svelte-package). Use a
minimal `tsc`/tsdown build — whatever emits a single executable ESM file;
decide at impl time, keep deps to `@clack/prompts` + `picocolors` only.
(`fs`, `path`, arg parsing via `node:util parseArgs` — no commander.)

## CLI surface

```
pnpm create delightstack my-app [flags]

Flags (every prompt has one — headless mode for CI/agents):
  --packages auth,database,websocket,images,stripe,ai,email,jobs,logging
  --all                  # every package
  --minimal              # auth + database only
  --name <app-name>      # worker/app name (default: directory name)
  --no-install           # skip pnpm install
  --no-git               # skip git init
  --yes                  # accept all defaults, never prompt
```

Interactive flow:
1. App directory (arg or prompt). Refuse non-empty dirs (offer `--force` later, not v1).
2. Multiselect packages. `components`/`styles`/`utilities` are always included
   (they're imports, not infrastructure). Dependency rules auto-applied with a
   note: stripe → auth; email → nothing but recommends auth; jobs/logging → free.
3. Confirm summary → scaffold → install → git init → next-steps block.

Exit codes: 0 success, 1 validation error, 2 scaffold failure (with the
partially-created directory removed).

## The template

A trimmed two-worker skeleton derived from example-app (NOT the full
example-app — no family-tree demo content; one landing route, one protected
route, one API route as teaching examples):

```
template/
├── package.json                 # deps on @delightstack/* — version placeholder
├── wrangler.jsonc               # app worker: cross-script DO bindings per package
├── svelte.config.js
├── vite.config.ts
├── tsconfig.json
├── .dev.vars.example            # every secret with a comment explaining it
├── .gitignore
├── README.md                    # generated deploy checklist (see below)
├── src/
│   ├── hooks.server.ts          # full sequence() with ALL packages, marker-wrapped
│   ├── app.d.ts                 # Locals + Platform.env, marker-wrapped per binding
│   ├── routes/
│   │   ├── +layout.svelte       # imports @delightstack/styles global.css
│   │   ├── +page.svelte         # landing page using components
│   │   ├── dashboard/+page.svelte   # auth-guarded example  [marker: auth]
│   │   └── api/health/+server.ts
│   └── lib/
└── server/
    ├── wrangler.toml            # DO classes + migrations, marker-wrapped
    ├── package.json
    ├── tsconfig.json
    └── src/index.ts             # DO re-exports/subclasses, marker-wrapped
```

DO bindings, `new_sqlite_classes` migration entries, and class re-exports are
all marker-wrapped **per package** — an unselected package contributes zero DO
classes, zero bindings, and zero `Platform.env` entries. `--minimal`
(auth + database) therefore scaffolds only `AuthDatabaseServer` +
`OrgDatabaseServer` (+ rate-limiter only if selected); the images container
block exists only when images is selected.

### Marker system (markers.ts)

```ts
// hooks.server.ts excerpt
/* @delight:start stripe */
import { createBillingHandle } from '@delightstack/stripe/server';
const billingHandle = createBillingHandle({ ... });
/* @delight:end stripe */

export const handle = sequence(
	loggingHandle,
	authHandle,
	/* @delight:start stripe */ billingHandle, /* @delight:end stripe */
	...
);
```

- Block form (`@delight:start X` … `@delight:end X`) and line form
  (`// @delight:line X` suffix) for single lines; same syntax in `.jsonc`,
  `.toml` (`# @delight:start X`), and `.svelte` (`<!-- @delight:start X -->`).
- Stripping: for each NON-selected package, remove its marked regions; then
  remove ALL marker comments from the output. Unbalanced or unknown markers are
  a **hard error everywhere** — in tests AND at scaffold time (exit code 2,
  partial output removed). Never warn-and-continue: a half-stripped project is
  worse than no project.
- **The unstripped template must itself typecheck and build** — that's what
  makes drift impossible: the template is just a valid app with all packages on.
- After stripping, run the repo formatter assumption-free (the generated app
  isn't in the monorepo): keep marker placement so stripped output is already
  well-formed rather than depending on a formatter.

### packages.ts registry

One record per optional package drives everything; adding a future package to
the CLI = one registry entry + markers in the template:

```ts
interface PackageEntry {
	id: 'auth' | 'database' | 'websocket' | 'images' | 'stripe' | 'ai' | 'email' | 'jobs' | 'logging';
	label: string;             // prompt text
	requires?: PackageEntry['id'][];        // stripe requires auth
	deps: Record<string, string>;           // package.json deps to keep
	secrets: { name: string; description: string }[];   // .dev.vars + next-steps
	bindings: string[];                      // for next-steps explanation
	files?: string[];                        // whole files to delete when unselected
}
```

`scaffold.ts` additionally: renames app/worker names from `--name` (wrangler
names, package.json name, server script_name references — single
search/replace of a `__DELIGHT_APP_NAME__` token), and injects the current
published `@delightstack/*` version (read at build time from the monorepo root
version, baked into the CLI build as a constant).

### Generated README / next-steps

The post-scaffold terminal output and generated README.md cover, conditionally
per selected package:

1. `pnpm dev` (app) — works immediately with local DO persistence.
2. Secrets: per-package list with `wrangler secret put` commands and what each
   does (JWT_KEY_SECRET, STRIPE_SECRET_KEY, RESEND_API_KEY, …).
3. Deploy order: **server worker first** (DO classes must exist before the
   app's cross-script bindings resolve), then app. Exact commands.
4. Package-specific setup: Stripe webhook note, Email domain onboarding
   (Cloudflare DNS) or Resend alternative, R2 bucket creation for images.
5. Links to docs.thedelight.co per-package guides.

## Anti-drift CI

Two jobs in the existing workflow:

1. **Template integrity**: typecheck/build the raw template in place (with all
   packages on, using `workspace:*` overrides so it builds against local
   packages, mirroring how example-app validates).
2. **Scaffold matrix**: run the built CLI with `--all --no-install --no-git`
   and with `--minimal`, then `pnpm install` + build + typecheck each output.
   Marker-stripping bugs and template rot fail CI, not users.

## Implementation checklist

1. Marker engine + tests first (it's the riskiest pure logic: block/line forms,
   all comment syntaxes, nested markers rejected, unknown ids rejected).
2. packages.ts registry.
3. Template: extract from example-app, de-demo it, add markers, make it build
   standalone with `--all`.
4. scaffold.ts (copy → strip → rename → version-inject → write) + snapshot
   tests per package combination (at minimum: all, minimal, all-minus-stripe,
   email-without-auth).
5. prompts.ts + flag parsing (+ `--yes` headless path) — keep prompts.ts thin
   so all logic is testable without a TTY.
6. steps.ts: install (spawn pnpm, stream output), git init + initial commit,
   next-steps rendering.
7. CI jobs (above).
8. Docs: quickstart page rewritten around `pnpm create delightstack`;
   headless-flags section explicitly addressed to agents.
9. Changeset; verify `pnpm pack` includes `template/` and the bin resolves.

## Testing strategy

- Unit: marker engine exhaustively; registry dependency resolution; name/version
  injection.
- Snapshot: full generated trees (file list + key file contents) per combination.
- E2E (CI): scaffold → install → build → typecheck, both `--all` and `--minimal`.
- Manual before release: scaffold on a clean machine, follow the generated
  README through a real deploy.

## Risks & mitigations

- **Template rot** — the whole design (valid-project template + CI matrix)
  exists to kill this risk structurally rather than by discipline.
- **Version skew** (CLI scaffolds deps newer/older than the CLI knows) —
  version baked at publish time; changesets `linked` keeps CLI and packages on
  one version line, so `create-delightstack@X` always scaffolds `@X` deps.
- **Windows paths/line endings** — repo already enforces LF via .gitattributes;
  use `node:path` everywhere; CI matrix can add a Windows runner later.
- **pnpm-only assumption** — v1 generates pnpm projects (matches the stack);
  detect the invoking package manager later if there's demand.
