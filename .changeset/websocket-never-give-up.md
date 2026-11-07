---
'@delightstack/websocket': minor
---

A long-idle tab no longer goes permanently offline. The worker gave up after 20 reconnect attempts (about 8 minutes), so a laptop that slept through an outage stayed disconnected until the page was reloaded. It now:

- retries forever, with the backoff still capped at 30s;
- treats a socket that has delivered nothing (not even the server's auto-pong) for 70s as dead and replaces it, instead of trusting a connection that only looks open after sleep or a network change;
- re-checks the connection when the tab becomes visible, regains focus, or the network comes back. A connection that is down reconnects at once; one that looks up is probed with a ping and replaced if nothing answers within 5s. Call `ws.checkConnection()` to trigger the same check yourself.

New `ws:reconnected` event fires when the socket comes back after a drop, and `databaseHooks()` now supplies `onReconnect`, so a `DatabaseClient` catches up on the changes it missed while disconnected. `ws:disconnected` now also fires when a live socket drops into `reconnecting`, and `isLive`'s grace window starts at that moment.
