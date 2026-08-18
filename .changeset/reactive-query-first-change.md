---
'@delightstack/database': patch
---

Fix the reactive list handle permanently serving a stale query. `db.list(entity, () => query)` subscribed with the constructor-time query snapshot while the query watcher `$effect` skipped its first run — so a query-function value that changed between handle construction and the first effect flush (e.g. a `where` built from another query's results, or props set during mount) was swallowed permanently: the worker subscription kept answering the stale query forever, and server-routed entities (which get no local-write notifications) never re-queried at all. The watcher now compares against the query actually sent (subscribe, subscription update, or one-shot run), records it synchronously before subscribing, and re-pushes after subscribe resolves if the query moved in flight.
