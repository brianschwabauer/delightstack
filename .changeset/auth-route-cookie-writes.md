---
'@delightstack/auth': patch
---

Fix preference and org-state writes being silently dropped on auth routes. `PATCH /preference` and `PATCH /org/:id/state` answered `200` with the merged data, but the cookie never reached the browser: SvelteKit only attaches `event.cookies` to responses that go through `resolve()`, and auth routes return their own `Response` — only the session cookie was being serialized by hand. So `auth.setPreferences()` looked like it worked and then read back empty on the next request, taking anything built on it (first-run hints, dark mode, cached org data) with it. Both cookies (and the org-state deletions on sign-out) are now serialized onto the response alongside the session cookie.
