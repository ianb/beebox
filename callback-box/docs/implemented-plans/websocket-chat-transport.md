---
title: "WebSocket chat transport"
status: implemented
workstream: unknown
issues: []
---
# WebSocket chat transport

> **Status: implemented** (2026-06). Frozen historical record. Deviations from
> the plan as written:
> - `POST /api/chat/send` stayed a raw Fastify route returning `{turnId}` JSON
>   (not a tRPC mutation) — it needs the request's user + the session registry,
>   which aren't in the tRPC context. Only `events.turnStream` became a
>   subscription.
> - No dev-router/Vite change was needed — both already proxy `/api` WS upgrades
>   (Vite's per-box rule has `ws: true`).
> - `tsconfig declaration: false` (unused emit; tRPC subscription routers can't
>   emit portable `.d.ts` — TS2742).
> - A codex review found and fixed: capture-before-send, a missed-wakeup race, a
>   recover-path text-loss, an abort-listener leak, a bounded bus queue, plus the
>   pre-existing fresh-session pin gap and concurrent-new-tab binding. The live
>   transport is `events.subscribe` / `events.turnStream` in
>   `src/webapp/trpc/routers/events.ts` + `src/core/chat-turn-buffer.ts`; the
>   "how it works now" summary lives in `callback-box/CLAUDE.md`'s raw-route note.

Replace the chat real-time transport — today two separate SSE streams (the
global `/api/events` EventSource and the per-turn `POST /api/chat/send` body
stream) — with a single multiplexed WebSocket per tab, built on tRPC
subscriptions over `wsLink`. The goal is to collapse the connection count
(removing the root cause behind a month of connection-exhaustion bugs) while
**preserving and improving** resilience: surviving dropped frames, resuming
in-flight turns from partial progress, reconnecting cleanly, and never losing
text.

This is centrally important infrastructure: every chat interaction depends on
it, and the failure modes are user-visible ("I don't see the reply until I
reload").

## Why move off SSE at all

The motivation is concrete, not aesthetic. The dev router and the hosted
server serve every box/tab over one origin. Over HTTP/1.1 the browser caps
concurrent connections at ~6 per origin. Each chat tab holds at least one
long-lived `/api/events` EventSource (`InteractiveChat-sse.ts:90`), and each
of the five `useSSE` call sites (chat, file view, view renderer, questions,
dashboard) opens its own. A handful of tabs exhausts the pool and wedges new
requests. The whole `sse-pause-hidden-tabs` worktree — visibility pausing
(`useSSE.ts`), active-tab leader election (`useIsActiveChatTab.ts`), keep-alive
gymnastics — exists to ration those 6 slots.

A single WebSocket multiplexes unlimited logical streams over one connection
(`tRPC ... JSON-RPC protocol. Requests include an id field enabling the server
to multiplex queries, mutations, and subscriptions over one persistent
connection`). One connection per tab — eventually one per browser via a
SharedWorker — removes the exhaustion class of bugs entirely, and lets us
**retire** the rationing workarounds rather than maintain them.

The non-goal is "WebSocket for its own sake." If the only problem were the
connection cap, HTTP/2 would also fix it. We choose WebSocket because tRPC's
subscription model over `wsLink` gives us the resilience primitives
(auto-reconnect + `lastEventId` resume + heartbeat) for free on top of the
multiplexing.

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md:` *"HTTP endpoints go in tRPC by default. Add a
  procedure under `src/webapp/trpc/routers/`... Raw Fastify routes... are only
  for things that don't fit the tRPC request/response shape: SSE/streaming..."*
  — SSE/streaming was the documented exception that kept `/api/events` and
  `/api/chat/send` as raw routes. tRPC v11 subscriptions over WebSocket close
  that gap, so the preference now pulls *toward* migrating them into tRPC.
- `callback-box/CLAUDE.md:` *"Read before writing. Don't guess file formats,
  XML structures, or API shapes."* — every claim below cites `file:line`.
- `callback-box/CLAUDE.md:` *"don't add features beyond what the task
  requires"* — the resilience bar is "at least as good as today"; we add a
  per-turn resume buffer because today's transport already degrades to a
  history-refetch backstop, and we must not regress that.
- `callback-box/code-style.md:` no `any`, no default params, max 2 positional
  params, custom error classes, files ≤300 lines / functions ≤150.
- `callback-box/CLAUDE.md:` *"Treat noisy command output as a bug."* — a WS
  reconnect storm or per-frame logging would violate this; logging is bounded.
- Most recent shipped precedent: the `sse-pause-hidden-tabs` work (merged
  commits `5c1d794b`…`b6d26e9d`) — the chat FSM's history-as-source-of-truth
  recovery (`STREAM_FAILED`/`STREAM_RECOVER` → `refreshing` → `fetchHistory`)
  is the resilience contract this plan must preserve, and the `lib/trpc.ts`
  `splitLink` we just added (`fix(trpc)` `e31a6e75`) is the exact extension
  point for adding `wsLink`.

## What already exists

The transport splits cleanly into a **robust half** and a **fragile half**.
The plan keeps the robust half's mechanism and brings the fragile half up to
its level.

**Robust half — the global event bus (reused, ported).**
- `src/core/event-bus.ts` — SQLite-backed bus. `emit()` persists with a
  monotonic autoincrement `id`; `subscribe({ afterId, listener })` *"Replay
  missed persisted events then stream live ones"* by reading
  `SELECT ... WHERE id > ?`. `emitTransient()` dispatches in-memory only with
  **negative ids** (no replay) for high-frequency `file-change`. This *is* the
  sequence-number + replay-buffer pattern, already durable across restarts.
  **Reuse as-is** — it becomes the data source behind a subscription.
- `src/webapp/routes/sse.ts:56` — `GET /api/events`. Reads
  `Number(request.headers["last-event-id"]) || Number(query.lastEventId)`
  (`sse.ts:59`), subscribes with `afterId: lastEventId` (`sse.ts:89`), writes
  `id: ${busEvent.id}` only for positive ids (`sse.ts:99`), pings every 30 s.
  **Rebuilt** as a tRPC subscription (the bus stays; the SSE framing is
  replaced by `tracked()`).
- `src/frontend/src/machines/sseMachine.ts` — EventSource state machine:
  5 s reconnect (`RECONNECT_DELAY`), `lastEventId` carried in context and
  re-sent as a query param, a fixed `EVENT_TYPES` allow-list. **Rebuilt** —
  `wsLink` provides reconnection and `lastEventId` resume natively.
- `src/frontend/src/hooks/useSSE.ts` — the hook wrapping `sseMachine`, plus the
  `sse-pause-hidden-tabs` additions (`keepAliveWhenHidden`, visibility pause).
  **Rebuilt / largely retired** (see Track 4).

**Fragile half — per-turn streaming (rebuilt, hardened).**
- `src/webapp/routes/chat-send-routes.ts` — `streamTurn()` pipes
  `chatSession.on("message", …)` straight to a hijacked socket until
  `done`/`error`/`close`. **No replay buffer, no sequence ids**: if the socket
  drops mid-turn, the streamed deltas are gone. Recovery is entirely external
  (the client refetches history once the turn ends).
- `src/frontend/src/machines/chat-actors.ts` — `streamActor` /
  `sendChatMessage` reads the POST body via `getReader()`, parses `data:` SSE
  frames, dispatches `STREAM_TEXT`/`STREAM_TOOL`/`STREAM_RESULT`/etc.
- `src/frontend/src/machines/chatMachine.ts` — the recovery contract we must
  preserve: `streaming` ignores `REFRESH` (`chatMachine.ts:211`), terminal
  events `STREAM_RESULT`/`STREAM_FAILED` → `refreshing` → `fetchHistory`
  (the history is the source of truth), and the just-added silent
  `STREAM_RECOVER` (`chatMachine.ts`) plus `useChatStallRecovery`
  (`InteractiveChat-hooks.ts`) recover a wedged stream on tab refocus.
- `src/core/chat-session.ts` — the `ChatSession` already accumulates
  `turnText` and emits `message`/`done`/`error`/`close`. The server therefore
  already holds the in-flight turn's text in memory; nothing today *exposes* it
  for resume.

**Transport plumbing (reused).**
- `callback-box/package.json` — `@fastify/websocket: ^11.2.0` and
  `@trpc/server: ^11.11.0` are **already dependencies**. No new top-level dep
  for the server; the client needs `@trpc/client`'s `wsLink`/`createWSClient`
  (same package already imported in `lib/trpc.ts`).
- `src/webapp/server-box-scope.ts:98` — `fastifyTRPCPlugin` is registered at
  `/api/trpc` per box, with `createContext` supplying `boxRoot`, `boxSlug`,
  `eventBus`, `services` (`:102`). `isApiPath` (`:35`) routes
  `/api/`, `/trpc/`, `/events` to Fastify. The WS endpoint extends this.
- `src/frontend/src/lib/trpc.ts` — `buildTrpcLink()` already returns a
  `splitLink` (added in `e31a6e75`). Adding a third branch for subscriptions
  over `wsLink` is a localized change to a function we already own.
- `bin/router.ts:597` — the dev router's proxy is created with `ws: true`, and
  `server.on("upgrade", …)` (`:972`) proxies upgrades. **Gap:** it targets
  `entry.frontendPort` (Vite) unconditionally (`:987`), with no Fastify-vs-Vite
  split like the HTTP path has. See Track 1 / Failure modes.

## Prior art (external)

Searched; findings recorded with URLs.

- **tRPC v11 subscriptions are exactly this pattern.** Define a subscription as
  an async generator; `yield tracked(id, data)` tags events; *"the client will
  automatically reconnect when it gets disconnected and send the last known ID
  when reconnecting as part of the `lastEventId`-input."* The server reads
  `opts.input?.lastEventId` and replays from there. This maps 1:1 onto the
  event bus's `afterId` cursor — the bus `id` becomes the `tracked` id. A
  documented gotcha: *"Subscribe to events before fetching historical data to
  prevent missing newly-emitted events while yielding the batch"* — the bus's
  `subscribe()` already does replay-then-attach atomically, which satisfies
  this. https://trpc.io/docs/server/subscriptions
- **`wsLink` reconnects automatically** with `retryDelayMs` defaulting to
  `exponentialBackoff`, and `keepAlive` (`intervalMs` default 5 s,
  `pongTimeoutMs` default 1 s) for heartbeat; `createWSClient` takes
  `connectionParams` (auth) and `lazy` (auto-close on inactivity). One WS
  multiplexes all operations. https://trpc.io/docs/client/links/wsLink and
  https://trpc.io/docs/server/websockets
- **Server adapter is `applyWSSHandler` from `@trpc/server/adapters/ws`** over a
  `ws` `WebSocketServer`, with `keepAlive: { enabled, pingMs, pongWaitMs }`.
  The docs do **not** show a first-class Fastify adapter — we attach a
  `noServer: true` `WebSocketServer` to Fastify's HTTP server and route the
  upgrade ourselves. `@fastify/websocket` (already a dep) wraps the same `ws`
  library and can host the upgrade. https://trpc.io/docs/server/websockets
- **Generic WS resume pattern** (for the per-turn buffer, where tRPC's
  per-bus-id replay doesn't directly apply): monotonic seq per message, client
  tracks last-seen, server keeps a **bounded** per-stream buffer (size or TTL)
  and replays `> lastSeq`; when the gap exceeds the buffer, fall back to a full
  resync. This is precisely our intended `ChatSession` ring buffer + the
  existing `fetchHistory` fallback. https://websocket.org/guides/reconnection/
- **Heartbeat / zombie-connection detection**: do it both directions; *"If 3
  consecutive heartbeats get no reply, the connection is dead."* This is the
  proactive version of the half-open stall `useChatStallRecovery` fixes
  reactively — `wsLink keepAlive` gives it to us for the whole multiplexed
  connection. https://websocket.org/guides/heartbeat/
- **Known tRPC limitation:** there is no high-level "reconnected" event on the
  client beyond link lifecycle callbacks (trpc/trpc#4122). We rely on
  subscription-level `lastEventId` resume (which *is* implemented) rather than
  a manual reconnected-then-resync hook. https://github.com/trpc/trpc/issues/4122
- No prior art found for an existing open-source "Claude Code session transcript
  over tRPC subscription" — the per-turn SDK-message streaming shape is
  project-specific, so Track 3's buffer design is ours to define.

**Library evaluation — the resilience layer on top of WebSocket.** The hard
requirement, *never lose text across a gap*, is inherently **server-
cooperative**: the server must hold a buffer and replay by id. No client-only
wrapper can provide it. That splits the field into three tiers:

- **Thin reconnect wrappers — `partysocket` (PartyKit), `robust-websocket`,
  `reconnecting-websocket`.** `partysocket` is the modern pick (actively
  maintained — updated May 2026, dependency-free, drop-in `WebSocket`-
  compatible, auto-reconnect + *outbound* message buffering). But they buffer
  what *you tried to send* while disconnected; they do **not** recover messages
  the *server* emitted during the gap. They solve reconnect, not resume — the
  easy half. Useful as a building block, not a solution.
  https://docs.partykit.io/reference/partysocket-api/ ,
  https://github.com/nathanboktae/robust-websocket
- **RPC subscription layer — tRPC `wsLink` + `tracked()`/`lastEventId`.** Adds
  the server-cooperative resume (server replays from `lastEventId`), plus
  multiplexing and end-to-end types, "zero dependencies and a tiny client-side
  footprint." Already the project's RPC layer. Its resume model maps 1:1 onto
  the event bus `afterId` cursor. https://trpc.io/docs/server/subscriptions
- **Full real-time server — Centrifugo / `centrifuge-js`.** Purpose-built for
  exactly this: per-channel hot history cache, automatic recovery-by-last-id on
  reconnect, an explicit "recovery impossible" flag (→ client full resync),
  multi-transport fallback (WS/SSE/WebTransport). It *validates our design*
  (history cache + last-id recovery + resync-flag ≡ event-bus `afterId` +
  `{type:"resync"}`), but it's a **separate Go server** — disproportionate
  infrastructure for a single-box, `tsx`-run personal assistant. Rejected on
  architecture fit, not capability. https://centrifugal.dev/docs/tutorial/recovery
- **Hybrid (checked, rejected):** `createWSClient` accepts a custom `WebSocket`
  *"Ponyfill which WebSocket implementation to use"*, so `partysocket` could
  supply the socket under tRPC. But tRPC's `wsLink` runs its own
  `exponentialBackoff` reconnect, which would fight partysocket's. Lean
  **against** — use tRPC's native reconnect; revisit only if it proves to miss
  offline-awareness in practice. https://trpc.io/docs/client/links/wsLink

**Decision: tRPC subscriptions over `wsLink`.** It is the "newer, lighter,
adds-just-what's-needed" layer *for this project* — the only option that
delivers the hard half (inbound resume) without standing up new infrastructure,
and it reuses the framework we're already deep in (CLAUDE.md's "tRPC by
default"). `partysocket` is the fallback building block if tRPC subscriptions
ever prove a bad fit; Centrifugo is the escape hatch if scale ever demands it.
Socket.IO is correctly excluded — heavy custom protocol, dated design, no
typed/RPC story.

## Tracks / scope

Ordered by implementation dependency, then surface size.

### Track 1 — WebSocket transport foundation (unblocks all)

**What.** Stand up a tRPC WebSocket endpoint per box on Fastify, a client
`wsLink` routed via the existing `splitLink`, multi-box context + cookie auth on
the upgrade, and dev-router upgrade routing to Fastify. No behavior change yet —
a trivial `health.ping` subscription proves the pipe end to end.

**Why this needs to change.** Everything else rides on a working, authenticated,
correctly-routed WS. The multi-box + dev-router-proxy dimensions are the real
risk and must be retired first, in isolation, before any chat logic depends on
them.

**Direction.**
- Server: in `server-box-scope.ts`, after the `fastifyTRPCPlugin` register,
  attach a `ws` `WebSocketServer({ noServer: true })` and call
  `applyWSSHandler({ wss, router: appRouter, createContext, keepAlive: {
  enabled: true, pingMs: 30_000, pongWaitMs: 5_000 } })`. Handle the Fastify
  server's `upgrade` event for path `…/api/trpc-ws`, reusing the same
  per-box `createContext` (boxRoot/boxSlug/eventBus/services) the HTTP plugin
  uses. Auth: read the session cookie off the upgrade request (the same
  mechanism `getSessionUser` uses for HTTP) and reject unauthenticated upgrades,
  rather than tRPC `connectionParams`, so behavior matches the SSE
  `withCredentials` path.
- Client: extend `buildTrpcLink()`'s `splitLink` — `op.type === "subscription"`
  → `wsLink({ client: createWSClient({ url: <box-scoped ws url>, lazy: {
  enabled: true, closeMs: 30_000 }, keepAlive: { enabled: true } }) })`; queries
  → existing GET batch; mutations + `files.summarize` → existing POST branches.
- Dev router: teach the `upgrade` handler (`router.ts:972`) the same
  Fastify-vs-Vite split the HTTP proxy uses — `…/api/trpc-ws` (and only that)
  proxies to `entry.backendPort`; everything else keeps going to
  `frontendPort` (Vite HMR). Confirm the prod path (single Fastify, no router)
  needs no router change.

**Vocabulary lock-ins.** WS path `…/api/trpc-ws`. The subscription input field
for resume is `lastEventId: z.string().nullish()` (tRPC's expected name) across
every subscription.

**First implementation chunk.** Server WS handler + client `wsLink` split +
a `health.ping` subscription that yields `tracked(String(n), n)` once a second;
manually verify connect, multiplex alongside existing HTTP queries, and
reconnect-with-resume through the dev router and direct. No chat changes.

### Track 2 — Port the global event bus to a subscription

**What.** Replace `GET /api/events` and the frontend `sseMachine`/`useSSE` with
an `events.subscribe({ lastEventId })` tRPC subscription yielding
`tracked(String(busEvent.id), busEvent)` from `eventBus.subscribe({ afterId })`.

**Why this needs to change.** It's the lower-risk half (the bus already does
durable replay) and it proves the resilience model on real traffic before the
fragile per-turn half depends on it. It also deletes the most-duplicated
connection (5 `useSSE` sites → subscriptions multiplexed on the one WS).

**Direction.**
- Server `events` router: `subscription(async function*({ input, ctx, signal })`
  that bridges `ctx.eventBus.subscribe({ afterId: Number(input.lastEventId ?? 0),
  listener })` into the async generator (queue + `signal`-aware await), yielding
  `tracked(String(id), { event, data })` for positive ids and plain `yield` for
  transient (negative-id) events, which are not resumable today and stay that
  way. Unsubscribe in `finally`.
- Frontend: a `useBusSubscription(onEvent)` hook over
  `trpc.events.subscribe.useSubscription` replacing `useSSE`. `onConnect` →
  `REFRESH` stays (the chat FSM's resync contract is unchanged; only the
  transport under it changes). The five call sites swap `useSSE` → the new hook.

**Vocabulary lock-ins.** Event payload shape on the wire stays `{ event:
string, data: unknown }` so the existing `handleSecondaryEvent` / chat
dispatchers (`InteractiveChat-sse.ts`) need only their subscription source
swapped, not their parsing.

**First implementation chunk.** The `events.subscribe` procedure + a thin
`useBusSubscription` used by **one** low-stakes consumer (DashboardPage) behind
both transports temporarily, verifying replay-after-reconnect parity with SSE
(kill the WS, emit N events, reconnect, assert no gap).

### Track 3 — Resilient per-turn streaming (the core)

**What.** Replace the `POST /api/chat/send` send-and-stream with a decoupled
pair: a `chat.send` **mutation** that starts/enqueues the turn and returns a
server-minted `turnId`, plus a `chat.turnStream({ turnId, lastEventId })`
**subscription** that delivers the turn's SDK messages, resumable mid-turn from
an in-memory ring buffer on the `ChatSession`.

**Why this needs to change.** This is the fragile half today (no resume; a
dropped socket loses partial text and relies entirely on the post-turn history
refetch). Decoupling send from stream means a mid-turn disconnect loses
neither the send (already accepted, deduped by `messageId`) nor the output (the
subscription resumes from the buffer). It directly delivers "continue with
partial progress" and "never lose text."

**Direction.**
- `ChatSession` gains a bounded per-turn buffer: each emitted `message` gets a
  monotonic `seq`; keep the last N (or last T) of the *current* turn; clear on
  the next turn's start (the completed turn's text is durable in the transcript
  history, the existing source of truth). Expose
  `replayTurn(afterSeq): { seq, msg }[]` and a live subscribe.
- `chat.turnStream` subscription: replay buffered `> lastEventId` then attach
  live, yielding `tracked(String(seq), msg)`. On a gap too large to replay
  (buffer evicted) or `turnId` unknown (server restarted, buffer lost), yield a
  terminal `{ type: "resync" }` rather than silently dropping — the client maps
  that to the existing `STREAM_FAILED`/`STREAM_RECOVER` → `refreshing` →
  `fetchHistory` backstop. **The history-refetch path is retained, not
  replaced** — it is the floor under the buffer.
- `turnId`, not `sessionId`, keys the stream so a "new" session (id assigned
  mid-turn via the SDK `system/init` message — `chat-actors.ts`
  `handleSystemInit`) works: `turnId` exists synchronously from the mutation;
  the real `sessionId` still arrives as a message in the stream.
- Frontend `streamActor` is rebuilt to drive the subscription instead of
  `fetch`/`getReader`, mapping yielded messages onto the existing
  `STREAM_TEXT`/`STREAM_TOOL`/`STREAM_RESULT`/`STREAM_QUEUED`/`STREAM_BUSY`/
  `STREAM_ERROR` events. The chat FSM states are unchanged.

**Vocabulary lock-ins.** `turnId` (server-minted, returned by `chat.send`).
The resync sentinel `{ type: "resync" }`. `seq` is per-turn and resets each
turn — distinct from the global bus `id`.

**First implementation chunk.** Server: `chat.send` mutation returning `turnId`
+ the `ChatSession` ring buffer + `chat.turnStream` replay/live. Verified with
a forced mid-turn WS drop (the same harness style used to verify
`useChatStallRecovery`) that resume continues from the partial without gap, and
that an evicted-buffer drop falls back to history with no lost text.

### Track 4 — Retire the SSE-era rationing workarounds

**What.** Once nothing uses `/api/events` or `/api/chat/send`, delete the SSE
routes, `sseMachine`, the SSE-specific bits of `useSSE`, and the connection-
rationing layer that the 6-connection limit forced:
`useIsActiveChatTab.ts`, `keepAliveWhenHidden`, the visibility pause.
`useChatStallRecovery` is **kept** (it's the half-open backstop and complements
`wsLink` heartbeat).

**Why this needs to change.** These exist solely to ration 6 HTTP/1.1 slots.
With one multiplexed WS per tab the constraint is gone; keeping them is dead
complexity that the next reader has to understand. CLAUDE.md: *"don't add
features beyond what the task requires"* — and its inverse, don't keep features
the task removed the need for.

**Direction.** Mechanical deletion + removing the now-dead `keepAliveWhenHidden`
option threading. Land last, only after Tracks 2 and 3 have fully replaced the
consumers, in its own commit so the diff is reviewable as pure removal.

**First implementation chunk.** Delete `routes/sse.ts` + its registration and
confirm no references; then the frontend SSE machine + rationing hooks.

## Subplans

None required. Track 3's ring-buffer design is the deepest sub-question, but its
shape is settled here (bounded per-turn buffer, `seq` ids, `turnId` key,
history-refetch floor) — it does not need its own research/vocabulary decision
step. If, during Track 1, cookie-auth-on-upgrade through the dev router proves
to need its own design (e.g. the proxy strips cookies), spin
`websocket-chat-transport.auth.subplan.md` at that point.

## Failure modes

**Critical gap (called out, then resolved in-plan): mid-turn text loss on a
buffer miss.** If the WS drops mid-turn *and* the server-side per-turn buffer
has evicted the relevant frames (or the server restarted and lost the in-memory
buffer), naively the partial reply is gone and silent. Resolved by Track 3's
explicit `{ type: "resync" }` terminal → `fetchHistory` floor: the completed (or
in-progress) turn's text is always recoverable from the durable transcript. The
buffer is an *optimization* over that floor, never the only copy.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Dev-router upgrade routes `…/api/trpc-ws` to Vite, not Fastify (`router.ts:987`) | No (new) | Track 1 adds the Fastify-vs-Vite split | Clear — connect fails loudly in dev |
| WS won't establish (auth cookie missing on upgrade) | No (new) | Reject upgrade; client surfaces closed connection | Clear — `onClose`, no silent half-open |
| Reconnect storm (server flapping) hammers `retryDelayMs` | wsLink default `exponentialBackoff` | Backoff caps frequency | Clear — bounded by backoff |
| Bus subscription replays from a pruned `afterId` (events GC'd) | No (new) | `readSince` returns only surviving rows; `onConnect`→`REFRESH` full resync covers the gap | Clear — history refetch fills it |
| Transient (negative-id) events lost on reconnect | Same as today | By design not replayed (file-change is idempotent-ish; UI re-stamps) | Silent but pre-existing + benign |
| Per-turn buffer evicted before resume (long disconnect) | Track 3 chunk | `{ type: "resync" }` → `fetchHistory` floor | Clear — reply still appears |
| Server restart mid-turn (in-memory buffer gone) | Track 3 chunk | `turnId` unknown → `resync` → history; `processBusy` poll/`stall-recovery` catch the tail | Clear |
| Two tabs subscribe to the same `turnId` | No (new) | Buffer replay is read-only + idempotent; both get the same frames | Clear |
| Slow client / backpressure on the WS | No (new) | `ws` buffers; `wsLink` per-op; bounded turn buffer limits memory | Needs a watch (see Open questions) |
| Heartbeat false-positive kills a healthy-but-idle WS | wsLink keepAlive defaults | `lazy.closeMs` + resume on next op makes a wrongful close cheap (auto-reconnect + `lastEventId`) | Clear — transparent reconnect |
| `lastEventId` type drift (string vs number) | No (new) | Lock `z.string().nullish()`; `Number()` at the bus boundary | Clear — single coercion point |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — N/A; this is transport, not card vocabulary. No
  agent-authored content changes shape.
- **Stale ref** — N/A; no card refs introduced.
- **Two agents / clients touching the same session** — ADDRESSED: a second tab
  (or the reactor) opening `chat.turnStream` for the same `turnId`/session gets
  the same buffered+live frames; `chat.send` dedup by `messageId`
  (`chat-send-routes.ts` `MESSAGE_ID_TTL_MS`) is preserved on the mutation.
- **Hand-edit drift** — N/A; no hand-authored syntax surface.
- **Fabricated free-form value** — N/A; no agent-authored free-form field.
- **Validation error UX** — ADDRESSED (lightly): subscription input is a tiny
  Zod object (`turnId`, `lastEventId`); a malformed resume id fails the
  subscription cleanly and the client falls back to history rather than wedging.
- **Partial migration / transition state** — ADDRESSED: during rollout both
  transports coexist (SSE routes stay until Track 4). A client on the old build
  keeps using SSE; a new build uses WS; they don't interfere (different
  endpoints, same event bus). Track 4's deletion happens only after the WS path
  is the sole consumer. GAP to watch: a half-deployed *server* that has WS but a
  cached old *client* still hitting `/api/events` — keep `/api/events` alive
  through Track 3 so no client is stranded mid-deploy.

## NOT in scope

- **SharedWorker / one-connection-per-browser.** The plan delivers one WS per
  *tab*, not one per *browser*. Multiplexing already removes the exhaustion
  problem; cross-tab connection sharing is a further optimization deferred
  because it adds a SharedWorker lifecycle we don't need yet. (This was
  "approach 2" deferred in the original SSE debugging.)
- **HTTP/2 for the rest of the app.** Other SSE-ish or many-request paths are
  untouched; this plan only moves the chat transport.
- **Persisting per-turn deltas to SQLite.** The bounded in-memory buffer + the
  durable transcript floor is enough; writing every text delta to the events DB
  would be a heavy, unnecessary write amplification.
- **Replacing the event bus storage** (SQLite → Redis/Kafka). Single-box,
  single-server scale doesn't need it; the bus stays as-is.
- **Auth model change.** We keep cookie-session auth on the upgrade; not moving
  to token/`connectionParams` auth.
- **Removing `useChatStallRecovery`.** It stays as the half-open backstop even
  with heartbeat — defense in depth for the exact bug class this whole effort
  is about.

## Open design questions

- **Backpressure policy on a slow client.** Lean: rely on `ws`'s socket buffer +
  the bounded per-turn buffer, and if a client can't keep up, let the turn
  buffer evict → client resyncs from history. Need to confirm `applyWSSHandler`
  doesn't unboundedly queue per-subscription. Resolve in Track 1 with a soak
  test (slow consumer, fast emitter).
- **One subscription or two for chat.** Lean: two (`events.subscribe` global +
  `chat.turnStream` per-turn) because the id spaces differ (durable bus `id` vs
  per-turn `seq`). Revisit only if multiplexing both through one subscription
  measurably simplifies the client without entangling the id spaces.
- **`lazy.closeMs` value.** Lean: close the WS ~30 s after the last active
  subscription/op to free server sockets, accepting a cheap auto-reconnect on
  the next activity. Tune against real idle-tab behavior.
- **Dev-router cookie passthrough on upgrade.** Verify `http-proxy-3`'s
  `proxy.ws` forwards the `Cookie` header intact; if not, this becomes the
  `.auth.subplan.md`.

## Knowledge audits

This plan is **infrastructural** — it changes how bytes move, not any
agent-facing concept (no new tag, card shape, or "this is how you do X" rule an
agent must recall). Per the skill's skip-with-rationale: **no knowledge-audit
entries**, because no agent needs to recall the transport to do its job. The one
adjacent agent-facing doc is the developer-facing CLAUDE.md note that "SSE/
streaming" is the raw-route exception; Track 4 updates that line to reflect that
chat real-time now lives in tRPC subscriptions (a docs edit, not an audit).

## Implementation order

1. **Track 1, chunk 1** — server WS handler + client `wsLink` split + cookie
   auth + dev-router upgrade split + `health.ping` subscription. Dependency:
   none. Exit criteria: connect/multiplex/reconnect-resume verified in dev (via
   router) and direct.
2. **Track 2, chunk 1** — `events.subscribe` + `useBusSubscription` on one
   consumer; replay-parity test vs SSE. Dependency: Track 1.
3. **Track 2, chunk 2** — migrate the remaining four `useSSE` consumers; chat's
   `onConnect`→`REFRESH` resync verified unchanged. Dependency: 2.1.
4. **Track 3, chunk 1** — `chat.send` mutation + `ChatSession` ring buffer +
   `chat.turnStream`; mid-turn-drop resume + evicted-buffer fallback tests.
   Dependency: Track 1 (not Track 2 — independent stream).
5. **Track 3, chunk 2** — rebuild `streamActor` onto the subscription; full chat
   FSM regression (normal turn, queued, busy, error, new-session id assignment,
   stall recovery). Dependency: 3.1, 2.2.
6. **Track 4** — delete SSE routes, `sseMachine`, rationing hooks; update the
   CLAUDE.md raw-route note. Dependency: everything above proven.

Each chunk is a commit (or a few). The plan ships as one unit when chunk 6
lands; no partial merge to main.

## Rollout shape

- **Test posture.** Dogfood first; one doctest per substantial new server
  codepath once the shape settles — specifically: `events.subscribe` replay
  parity, `chat.turnStream` replay/evict/resync. The per-turn resume is the
  regression-risk piece and gets a test at ship (mirroring how
  `useChatStallRecovery` was verified end-to-end before merge). Frontend FSM
  changes ride the existing manual + browser-driven verification (no frontend
  unit harness exists).
- **Knowledge audits.** None (see above); the CLAUDE.md raw-route line is
  updated in Track 4.
- **Migration approach.** No data-shape migration — the event bus DB and the
  transcript history are unchanged. The transport migration is gradual *within
  the plan* (both endpoints coexist until Track 4) but completes atomically:
  the SSE routes are deleted in the same shipped unit. No partial state escapes
  to main.
- **Coexistence window.** Keep `/api/events` and `/api/chat/send` fully working
  through Track 3 so a cached old client survives a server deploy; Track 4's
  deletion is the last commit before the plan ships as a whole.
