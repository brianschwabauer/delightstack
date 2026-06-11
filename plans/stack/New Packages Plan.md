# New Packages — Overview

Four packages close the infrastructure gaps that keep delightstack from being a
complete product-building stack. Each has its own self-contained design spec:

1. [Email Package Plan](<Email Package Plan.md>) — `@delightstack/email`:
   Cloudflare Email Sending default driver (+ Resend/SendGrid), Svelte-component
   templates, dev preview route, auth email hooks + default templates.
2. [Jobs Package Plan](<Jobs Package Plan.md>) — `@delightstack/jobs`:
   DO-alarm engine (SQLite job table + alarm chain), typed `enqueue` via
   `defineJobs`, cron, retries/dead-letter.
3. [Logging Package Plan](<Logging Package Plan.md>) — `@delightstack/logging`:
   structured JSON logger + sinks (console, Sentry via plain fetch), request
   handle with request ids, then `logger?` threaded through package configs.
4. [Create Delightstack CLI Plan](<Create Delightstack CLI Plan.md>) —
   `create-delightstack`: marker-stripped valid-project template, interactive +
   headless flags, anti-drift CI.

**Build order: email → jobs → logging → CLI.** Auth needs email today; jobs
wants email for alerts; logging threads through everything; the CLI scaffolds
the finished shape last. Each is independently releasable (changesets `linked`).

Decisions were locked 2026-06-11 (see each spec's "Decisions" section).
