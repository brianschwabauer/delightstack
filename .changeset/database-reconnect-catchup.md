---
'@delightstack/database': minor
---

`DatabaseClient` catches up after its live channel drops. Changes made while the websocket was down never arrived, and only a page reload synced them. The new optional `onReconnect` hook in `DatabaseClientHooks` (supplied by `@delightstack/websocket`'s `databaseHooks()`) runs a catch-up sync from the stored cursor every time the channel comes back.

`db.list()` takes a third argument, `{ debounce }`, the quiet window (ms) a reactive query waits before re-running. The default stays 150ms, which suits typing. Pass `0` for queries keyed by an id the user steps through (a thread or record viewer), so each step answers immediately instead of waiting out the window.
