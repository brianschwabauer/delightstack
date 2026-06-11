# @delightstack/email — Design Spec

## Why this package exists

Delightstack cannot ship a working product without email. Auth already needs it
today: email verification, password reset, email sign-in links, and (eventually)
org invitations all generate tokens that have to reach the user's inbox. Auth
exposes a `sendEmail` callback with plain default content, but the app developer
still has to bring an actual sender (vendor account, API integration, retries)
and styled templates — and the invitation flow has no send path at all. Stripe wants receipts and payment-failure
notices. The future jobs package wants digest/alert delivery. Email is the
single highest-leverage missing pillar: without it the stack is a toolkit, with
it auth/billing become genuinely turnkey.

It also carries the brand: emails authored as **Svelte components** — the same
mental model as the rest of the stack — is the package's "hell yeah" moment.

## Decisions (locked)

- **Default driver: Cloudflare Email Sending** (`send_email` Workers binding,
  public beta since 2026-04). Native binding, no API keys to manage.
- **Vendor parity**: Resend and SendGrid drivers ship in v1 so the package is
  not Cloudflare-locked (Email Sending requires Cloudflare DNS + Workers Paid).
- **Templates are Svelte components** SSR-rendered to email-safe HTML.
- Email package is **send-only** — no built-in queue/scheduling. Deferred or
  retried sends go through `@delightstack/jobs` once it exists.

## Package layout

Follows the standard conventions (see `packages/stripe` as the reference shape):

```
packages/email/
├── src/
│   ├── index.ts                       # re-exports server + types
│   ├── types/
│   │   └── index.ts                   # EmailMessage, EmailDriver, EmailConfig
│   ├── server/
│   │   ├── index.ts
│   │   ├── email.config.ts            # defineEmailConfig()
│   │   ├── email.handler.ts           # createEmailHandle()
│   │   ├── email.render.ts            # renderEmail(), htmlToText()
│   │   ├── email.preview.ts           # dev preview route logic
│   │   └── drivers/
│   │       ├── cloudflare.driver.ts
│   │       ├── resend.driver.ts
│   │       ├── sendgrid.driver.ts
│   │       └── dev.driver.ts
│   ├── templates/                     # email primitive components + defaults
│   │   ├── index.ts
│   │   ├── Email.svelte               # <html>/<head>/<body> shell, preview text
│   │   ├── Section.svelte
│   │   ├── Heading.svelte
│   │   ├── Text.svelte
│   │   ├── Button.svelte              # bulletproof table button
│   │   ├── Link.svelte
│   │   ├── Img.svelte
│   │   ├── Hr.svelte
│   │   ├── Code.svelte                # for OTP-style codes
│   │   └── defaults/                  # shipped auth templates (one per sendEmail type)
│   │       ├── VerifyEmail.svelte     # type: 'verification'
│   │       ├── ResetPassword.svelte   # type: 'password-reset'
│   │       ├── SignInLink.svelte      # type: 'magic-link'
│   │       ├── NewSignInMethod.svelte # type: 'new-signin-method'
│   │       └── OrgInvitation.svelte   # type: 'invitation' (new — see auth integration)
│   └── sveltekit/                     # (none needed in v1; reserve the entry)
├── vite.config.ts                     # vitest, environment: edge-runtime,
│                                      # @sveltejs/vite-plugin-svelte (like auth's)
├── tsconfig.json
├── package.json                       # exports: ., ./types, ./server, ./templates
└── README.md
```

`./templates` export must carry the `"svelte"` condition (like components) so
`.svelte` files resolve.

## Core types

```ts
export interface EmailMessage {
	to: string | string[];
	from?: string;                       // defaults to config.from
	reply_to?: string;                   // defaults to config.reply_to
	subject: string;
	html: string;
	text?: string;                       // auto-generated from html when omitted
	headers?: Record<string, string>;
}

/** EmailMessage after config defaults are applied; from is required */
export interface ResolvedEmailMessage extends EmailMessage {
	from: string;
	text: string;
}

export interface EmailDriver {
	/** Driver id used in logs/errors, e.g. 'cloudflare' | 'resend' | 'sendgrid' | 'dev' */
	id: string;
	send(message: ResolvedEmailMessage): Promise<{ id?: string }>;
}
```

Driver errors throw `DelightError` (status from the vendor response; `code:
'email/send_failed'`, `detail` = driver id). Drivers that don't support a field
(e.g. Cloudflare beta without attachments) throw `DelightError.badRequest` with
a clear message rather than silently dropping the field.

## Drivers

### cloudflareDriver

