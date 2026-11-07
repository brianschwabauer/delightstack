---
'@delightstack/auth': minor
---

The session cookie now survives a browser restart. It was serialized with no `Max-Age`, which made it a browser-session cookie: closing the browser dropped it and signed the user out every time. Session, preference and org-state cookies now carry `Max-Age` from the new `session.max_age` config (default 400 days, the browser cap). The cookie is re-issued on every JWT refresh, so the window rolls with use.

The server side matches: `AuthDatabaseServer` keeps an idle session refreshable for the new `session_max_age` option (default 400 days, was a hard-coded 30), and `session_expires_in` sets the JWT lifetime (default 1 hour, unchanged). Keep `session.max_age` and `session_max_age` in step.

`session.expires_in` on the auth config is deprecated: nothing ever read it. Set `session_expires_in` on the `AuthDatabaseServer` options instead.
