# Event Bus Design

**Status: Implemented.** The `broadcastEvent` system has been fully replaced by `EventBus`. See `src/core/event-bus.ts`.

## Problem (solved)

The old `broadcastEvent` system was tightly coupled to SSE connections. Events were fire-and-forget: if no SSE clients were connected when an event fired, it was lost. This caused the schedule-fired bug — the server broadcast to 0/0 clients and the frontend never saw the agent's response.

The system also had two separate `broadcastEvent` instances per box (one for the main routes at `/<slug>/`, one for webhooks at `/webhook/<slug>/`), which meant Telegram's webhook handler couldn't reach the same SSE clients as the chat routes.

## Architecture

### Producers (call `eventBus.emit()`)

| Event | Source | File |
|-------|--------|------|
| `file-change` | chokidar file watcher | `routes/sse.ts` |
| `schedule-fired` | ChatScheduleManager timer | `routes/chat.ts` |
| `chat-history` | Agent done responding to schedule | `routes/chat.ts` |
| `chat-complete` | User-initiated chat turn done | `routes/chat.ts` |
| `wakeup-start/complete/error` | Wakeup cycle | `routes/actions.ts`, `trpc/routers/actions.ts` |
| `question-answered` | User answers a question | `routes/actions.ts`, `trpc/routers/actions.ts` |
| `card-created` | Card creation (capture, action, voice memo) | `routes/actions.ts`, `routes/capture.ts`, `trpc/routers/actions.ts` |
| `cards-changed` | Telegram creates/processes cards | `routes/telegram.ts` |
| `command-complete` | CLI command execution | `routes/commands.ts`, `trpc/routers/commands.ts` |

### Consumers (listen via the `events.subscribe` tRPC subscription)

| Page | Events consumed | Action |
|------|-----------------|--------|
| DashboardPage | `file-change`, `question-answered`, `card-created`, `wakeup-complete` | Invalidate tRPC queries |
| QuestionsPage | `question-answered`, `card-created`, `file-change` | Invalidate questions query |
| ChatPage (`InteractiveChat-ws.ts`) | `schedule-fired`, `chat-history` | Alarm/TTS, update messages |

## Implementation

### Core: `EventBus`

A single EventBus instance per box, created at server startup and shared by all routes. Backed by SQLite for persistence, with in-memory dispatch for real-time delivery.

```
src/core/event-bus.ts
```

**Schema:**
```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  event TEXT NOT NULL,
  data TEXT NOT NULL,        -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_events_channel_id ON events(channel, id);
```

**API:**
```typescript
interface EventBus {
  // Producers: one-liner from anywhere
  emit(event: string, data: unknown): number;  // returns event ID

  // Consumers: read events since a cursor
  readSince(afterId: number): BusEvent[];

  // Consumers: subscribe for real-time + replay
  subscribe(options: { afterId?: number; listener: BusListener }): Subscription;

  // Maintenance
  prune(olderThan: Date): number;
  close(): void;
}
```

No `channel` parameter — each box gets its own EventBus with its own SQLite DB. The channel concept from the earlier sketch is unnecessary since boxes are already isolated by `boxRoot`.

**`emit(event, data)`** inserts a row into SQLite, then synchronously notifies all live subscribers. Returns the auto-increment ID (usable as SSE `id:` field).

**`subscribe({ afterId, listener })`** first replays all events with `id > afterId` from SQLite, then attaches the listener for future events. Returns a `Subscription` with `unsubscribe()`. This is the key primitive — it handles the "I was disconnected, what did I miss?" problem.

**`readSince(afterId)`** is the polling equivalent — fetch all events since a cursor without subscribing. Useful for REST endpoints.

### SSE integration: `routes/sse.ts`

The SSE route becomes a thin adapter over EventBus:

```typescript
server.get("/api/events", (request, reply) => {
  const lastEventId = Number(request.headers["last-event-id"]) || 0;

  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const sub = eventBus.subscribe({
    afterId: lastEventId,
    listener: (event) => {
      reply.raw.write(`id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
    },
  });

  request.raw.on("close", () => sub.unsubscribe());
});
```

The browser's `EventSource` automatically sends `Last-Event-ID` on reconnect. The server replays missed events from SQLite and then streams live. No more lost events.

### Event threading

- **Server creates one EventBus per box** in `server.ts`
- **All routes receive `eventBus`** — routes, tRPC context, webhook handlers
- **Webhook routes share the same EventBus** — Telegram webhook emits to the same bus as chat routes
- **File watcher** uses `eventBus.emitTransient()` for high-frequency file-change events (not persisted to SQLite)

### Pruning

Old events should be cleaned up periodically. A simple approach: prune events older than 24 hours on server startup, and optionally on a timer:

```typescript
// On startup
eventBus.prune(new Date(Date.now() - 24 * 60 * 60 * 1000));
```

Events are ephemeral notifications, not an audit log. 24 hours is generous — most replays happen within seconds of a disconnect.

### Transient events

`emitTransient()` uses negative IDs and skips SQLite — for high-frequency ephemeral events like `file-change` that don't need replay on reconnect.

## Superseded: SSE transport → tRPC WebSocket subscription

The SSE integration described above (`routes/sse.ts`, `GET /api/events`, `EventSource`/`Last-Event-ID`) has been replaced by a tRPC subscription over the shared WebSocket: `events.subscribe` in `src/webapp/trpc/routers/events.ts`. It bridges the same SQLite-backed `EventBus` into an async generator — persistent events are `tracked()` by bus id so a reconnect replays exactly what was missed (client resends `lastEventId`, the bus replays from `afterId`), and transient (negative-id) events are yielded plain, matching the prior SSE behavior. `events.turnStream` is a second, resumable subscription for per-turn agent output. The `EventBus` core itself (SQLite schema, `emit`/`subscribe`/`readSince`/`emitTransient`, one bus per box) is unchanged by this; only the delivery mechanism to the browser moved off SSE.

## Key decisions

- **One EventBus per box, not per server** — isolates boxes, each gets its own SQLite file
- **`emitTransient()` for file-change events** — avoids SQLite churn for high-frequency events that don't need replay
- **Replay by last-seen id** — the WebSocket subscription resends `lastEventId` on reconnect the same way SSE's `Last-Event-ID` did; no custom protocol needed
- **EventBus is a plain object, not a class** — follows the project's functional style (see `createEventBus()`)
- **SQLite DB at `.callback-box/events.db`** — gitignored, ephemeral, rebuildable (same pattern as `usage.db`)
- **Cross-process polling** — when `pollInterval` is set, the bus checks SQLite for events from other processes (CLI, background agents)
