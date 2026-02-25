# @delightstack/websocket

Real-time WebSocket layer for SvelteKit apps on Cloudflare Workers. Room-scoped connections, reactive presence tracking, typed custom events, and DatabaseClient integration — all backed by a single Durable Object per room with hibernation support.

## Features

- **Room-scoped connections** — One Durable Object per room/org. All WebSocket connections within a room share the same instance, enabling broadcast and presence tracking.
- **Hibernation API** — Uses Cloudflare's WebSocket Hibernation API for efficient connection management. The DO sleeps between messages and recovers session state from serialized attachments.
- **SharedWorker multiplexing** — A single SharedWorker manages WebSocket connections across all browser tabs. Tab count tracking ensures the connection stays alive while any tab is open.
- **Reactive presence** — `ws.sessions` is a Svelte 5 `$state` array that auto-updates from `session:list`, `session:connected`, and `session:disconnected` events. Always up-to-date when your listeners fire.
- **Typed custom events** — Pass a custom event map as a generic parameter for fully typed `on()` and `once()` listeners, while built-in events remain typed automatically.
- **Typed session metadata** — Generic `Meta` parameter controls the shape of session metadata. Defaults to `AuthSessionMeta` for apps using `@delightstack/auth`. Pass your own type for custom metadata.
- **Lifecycle hooks** — `onConnect`, `onDisconnect`, and `onMessage` hooks on the server for side effects like logging, analytics, or database writes.
- **Automatic reconnection** — Exponential backoff with jitter (1s → 30s cap, 20 max attempts) and 30s client-side ping keep-alive.
- **Rate limiting** — Built-in token bucket rate limiter on the server (per session, configurable burst and refill).
- **DatabaseClient integration** — `ws.databaseHooks()` wires entity change events into `DatabaseClient` for automatic real-time sync of local search indexes.
- **SvelteKit Handle** — `createWebsocketHandle()` intercepts upgrade requests, authorizes via `@delightstack/auth` locals or a custom callback, and forwards to the Durable Object.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                        │
│                                                                 │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐                      │
│  │  Tab 1   │  │  Tab 2    │  │  Tab 3   │    WebsocketClient   │
│  │  (Svelte)│  │  (Svelte) │  │  (Svelte)│    per tab           │
│  └────┬─────┘  └─────┬─────┘  └─────┬────┘                      │
│       │              │              │                           │
│       └──────────────┼──────────────┘                           │
│                      │  BroadcastChannel (per room)             │
│               ┌──────┴──────┐                                   │
│               │ SharedWorker│  Single WebSocket per room        │
│               │  (Comlink)  │  Tab counting, reconnection       │
│               └──────┬──────┘                                   │
└──────────────────────┼──────────────────────────────────────────┘
                       │  wss://
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  Cloudflare Worker                                               │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  createWebsocketHandle()                                   │  │
│  │  1. Match /api/websocket upgrade requests                  │  │
│  │  2. Authorize (auth locals or custom callback)             │  │
│  │  3. Forward to Durable Object with session metadata        │  │
│  └────────────────────────┬───────────────────────────────────┘  │
│                           │  RPC                                 │
│                           ▼                                      │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  WebsocketServer (Durable Object, one per room)            │  │
│  │                                                            │  │
│  │  • Hibernation API (sleep between messages)                │  │
│  │  • Session tracking with serialized attachments            │  │
│  │  • Broadcast, presence, entity change notifications        │  │
│  │  • Rate limiting (token bucket per session)                │  │
│  │  • Lifecycle hooks (onConnect, onDisconnect, onMessage)    │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

