# @delightstack/presence

Real-time **presence** for Svelte 5 — an online roster, live cursors, cursor
chat, reactions, and field/cell presence — layered on a **swappable** transport
and identity.

The core depends on just two small interfaces (`PresenceTransport` and
`PresenceIdentity`), so the `@delightstack/websocket` and `@delightstack/auth`
integrations are **optional**: drop in any equivalent that implements the same
ports.

```svelte
<script>
	import { createDelightPresence } from '@delightstack/presence/adapters';
	import { setPresence } from '@delightstack/presence';
	import { PresenceAvatars, Cursors, Reactions } from '@delightstack/presence/components';
	import { trackCursor, fieldPresence } from '@delightstack/presence';

	let { data } = $props(); // { ws, auth } from your load fn
	const presence = createDelightPresence({ ws: data.ws, auth: data.auth });
	setPresence(presence);
	$effect(() => {
		presence.start();
		return () => presence.destroy();
	});
</script>

<header><PresenceAvatars /></header>

<main data-presence-stage {@attach trackCursor({ chat: true })}>
	<Cursors />
	<Reactions bar={['👍', '🎉', '❤️', '😂', '😮']} />
	<input name="email" {@attach fieldPresence('user.email')} />
</main>
```

## Entry points

| Import | Contents |
| --- | --- |
| `@delightstack/presence` | `PresenceClient`, `setPresence`/`getPresence`, `trackCursor`, `fieldPresence`, types |
| `@delightstack/presence/adapters` | `createDelightPresence`, `websocketTransport`, `authIdentity` (optional peer deps) |
| `@delightstack/presence/components` | `PresenceAvatars`, `Cursors`, `Reactions`, `FieldPresence` |
| `@delightstack/presence/server` | `createPresenceServer`, `PRESENCE_EPHEMERAL_EVENTS` |
| `@delightstack/presence/core` | framework-agnostic helpers (awareness, coordinates, color) |
| `@delightstack/presence/types` | shared types only |

## Server setup

Presence rides on the websocket server's custom-message channel. Compose the
server module into your Durable Object so `presence:*` messages are relayed,
new joiners get an instant snapshot, and cursor traffic uses a generous rate
bucket.

```ts
// src/worker.ts
import { WebsocketServer } from '@delightstack/websocket/worker';
import { createPresenceServer, PRESENCE_EPHEMERAL_EVENTS } from '@delightstack/presence/server';

export class WebsocketDO extends WebsocketServer {
	constructor(ctx: DurableObjectState, env: Env) {
		const presence = createPresenceServer();
		super(
			{
				onMessage: presence.onMessage, // also chains your own via createPresenceServer({ onMessage })
				onDisconnect: presence.onDisconnect,
				rate_limit: { ephemeral_events: PRESENCE_EPHEMERAL_EVENTS },
			},
			ctx,
			env,
		);
	}
}
```

The snapshot map is in-memory per Durable Object and intentionally not
persisted: clients re-announce after a hibernation wake, and client-side TTL is
the ultimate backstop.

## Features

### Online facepile — `<PresenceAvatars />`

A deduplicated roster of online org members (merged across each user's tabs)
with status dots, idle dimming, overflow `+N`, and hovercards.

```svelte
<PresenceAvatars size={32} max={5} scope="org" />
<!-- scope="page" shows only users on the same page -->
```

### Live cursors — `trackCursor` + `<Cursors />`

`trackCursor` publishes the local pointer relative to the nearest
`data-presence-stage` element (or the document root). Coordinates are normalized
so cursors land on the same logical point across viewport sizes. `<Cursors />`
renders remote cursors for peers on the same page, spring-smoothed and faded when
idle.

```svelte
<main data-presence-stage {@attach trackCursor()}>
	<Cursors />
</main>
```

### Cursor chat

Enable Figma-style cursor chat with `trackCursor({ chat: true })`: pressing `/`
opens an inline input whose text rides along your cursor for everyone else, then
lingers briefly after you hit Enter.

### Reactions — `<Reactions />`

Fire-and-forget emoji that float up from the sender's cursor (or bottom-center).
Pass `bar` to render a trigger row; or call `presence.react('🎉')` from your own UI.

```svelte
<Reactions bar={['👍', '🎉', '❤️']} />
```

### Field / cell presence — `fieldPresence`

Reports the local user's focus and surfaces other users' focus as a colored ring
+ name badge — a soft-lock "Bob is editing this" heads-up. The `anchor` is a
stable id shared across clients.

```svelte
<input name="email" {@attach fieldPresence('user.email')} />
<!-- or wrap a container -->
<FieldPresence anchor="row-42">{@render cell()}</FieldPresence>
```

## Swappable transport / identity

The core never imports websocket or auth. To use a different stack, implement the
two ports and construct `PresenceClient` directly:

```ts
import { PresenceClient } from '@delightstack/presence';
import type { PresenceTransport, PresenceIdentity } from '@delightstack/presence';

const transport: PresenceTransport = {
	get connected() { return socket.isConnected; },
	get sessions() { return socket.members.map((m) => ({ id: m.id })); },
	send: (msg) => socket.publish('presence', msg),
	on: (handler) => socket.subscribe('presence', handler), // returns unsubscribe
};

const identity: PresenceIdentity = {
	get user() { return me ? { id: me.id, name: me.name, image: me.avatar } : null; },
	get orgId() { return me?.orgId ?? null; },
};

const presence = new PresenceClient({ transport, identity });
```

Your transport must relay every `presence:*` message room-wide. With
`@delightstack/websocket` that's what `createPresenceServer` does.

## How it works

- **Awareness model.** Each tab owns a small ephemeral `state` object (page,
  cursor, message, focus, status, custom). Changes broadcast as `presence:update`
  with a monotonic `clock`; peers merge with last-writer-wins. State is never
  persisted and clears on disconnect (graceful `presence:remove`, or TTL).
- **Per-tab keys.** A SharedWorker-based transport shares one connection across a
  browser's tabs, so presence is keyed by a per-tab `presence_id`, not the
  connection id. Cursors filter out your own user by default.
- **Joins.** A newcomer sends `presence:request`; the server replies with a
  `presence:snapshot` to just that client. Without a server module, peers
  re-announce on request.
- **Rate.** Cursor updates are throttled client-side (~22/s) and use the
  websocket server's generous ephemeral bucket so they aren't rejected.

## Notes

- **SSR-safe.** All browser work is guarded; components render nothing on the
  server. Call `presence.start()` in an `$effect`.
- **Accessible.** Cursors and reaction layers are `aria-hidden`; motion respects
  `prefers-reduced-motion`.
- **Colors.** Each user gets a stable vivid color from their id (override via the
  `color` option).
```
