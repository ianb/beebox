---
title: "tRPC's WebSocket adapter drops a subscription.stop that arrives before the subscription registers"
workstream: unattached
area: beebox
labels: [trpc, websocket, subscriptions]
filed-by: agent
discovered-by: agent
discovered-in: "worktree-chat-presence — cross-model implementation review, 2026-11-12"
---

In `@trpc/server` 11.17.0 (`node_modules/@trpc/server/dist/ws-*.mjs`,
`handleRequest`), `subscription.stop` aborts `clientSubscriptions.get(id)`.
A subscription is added to `clientSubscriptions` only after the socket's
context promise and `callProcedure` resolve. A stop that arrives in between
finds nothing and is discarded; the subscription then registers and runs until
the socket closes. The client has already forgotten it, and the app's other
subscriptions keep the socket open.

Every WebSocket subscription is exposed (`events.subscribe`,
`events.turnStream`, `chatPresence.watch`). For most this costs a server-side
iterator. For chat presence it would leave a person shown in a chat they left,
so `frontend/src/components/AppNav/PresenceHeads.tsx` joins only after a
person has been in a chat for one second (`JOIN_AFTER_MS`). That narrows the
window but does not close it: after a reconnect, wsLink resends the start,
and a leave within the context-resolution milliseconds still strands the
watcher (cross-model review round 2).

Fix options: a pnpm patch (`patches/`) that remembers early-stopped ids and
aborts them on registration, or an upstream report/fix. Check whether a newer
tRPC already handles it.
