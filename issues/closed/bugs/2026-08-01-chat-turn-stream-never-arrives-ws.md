---
title: "Chat turn stream never arrives — UI stuck on 'Agent is working…'"
area: callback-box
filed-by: agent
discovered-in: worktree-remove-cb-render — browser-verifying the chat surfaces after removing cb render
resolution: superseded
---

> **Closed 2026-08-06.** Two halves:
> - **Transport** (the tRPC WebSocket upgrade failing at the router, the actual
>   cause of the missing stream) is the same root cause as
>   [dev-router-worktree-websocket-1006](2026-08-02-dev-router-worktree-websocket-1006.md)
>   — being fixed there (`worktree-router-ws-1006`). No separate transport work here.
> - **Client resilience** (a lost turn stream hangs the UI on "Agent is working…"
>   forever instead of timing out / showing a reconnect state) is **deliberately
>   deferred, not pursued** (boxholder call): a lot of chat live-update work is in
>   flight — the router WS fix, the sent-message-disappears reconcile, receipt
>   reconciliation — and the intent is to see how it all settles together before
>   adding more resilience machinery. If the silent-hang persists after that work
>   lands, refile.

The chat UI never leaves the streaming state. The agent turn completes normally
on the server, but no stream event reaches the browser, so the reply never
renders and the composer stays disabled behind "Queue message (agent is busy)".

**This is NOT caused by the `cb render` removal.** It reproduces identically on
`main` (see Evidence).

## Reproduce

1. Open `/<worktree>/test1/chat` and send any message.
2. The header shows "Agent is working…" and a "Stop agent" button.
3. The server finishes the turn within seconds.
4. The UI never updates. Waiting 60+ seconds changes nothing.
5. Reload, or open the session from `/chats` — the reply is there and renders
   correctly, including its speech controls.

So the data is fine and history rendering is fine. Only the live push is lost.

## Evidence

Server completed the turn in about 2 seconds
(`~/src/box-worktrees/<wt>/test1/content/.callback-box/hub-child.log`):

```
2026-08-01T11:26:03.226Z [stdout] [ChatSession:send] Sending message (177 chars, 0 image(s), 1 block(s))
2026-08-01T11:26:05.363Z [stdout] [ChatSession:done] Turn complete, is_error: false
```

The chat machine is healthy — it transitions correctly and then waits forever
for events that never come (browser console):

```
[chatfsm] enter-idle msgs=2 pending=0
[chatfsm] send-from-idle len=64
[chatfsm] enter-streaming msgs=3 pending=0
[chatfsm] stream-start msgLen=64 images=0
```

No JavaScript errors accompany it. The only console errors are an unrelated
service-worker 401 and an audio-unlock warning.

A raw WebSocket to the tRPC endpoint fails to connect, from an authenticated
page, for **both** the worktree and `main`:

```
/main/test1/api/trpc            => ERROR
/remove-cb-render/test1/api/trpc => ERROR
```

`main` still has the SSR machinery intact, so the failure predates and is
independent of that removal.

## Where to look

`bin/router.ts:1121` `server.on("upgrade", …)` destroys the socket on a denied
auth decision (`:1137-1140`) and separately refuses upgrades to a
not-running worktree (`:1170`). Either path drops the socket with no
client-visible reason. On the client, the failing subscription is
`events.turnStream` in `src/frontend/src/machines/chat-actors.ts:282`; the
transport (the `wsLink` half of the `splitLink`) is configured in
`src/frontend/src/lib/trpc/index.ts`. Note that
`src/frontend/src/components/chat/InteractiveChat-ws.ts` is a *different*
subscription — the global event bus — so it is not the place to start.

Two things worth separating: whether the upgrade is being denied at the router
(auth, or the deliberate never-wake-a-worktree rule), and whether the client
surfaces a dropped subscription at all. Right now a lost subscription is
**silent** — the UI simply waits forever, which is the worse half of the bug.
Even after the transport is fixed, a stream that dies mid-turn should time out
or show a reconnect state rather than hang.

The router log goes to the terminal running `pnpm dev`, which an agent cannot
read — the boxholder may see "refusing WS upgrade" or "auth gate error on WS
upgrade" lines there that would settle which path is taken.

## Note

I could not confirm the live-stream path end-to-end on `main` by sending a real
message, because that would write a chat session into the boxholder's primary
test box. The WebSocket-parity check above is the substitute.
