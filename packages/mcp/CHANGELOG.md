# @delightstack/mcp

## 0.2.3

### Patch Changes

- Updated dependencies [0964acc]
  - @delightstack/utilities@1.3.2

## 0.2.2

### Patch Changes

- Updated dependencies [8a84565]
  - @delightstack/utilities@1.3.1

## 0.2.1

### Patch Changes

- Updated dependencies [3112675]
  - @delightstack/utilities@1.3.0

## 0.2.0

### Minor Changes

- b61ed37: `@delightstack/mcp` — a Model Context Protocol server for Cloudflare Workers.

  Three pieces that compose: the Streamable HTTP transport as a plain `fetch` handler, a tool
  registry that publishes JSON Schema and validates against it, and an OAuth 2.1 provider complete
  enough that `claude mcp add https://…/mcp` finishes on its own.

  `createMcpServer({ name, version, instructions, tools })` returns `{ fetch, tools }`. The
  transport speaks protocol versions `2025-06-18` and `2025-03-26` — the `initialize` handshake,
  JSON-RPC over POST including batches, `Mcp-Session-Id` sessions through an injected store, an SSE
  stream on GET, and `DELETE` to end a session. An unknown requested version is negotiated down to
  the newest supported one rather than refused, because refusing turns a version skew into "the
  server is down". Revision `2026-07-28` — which removes sessions and the GET stream and moves the
  handshake into per-request `_meta` — is not implemented; no shipping client sends it yet, and the
  negotiation already hands such a client a version it can fall back to.

  Tools are defined once. The `input` map compiles to the `inputSchema` that `tools/list` publishes
  and is what arguments are checked against on the way in, by a hand-written validator covering the
  subset a tool surface actually needs: objects, strings, numbers, integers, booleans, arrays,
  enums, and bounds. It does not coerce — `"5"` is not a number — because a model that sends the
  wrong type has made a mistake worth telling it about, and coercion teaches it the mistake works.
  `null` is treated as absent, since models emit it for "no value" far more often than they omit the
  key. A tool may name one `scope`; a caller without it neither sees the tool nor can call it, and
  the comparison is injectable because scopes are frequently a ladder rather than a set.

  The transport authenticates POST, GET and DELETE alike — an anonymous `DELETE` would otherwise end
  a session it was never shown a token for — binds an `Mcp-Session-Id` to the principal that opened
  it, and caps a batch at `max_batch_size` messages.

  `createOauthProvider` is the authorization server and the resource server. It serves RFC 9728
  protected resource metadata and RFC 8414 authorization server metadata, implements RFC 7591
  dynamic client registration, and requires PKCE `S256` on every authorization request — `plain` is
  refused and never advertised. Authorization codes are single-use and short-lived, taken and
  deleted in one store call so there is no window in which one redeems twice. Redirect URIs match
  exactly, never by prefix, because a prefix match on a loopback URI lets any path on the same port
  collect the code. Every token records the resource it was minted for and is refused at the door if
  that is not this server. Refresh rotates in place, so the old access token stops working and a
  revocation survives the rotation, and a refresh may narrow a grant but never widen it; a token
  store that implements the optional `getByPreviousRefreshHash` also gets OAuth 2.1 §4.3.1 reuse
  detection, where replaying a superseded refresh token revokes the family it came from. A
  registered redirect URI may be https, loopback http, or a reverse-DNS private-use scheme and
  nothing else, and registration runs an injected rate limiter before it writes a row. Client
  secrets, codes, access tokens and refresh tokens are stored only as SHA-256 digests.

  Every store is injected — clients, codes, tokens, sessions — as is the consent screen, which
  belongs to the application's design system rather than to a library, and the rate limiter, because
  the only correct counter on Workers lives in a Durable Object the application owns. In-memory
  implementations ship for tests and `vite dev`, and are documented as wrong for production: an
  isolate can recycle between the authorization redirect and the token exchange.

  Zero runtime dependencies beyond `@delightstack/utilities`, and no `node:` imports anywhere —
  everything cryptographic goes through Web Crypto. A separate workerd suite runs the shipped code
  inside the runtime with no `nodejs_compat` flag, so a stray Node import fails there and only
  there. 148 tests in the node suite, 4 in workerd.

  `@delightstack/mcp/sveltekit` adds `createMcpHandle`, which returns the server alongside the
  handle: an in-app agent panel is a second client of the same tool implementations and should not
  have to make an HTTP request to itself.

### Patch Changes

- 8d69525: Every relative import in the built `dist/` is now a complete ESM specifier.

  The source files imported their siblings the way a bundler lets you — `from './error.helper'`,
  `from './helpers'`, `from './auth.client.svelte'` — and `svelte-package` copies specifiers
  through untouched, so the published `dist/` inherited them. Vite, esbuild and Rollup resolve
  those by probing for extensions and `index` files; Node's ESM loader does not. So the packages
  worked in every bundled context and failed the moment plain Node imported them — a SvelteKit
  SSR render step, a Vitest file that had not inlined the dependency, a one-off script — with
  `Cannot find module`.

  Relative specifiers now carry `.js` (a `.svelte.ts` rune module is `./x.svelte.js`), and
  directory imports name their `index.js`. `scripts/check-dist-specifiers.mjs`, wired into the
  root `build` and `test`, walks every `packages/*/dist/**/*.js` and fails the build on an
  incomplete relative specifier, so this cannot come back. No public API changed.

- Updated dependencies [8d69525]
  - @delightstack/utilities@1.2.2
