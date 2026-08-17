---
'@delightstack/websocket': minor
---

`filterEntityChange` gates entity-change broadcasts per session.

`entityChanged` (and the batched `entitiesChanged`) sent every `entity:*` frame to every socket in the room, so any client that could connect saw every write regardless of what that user was allowed to read. `WebsocketServerConfig` now takes an optional `filterEntityChange(change, session)` — return `false` to withhold that event from that session. `change` carries `{ action, entity_type, id }`; the payload is deliberately not passed, so the decision is made on identity, not on data the filter would have to trust.

Only `entity:*` events pass through the gate — presence (`session:*`) and custom `broadcast()` calls are untouched, and with no filter configured the existing single-serialize broadcast path runs exactly as before. When a filter is configured the message is still serialized **once** and reused for every admitted socket, so the cost of the gate is one predicate call per session, not one `JSON.stringify` per session. A filter that throws withholds the event from that one session and logs once per broadcast; the rest of the room is unaffected.

Session metadata is captured at connect time and restored from the hibernation attachment, so a permission change takes effect when the client reconnects, not mid-connection.