```ts
// wrangler (app worker):
// [[send_email]]
// name = "EMAIL"
// remote = true        # local dev sends through the real service

cloudflareDriver(binding: SendEmailBinding): EmailDriver
// send() maps directly: binding.send({ to, from, subject, html, text })
```

- Requires the sending domain onboarded in the dashboard (Email Service →
  Email Sending; Cloudflare DNS sets SPF/DKIM/DMARC automatically). Workers Paid.
- The binding type isn't in @cloudflare/workers-types yet (beta) — declare a
  minimal `SendEmailBinding` interface exported from `src/types/index.ts`
  (a normal exported interface, not a global ambient declaration, so apps can
  type their `Platform.env.EMAIL`); revisit when official types land.
- The beta API surface may grow (attachments are not documented yet). Keep
  `EmailMessage` the superset; this driver rejects unsupported fields loudly.

### resendDriver / sendgridDriver

```ts
resendDriver(options: { api_key: string }): EmailDriver
// POST https://api.resend.com/emails  { from, to, subject, html, text, reply_to, headers }

sendgridDriver(options: { api_key: string }): EmailDriver
// POST https://api.sendgrid.com/v3/mail/send  (personalizations format)
```

Both use `retryFetch` from `@delightstack/utilities` (handles 429/Retry-After).
No vendor SDKs — keep the dependency tree empty.

### devDriver

```ts
devDriver(options?: { log?: boolean; keep?: number }): EmailDriver
```

Logs a readable summary to console and retains the last `keep` (default 20)
rendered messages in memory for the preview route. Used automatically when
`dev: true` and no driver is configured, so a fresh app never accidentally
sends real email in dev.

## Config & handle

```ts
export interface EmailConfig {
	driver: EmailDriver;
	/** Default From: 'Name <addr@domain>' format accepted */
	from: string;
	reply_to?: string;
	dev?: boolean;
	/** Base path for the dev preview route @default '/api/email' */
	base_path?: string;
	/** Templates registered for the dev preview gallery (name → component + sample props) */
	preview_templates?: Record<string, { component: Component; sample_props: Record<string, unknown> }>;
}

export function defineEmailConfig(config: EmailConfig): ResolvedEmailConfig
// validates from format, fills base_path/dev defaults
```

```ts
export interface EmailLocals {
	email: {
		send(message: EmailMessage): Promise<{ id?: string }>;
		sendTemplate<P>(
			component: Component<P>,
			props: P,
			options: Omit<EmailMessage, 'html' | 'text'>,
		): Promise<{ id?: string }>;
	};
}

export function createEmailHandle(options: { config: ResolvedEmailConfig }): Handle
```

The handle:
1. Assigns `event.locals.email` (lazy — no work unless used).
2. **Dev only**: serves `GET {base_path}/preview` (list of captured sends +
   registered templates) and `GET {base_path}/preview/[name]` (renders a
   registered template with its sample props, returns the HTML so it displays
   in the browser). Singular route naming per repo convention. In production
   these routes return 404 unconditionally — assert this in tests.