**SharedWorker multiplexing:** The browser runs a single SharedWorker that holds one WebSocket per room. Multiple tabs subscribe via BroadcastChannel. When the last tab disconnects, the worker tears down the connection. In dev mode, a regular Worker is used instead (Vite HMR doesn't support SharedWorker).

**Hibernation API:** The Durable Object uses `acceptWebSocket()` and hibernation callbacks (`webSocketMessage`, `webSocketClose`, `webSocketError`). Between messages, the DO can be evicted from memory. On wake, it recovers session metadata from `deserializeAttachment()`. Automatic ping/pong is handled by `setWebSocketAutoResponse()`.

**Room isolation:** Each room (typically an org_id) gets its own Durable Object instance. Connections in different rooms are completely isolated — no cross-room broadcasts or presence leakage.

## Quickstart

### 1. Create the Durable Object

```typescript
// src/lib/server/websocket.do.ts
import { WebsocketServer } from '@delightstack/websocket/server';

export class WebsocketDO extends WebsocketServer {
	constructor(ctx: DurableObjectState, env: Env) {
		super({}, ctx, env);
	}
}
```

### 2. Add to `wrangler.toml`

```toml
[[durable_objects.bindings]]
name = "WS"
class_name = "WebsocketDO"
```

### 3. Wire the SvelteKit Handle

```typescript
// src/hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';
import { createWebsocketHandle } from '@delightstack/websocket/server';

const websocketHandle = createWebsocketHandle({
	getWebsocket: (event) => {
		const locals = event.locals as AuthLocals & App.Locals;
		if (!locals.org_id) return undefined;
		const platform = event.platform as App.Platform;
		return platform.env.WS.get(platform.env.WS.idFromName(locals.org_id));
	},
});

export const handle = sequence(authHandle, websocketHandle);
```

### 4. Connect from the client

```typescript
// src/lib/websocket.ts
import { WebsocketClient } from '@delightstack/websocket/client';

export const ws = new WebsocketClient({ dev: import.meta.env.DEV });
```

```svelte
<script>
	import { ws } from '$lib/websocket';
	import { org_id } from '$lib/auth'; // from AuthClient or similar

	$effect(() => {
		ws.connect(org_id);
		return () => ws.disconnect();
	});
</script>

<p>Status: {ws.status}</p><p>Online: {ws.sessions.length} users</p>
```

## Server

### WebsocketServerConfig

| Option                            | Type                                            | Default | Description                                                                                 |
| --------------------------------- | ----------------------------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| `onMessage`                       | `(message, session, server) => message \| void` | —       | Handle incoming client messages. Return a message to reply, or void.                        |
| `onConnect`                       | `(session, server) => void`                     | —       | Called after connection setup (session:list sent, session:connected broadcast).             |
| `onDisconnect`                    | `(session, server) => void`                     | —       | Called after disconnect (session:disconnected broadcast). Session metadata still available. |
| `rate_limit.max_tokens`           | `number`                                        | `30`    | Max burst size for the token bucket rate limiter.                                           |
| `rate_limit.refill_every_seconds` | `number`                                        | `10`    | Seconds between token refills (1 token per interval).                                       |

### WebsocketServer API

| Method                                                    | Description                                                                        |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `broadcast(message, exclude?)`                            | Send a message to all connected clients. Optionally exclude one WebSocket.         |
| `send(ws, message)`                                       | Send a message to a specific connection.                                           |
| `entityChanged(action, entity_type, id, data?, user_id?)` | Broadcast an entity change event (called by DatabaseServer after CRUD operations). |
| `getActiveSessions()`                                     | Returns metadata for all active sessions (filters out closed/closing connections). |

### Lifecycle hooks

```typescript
export class WebsocketDO extends WebsocketServer {
	constructor(ctx: DurableObjectState, env: Env) {
		super(
			{
				onConnect: (session, server) => {
					console.log(`${session.meta?.user_name} joined`);
					console.log(`${server.getActiveSessions().length} users online`);
				},
				onDisconnect: (session) => {
					console.log(`${session.meta?.user_name} left`);
				},
				onMessage: (msg, session, server) => {
					if (msg.event === 'chat:message') {
						server.broadcast(msg); // relay to everyone
					}
				},
			},
			ctx,
			env,
		);
	}
}
```

### Custom metadata

```typescript
interface MyMeta {
	role: string;
	color: string;
}

export class WebsocketDO extends WebsocketServer<MyMeta> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(
			{
				onConnect: (session) => {
					console.log(session.meta?.role); // typed as string | undefined
				},
			},
			ctx,
			env,
		);
	}
}
```

## Handle

### WebsocketHandleOptions

| Option         | Type                                   | Default            | Description                                                                             |
| -------------- | -------------------------------------- | ------------------ | --------------------------------------------------------------------------------------- |
| `path`         | `string`                               | `'/api/websocket'` | URL path to intercept for WebSocket upgrades.                                           |
| `getWebsocket` | `(event) => { fetch } \| undefined`    | —                  | Returns the DO stub for the given request. Return `undefined` if unavailable.           |
| `authorize`    | `(event) => session_meta \| undefined` | Auth locals        | Custom authorization. Return session metadata to allow, `undefined` to reject with 401. |

### Default authorization

When no `authorize` callback is provided, the handle uses `@delightstack/auth` locals:

```typescript
// Checks locals.session, locals.user, locals.org_id, locals.org
// Returns: { room: org_id, meta: { user_id, user_name, user_auth_id, user_session_id, permission } }
// Returns undefined (401) if any are missing
```

### Custom authorization

```typescript
const websocketHandle = createWebsocketHandle({
	authorize: (event) => {
		const token = event.url.searchParams.get('token');
		const user = verifyToken(token);
		if (!user) return undefined;
		return { room: 'my-room', meta: { user_id: user.id, role: user.role } };
	},
	getWebsocket: (event) => {
		const platform = event.platform as App.Platform;
		const room = event.url.searchParams.get('room') ?? 'default';
		return platform.env.WS.get(platform.env.WS.idFromName(room));
	},
});
```

## Client

### WebsocketClientConfig

| Option | Type      | Default            | Description                                                         |
| ------ | --------- | ------------------ | ------------------------------------------------------------------- |
| `path` | `string`  | `'/api/websocket'` | WebSocket endpoint path (used to build URL from `window.location`). |
| `url`  | `string`  | —                  | Full WebSocket URL override. Takes precedence over `path`.          |
| `dev`  | `boolean` | `false`            | Use regular Worker instead of SharedWorker (for Vite HMR).          |

### Reactive state

| Property       | Type                           | Description                                                       |
| -------------- | ------------------------------ | ----------------------------------------------------------------- |
| `ws.status`    | `ConnectionStatus`             | `'disconnected' \| 'connecting' \| 'connected' \| 'reconnecting'` |
| `ws.connected` | `boolean`                      | Derived from `status === 'connected'`                             |
| `ws.sessions`  | `readonly SessionInfo<Meta>[]` | Currently connected sessions. Auto-updates from session events.   |

All properties are Svelte 5 `$state`/`$derived` and trigger reactive updates in templates.

### Methods

| Method                  | Description                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `connect(room)`         | Connect to a room. Safe to call multiple times — handles room switching automatically. |
| `disconnect()`          | Disconnect and clean up. Event listeners are preserved for reconnection.               |
| `destroy()`             | Full teardown — disconnects and removes all event listeners.                           |
| `send(message)`         | Send a message to the server. Throws if not connected.                                 |
| `on(event, callback)`   | Subscribe to an event. Returns an unsubscribe function.                                |
| `once(event, callback)` | Subscribe to an event once. Auto-removes after first invocation.                       |
| `databaseHooks()`       | Returns hooks for `DatabaseClientConfig.hooks` (real-time entity sync).                |

### Event listeners

```typescript
// Built-in events (always typed)
ws.on('session:connected', (msg) => {
	console.log(msg.ws_session_id, msg.meta?.user_name, msg.num_connections);
});

ws.on('session:disconnected', (msg) => {
	console.log(msg.ws_session_id, msg.num_connections);
});

ws.on('session:list', (msg) => {
	console.log(msg.sessions); // full session list on connect
});

ws.on('entity:created', (msg) => {
	console.log(msg.entity_type, msg.id, msg.data);
});

ws.on('error', (msg) => {
	console.log(msg.message, msg.status);
});

// Transport lifecycle
ws.on('ws:connected', () => console.log('WebSocket connected'));
ws.on('ws:disconnected', () => console.log('WebSocket disconnected'));

// Wildcard — receives all events
ws.on('*', (msg) => console.log(msg.event));

// String fallback — any event name works at runtime
ws.on('my-custom-event', (msg) => console.log(msg));
```

### Typed custom events

Pass a custom event map as the second generic parameter for full type inference:

```typescript
type MyEvents = {
	'chat:message': { event: 'chat:message'; text: string; sender: string };
	'cursor:move': { event: 'cursor:move'; x: number; y: number };
};

const ws = new WebsocketClient<AuthSessionMeta, MyEvents>();

ws.on('chat:message', (msg) => {
	msg.text; // string
	msg.sender; // string
});

ws.on('cursor:move', (msg) => {
	msg.x; // number
	msg.y; // number
});

// Built-in events still fully typed
ws.on('session:connected', (msg) => msg.meta?.user_name);
```

### Presence tracking

```svelte
<script>
	import { ws } from '$lib/websocket';
</script>

{#if ws.connected}
	<p>{ws.sessions.length} user(s) online</p>
	<ul>
		{#each ws.sessions as session}
			<li>{session.meta?.user_name ?? 'Anonymous'}</li>
		{/each}
	</ul>
{/if}
```

`ws.sessions` updates before event listeners fire, so `ws.sessions` is always current inside `on('session:connected', ...)` callbacks.

### DatabaseClient integration

Wire WebSocket entity change events into `DatabaseClient` for automatic real-time sync:

```typescript
import { WebsocketClient } from '@delightstack/websocket/client';
import { DatabaseClient } from '@delightstack/database/client';

const ws = new WebsocketClient({ dev: import.meta.env.DEV });
const db = new DatabaseClient({
	tables,
	db_name: `org:${org_id}`,
	hooks: ws.databaseHooks(),
});
```

When the server broadcasts `entity:created`, `entity:updated`, or `entity:deleted`, the DatabaseClient automatically syncs the affected entity type, keeping local Orama indexes and all reactive searches up to date.

## Built-in Events

| Event                  | Direction                   | Description                                                                            |
| ---------------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| `session:list`         | Server → Client             | Sent to a newly connected client with all active sessions.                             |
| `session:connected`    | Server → Client (broadcast) | Broadcast when a new user connects.                                                    |
| `session:disconnected` | Server → Client (broadcast) | Broadcast when a user disconnects.                                                     |
| `entity:created`       | Server → Client (broadcast) | Entity was created (from `entityChanged()`).                                           |
| `entity:updated`       | Server → Client (broadcast) | Entity was updated.                                                                    |
| `entity:deleted`       | Server → Client (broadcast) | Entity was deleted.                                                                    |
| `error`                | Server → Client (direct)    | Error sent to a specific connection (parse error, rate limit, etc.).                   |
| `ping` / `pong`        | Bidirectional               | Keep-alive handled automatically by hibernation API and client worker.                 |
| `__ws_status`          | Worker → Client (internal)  | Internal status broadcast from SharedWorker to tabs. Not dispatched to user listeners. |

## Reconnection

The SharedWorker handles reconnection automatically with exponential backoff:

```
Attempt 1:  ~1s    (1000ms × 2⁰ ± 30% jitter)
Attempt 2:  ~2s    (1000ms × 2¹ ± 30% jitter)
Attempt 3:  ~4s    (1000ms × 2² ± 30% jitter)
...
Attempt 15: ~30s   (capped at 30s)
Attempt 20: ~30s   (last attempt, then gives up)
```

The client also sends a `ping` every 30 seconds to detect dead connections and keep the WebSocket alive through proxies. The server responds with `pong` via the hibernation auto-response.

## Rate Limiting

The server applies a token bucket rate limiter per session:

- **Default:** 30 tokens max, refills 1 token every 10 seconds
- When a client exceeds the limit, it receives an `error` event with status 429
- Stale buckets (inactive >10 minutes) are cleaned up when the map exceeds 100 entries

```typescript
export class WebsocketDO extends WebsocketServer {
	constructor(ctx: DurableObjectState, env: Env) {
		super(
			{
				rate_limit: {
					max_tokens: 50,
					refill_every_seconds: 5,
				},
			},
			ctx,
			env,
		);
	}
}
```

## Types

### Session metadata

```typescript
// Default metadata (when using @delightstack/auth)
type AuthSessionMeta = {
	user_id?: string;
	user_name?: string;
	user_auth_id?: string;
	user_session_id?: string;
	permission?: number;
};

// Full session metadata (stored in WS attachment)
interface WebsocketSessionMeta<Meta = AuthSessionMeta> {
	ws_session_id: string; // unique per connection, generated by the DO
	room?: string; // room/org ID
	meta?: Meta; // app-specific metadata
}

// Client-side session info (used by ws.sessions)
type SessionInfo<Meta> = {
	ws_session_id: string;
	meta?: Meta;
};
```

### Message types

```typescript
type WebsocketMessage =
	| EntityChangedMessage // entity:created/updated/deleted
	| SessionConnectedMessage // session:connected
	| SessionDisconnectedMessage // session:disconnected
	| SessionListMessage // session:list
	| ErrorMessage // error
	| PingMessage // ping
	| PongMessage // pong
	| CustomMessage; // { event: string; [key: string]: unknown }
```

## Design Decisions

**Why a SharedWorker?** Multiple tabs in the same app would each open their own WebSocket connection, doubling presence counts and wasting server resources. A SharedWorker holds a single connection per room and fans out events to all tabs via BroadcastChannel. Tab counting ensures the connection is torn down only when the last tab closes.

**Why BroadcastChannel (not MessagePort)?** BroadcastChannel is simpler than managing MessagePort pairs and naturally supports the one-to-many fan-out pattern. All tabs listening on the same channel name receive every message. No need to track which tabs exist or route messages manually.

**Why Comlink?** The SharedWorker communicates via `postMessage`, which is awkward for async RPC. Comlink wraps it in a proxy that looks like regular async method calls (`worker.connect()`, `worker.send()`). This keeps the client code clean without manually serializing/deserializing messages.

**Why room-scoped Durable Objects?** One DO per room means all connections in a room share the same in-memory state (sessions map, rate limit buckets). Broadcast is a simple loop over `ctx.getWebSockets()`. No external pub/sub or message broker needed. Different rooms are fully isolated.

**Why not store presence in SQLite?** Session data is ephemeral — it only matters while the connection is alive. Storing it in the DO's in-memory `Map` (with serialized attachment for hibernation recovery) is simpler and faster than writing to SQLite on every connect/disconnect.

**Why separate `onConnect`/`onDisconnect` from `onMessage`?** Connection lifecycle events have different semantics than client messages. `onConnect` fires after the WebSocket is fully set up (session:list sent, session:connected broadcast), so it's safe to use for side effects. `onMessage` only fires for client-sent messages, after rate limiting and validation.

## Exports

### `@delightstack/websocket/server`

| Export                   | Description                                             |
| ------------------------ | ------------------------------------------------------- |
| `WebsocketServer`        | Durable Object base class for WebSocket rooms           |
| `WebsocketServerConfig`  | Type for `WebsocketServer` constructor config           |
| `createWebsocketHandle`  | SvelteKit Handle factory for WebSocket upgrade requests |
| `WebsocketHandleOptions` | Type for `createWebsocketHandle` options                |

### `@delightstack/websocket/client`

| Export                  | Description                                   |
| ----------------------- | --------------------------------------------- |
| `WebsocketClient`       | Reactive WebSocket client for Svelte 5        |
| `WebsocketClientConfig` | Type for `WebsocketClient` constructor config |

### `@delightstack/websocket/types`

| Export                        | Description                                                       |
| ----------------------------- | ----------------------------------------------------------------- |
| `WebsocketMessage`            | Union of all message types                                        |
| `EntityChangedMessage`        | Entity change event message                                       |
| `SessionConnectedMessage`     | Session connected broadcast message                               |
| `SessionDisconnectedMessage`  | Session disconnected broadcast message                            |
| `SessionListMessage`          | Session list message (sent on connect)                            |
| `ErrorMessage`                | Error event message                                               |
| `PingMessage` / `PongMessage` | Keep-alive messages                                               |
| `CustomMessage`               | Extensible custom event message                                   |
| `AuthSessionMeta`             | Default metadata shape for `@delightstack/auth`                   |
| `WebsocketSessionMeta`        | Full session metadata (ws_session_id, room, meta)                 |
| `SessionInfo`                 | Client-side session info (ws_session_id, meta)                    |
| `ConnectionStatus`            | `'disconnected' \| 'connecting' \| 'connected' \| 'reconnecting'` |
| `EntityChangeEvent`           | Entity change event for DatabaseClient integration                |

## Project Structure

```
packages/websocket/
├── index.ts                          # Root entry — re-exports types
│
├── types/
│   ├── index.ts                      # Type barrel exports
│   └── message.type.ts               # All message types, session metadata, connection status
│
├── server/
│   ├── index.ts                      # Server barrel exports
│   ├── websocket.server.ts           # WebsocketServer Durable Object (hibernation, broadcast, rate limiting)
│   └── websocket.handler.ts          # createWebsocketHandle() — SvelteKit Handle for WS upgrades
│
├── client/
│   ├── index.ts                      # Client barrel exports
│   ├── websocket.client.svelte.ts    # WebsocketClient reactive class (presence, typed events)
│   ├── websocket.worker.ts           # SharedWorker — connection management, reconnection, ping
│   └── websocket.worker.init.ts      # Worker singleton factory (SharedWorker vs Worker)
│
├── package.json
└── tsconfig.json
```