`locals.email` is also constructible outside the handle (e.g. inside a DO):
`createEmailClient(config)` returns the same `{ send, sendTemplate }` object.
DOs (like auth's) receive it via their constructor options, not via locals.

## Rendering pipeline

```ts
export function renderEmail<P>(component: Component<P>, props: P): { html: string; text: string }
```

1. `render()` from `svelte/server` (works in Workers; auth already compiles
   `.svelte.ts` runes for tests, this package compiles full `.svelte` —
   vite config mirrors auth's plugin setup, build is the normal `svelte-package`).
2. Wrap body output: the `<Email>` primitive itself emits the full document
   (doctype, `<html>`, `<head>` with meta + dark-mode hints, hidden preview
   text, 600px centered table container) — `renderEmail` does not wrap anything.
3. `htmlToText()` — small walker, no deps: strip tags, `<a href>` → `label (url)`,
   headings upper-cased on their own line, `<hr>` → `---`, `<img>` → alt text,
   table cells separated by spaces / rows by newlines, collapse remaining
   whitespace. Callers can pass explicit `text` to override.

**Why no CSS inliner**: juice/cheerio are Node-bound (won't run in Workers) and
inlining is fragile. Instead the primitives emit inline `style="..."` directly
and use table layout. This is the documented constraint: **email templates must
compose the primitives (or hand-write inline styles)** — `<style>` blocks and
class-based styling are unsupported because email clients strip them.

### Primitives

All accept a `style` string prop merged after their defaults (escape hatch).
Color/spacing/font defaults are literal values mirroring @delightstack/styles
tokens (email clients can't resolve CSS custom properties) with a comment
cross-referencing the token name. Props are snake_case per repo convention
(e.g. `Button: { href, color?, full_width? }`).

- `Email` — props: `preview` (hidden preheader text), `lang`, `background`.
- `Button` — bulletproof: outer table + padded `<a>`, VML comment fallback for
  Outlook desktop.
- `Code` — large monospace box for OTP codes.
- Others are thin styled wrappers.

### Default auth templates

One per `sendEmail` type (see layout above) — props match exactly what auth's
callback provides (`link` + the per-type extras). Plain, neutral styling; apps
override per-type via `authEmailAdapter`'s `templates` option.

## Auth integration

**The seam already exists** — do not invent new hooks. `AuthConfig.email.sendEmail`
(packages/auth/src/server/auth.config.ts:99-114) is called at the route layer
for four flows, each providing `{ to, link, subject, html, text, type }` where
`type` is `'magic-link' | 'verification' | 'password-reset' | 'new-signin-method'`
and subject/html/text are plain defaults the app may use or replace
(call sites: auth.routes.ts:177, :262, :503, :574).

Integration = the email package ships an adapter that plugs into that callback:

```ts
import { authEmailAdapter } from '@delightstack/email/server';

createAuthHandle({
	config: { ...,
		email: {
			sendEmail: authEmailAdapter(emailClient, {
				// optional per-type template/subject overrides; defaults built in
				templates: { verification: MyVerifyEmail },
			}),
		},
	},
});
```

`authEmailAdapter(client, options?)` maps `type` → default Svelte template
(rendered with `{ link }` + branding props), overriding auth's plain-string
defaults with the rendered html/text. Apps that want auth's plain defaults
just keep using `sendEmail` directly — the adapter is sugar, not a requirement.

**The one genuine auth gap is org invitations**: `invitationCreate`
(auth.routes.ts:904) creates the invitation record but never generates an
invite URL or calls `sendEmail`. Required auth change (separate commit in
packages/auth): build the invite link in the route (same `base_url` pattern as
the other flows), extend the `type` union with `'invitation'`, and call
`config.email.sendEmail` with it — plus extra fields the template needs
(`org_name`, `inviter_name?`) added as optional properties on the callback
options. This is additive and backward-compatible (existing `sendEmail`
implementations ignore unknown fields and the new type).

Stripe receipt/payment-failed templates: explicitly **out of scope for v1**
(stripe's `onSubscriptionChange`/invoice hooks already exist; apps can wire
emails themselves; shipped templates can come later).

## Implementation checklist

1. Scaffold package (copy stripe's package.json/tsconfig/vite.config shape;
   add `./templates` export with svelte condition; peer dep `svelte ^5.36`).
2. Types + `defineEmailConfig` + tests.
3. Drivers (dev → resend → sendgrid → cloudflare) + tests with mocked
   fetch/binding. Cloudflare's `SendEmailBinding` ambient type.
4. `htmlToText` + tests (links, headings, hr, nested tables, whitespace).
5. Primitives + `renderEmail` + snapshot tests (html + text) — include an
   Outlook-conditional-comment assertion for Button.
6. Default auth templates (one per type) + `authEmailAdapter` + snapshots.
7. `createEmailHandle` + preview routes + tests (including prod-404).
8. Auth invitation-email support (separate commit in packages/auth): invite
   URL generation in invitationCreate, `'invitation'` type, extra fields + tests.
9. example-app wiring: `[[send_email]]` binding in wrangler.jsonc,
   `email.sendEmail: authEmailAdapter(...)`, and `Platform.env` type for `EMAIL`.
10. README + docs page (apps/docs gets a package guide like the other 7):
    must lead with the driver decision table — Cloudflare (needs CF DNS +
    Workers Paid, zero keys) vs Resend (any DNS, api key).
11. Changeset.

## Testing strategy

- Unit: drivers (fetch mocked), render snapshots, text fallback, config validation.
- Integration: handle preview routes via fake RequestEvents (see stripe's
  routes tests for the pattern).
- Manual: `pnpm dev:example` + `/api/email/preview` gallery; one real send via
  Resend test key before release.

## Risks & mitigations

- **Email Sending beta moves** — minimal ambient types we own; superset
  message type; drivers reject what they can't do, loudly.
- **CF DNS + paid plan requirement** — docs lead with the alternative; the dev
  driver means the package works with zero setup in dev.
- **Email client rendering** — primitives are conservative (tables, inline
  styles, VML fallback); snapshot tests freeze the output; recommend a manual
  Litmus/clients pass before 1.0.
- **Template authors using unsupported Svelte/CSS features** — document the
  constraint prominently; the preview route makes violations visible immediately.
