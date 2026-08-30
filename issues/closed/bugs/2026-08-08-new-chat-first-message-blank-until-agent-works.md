---
title: "New chat: the first user message doesn't display until the agent starts working (~10s blank)"
workstream: first-message-redirect
area: beebox
filed-by: agent
discovered-in: main session — boxholder report
resolution: implemented
---

> **✅ Confirmed fixed by Ian, 2026-08-12.** Fix landed in `8acadb78` (ChatPage
> assignment latch). The manual-testing flag is cleared by that confirmation —
> the first-message bubble now survives the `?session=new` → assigned-id
> redirect, which no automated test could verify.

## Root cause + fix (2026-08-09)

Reproduced in a real browser (continuous sampling across the redirect): the
optimistic bubble was visible on `?session=new`, vanished the moment the URL
flipped to the assigned id, and reappeared ~5s later when the turn became
durable. Instrumentation showed the exact failure:

```
[chatpage] announce-assignment f8c0a7ec-…       ← handshake fired before navigate()
[chatpage] key-transition prev=new next=f8c0a7ec-… announced=null carried=false epoch=2
[chatfsm]  stream-eof-no-terminal msgCount=1    ← live turn stream torn down
[chatpage] key-transition … announced=f8c0a7ec-… carried=true   ← one render too late
```

The `f8ecf363` handshake **did fire in the right order**, but it stored the
announcement in React state. The URL rewrite reaches `ChatPage` through the
TanStack Router store (`useSearch` → `useSyncExternalStore`), which re-renders
at **sync priority — before the same-tick default-priority `setState` is
applied**. So the search-change render still saw `announcedAssignment: null`,
classified the assignment as explicit navigation, bumped the key epoch, and
remounted `InteractiveChat` — discarding the optimistic message, the machine
context, and the live turn stream. The handshake's ordering held at the call
sites; it broke across React lanes.

Fix: the announcement now travels through an external-store latch
(`createSessionAssignmentLatch` in `chat-session-transition.ts`) read via
`useSyncExternalStore` — the same store kind the router uses, so the
navigation's own render always sees an announcement made in the same tick. It
is consumed in a commit effect (never during render, so replayed render passes
can't half-consume it). Post-fix browser run: bubble visible in every sample
across the redirect; one machine throughout (`stream-terminal STREAM_RESULT`,
no remount). Latch semantics locked down in
`test/frontend/chat-session-transition.doctest.md`.

## Why earlier reproductions failed (environment)

The browse-browser probes stalled because the browser's `bbx_session` was
missing/expired: the dev router **silently destroys** unauthenticated WS
upgrades (`bin/router.ts` upgrade handler), so the tRPC socket never connects
— no `system/init`, no `chat-session-assigned`, no redirect — while cached
pages still render. This matches the gap filed in
[no-socket-level-ws-auth-test](../../code-quality/2026-08-07-no-socket-level-ws-auth-test.md).
A working setup needs a valid owner session cookie in the driven browser
(mint one with the `~/.beebox-session-secret` HMAC scheme, including the user's
current `gen` — a gen-less cookie is treated as revoked).

Starting a **new** chat and submitting the first message: the user's message does
not appear in the thread for ~10 seconds — until the agent has done some work.
For that whole window the conversation looks empty, as if the send didn't land.
(Reported for the new-chat/first-message case specifically; ordinary follow-up
sends in an existing chat show the optimistic bubble immediately.)

## Not a missing-optimistic-bubble bug — the machinery fires

The send-from-idle handler **does** append an optimistic user entry synchronously
and protects it (`chatMachine.ts:159-185`): it pushes the entry into both
`messages` and `pendingMessages`, sets `liveTurnId`, and the comment there notes
it's tracked in `pendingMessages` precisely so a globally-broadcast `SET_MESSAGES`
snapshot taken before the send "cannot erase it mid-turn." `reconcilePending`
(`chat-shared.ts:73-110`) keeps a pending entry until a server message actually
echoes its text, so an empty new-session history should *not* drop it. So the
optimistic entry is created and, on paper, should render immediately.

**Therefore the bug is specific to the new-chat path losing or not mounting that
entry — not the append itself.**

## Leading hypotheses (need a debug loop to confirm — see below)

1. **Remount/reinit on new-session identity assignment (most likely).** A brand-new
   chat runs with `sessionInput === "new"` (`chatMachine.ts:209`). When the server
   assigns the real session id and it lands (`applyServerMessages` sets
   `sessionId`, `chat-actions.ts:139-152`), if a parent/router remounts
   `InteractiveChat` keyed on the session id (URL `/chat` → `/chat/<id>`), the
   fresh `chatMachine` starts with empty `messages`/`pendingMessages` and the
   in-memory optimistic entry is discarded — so nothing shows until the *durable*
   user message appears in fetched history, which only happens once the agent has
   produced output and the session log is written (~10s). This matches the "blank
   until the agent works" timing exactly.
2. **A new-session refresh/SET_MESSAGES path clears it.** Some transition in the
   new-session case swaps in a server snapshot without the pending guard intact,
   dropping the optimistic entry before the echo lands.
3. **Render gated on a session id the new chat doesn't have yet.** The message
   list (or its key) suppresses rendering until a concrete `sessionId` exists,
   which for a new session arrives late.

Hypothesis 1 is the prime suspect; the fix is likely to preserve the optimistic
`messages`/`pendingMessages` across the new→assigned-session transition (avoid the
remount, or carry the pending entry through it), not to touch the append.

## Repro / debug loop (per bbx-debug)

Drive a real new chat via `bin/browse`: open a fresh chat, submit a first message,
and snapshot the message list on an interval *before* the first stream output —
assert the user bubble is present within a frame or two of submit, not only after
the turn completes. A frontend timing bug like this wants the tight browser loop;
log the FSM (`logFsm` already emits `send-from-idle` / `enter-streaming`) and watch
whether a remount resets `messages.length` to 0 right after the session id is
assigned.

## Reproduction update (2026-08-09)

The boxholder clarified the important timing: the optimistic message appears
initially, then is lost **after the URL redirects from `session=new` to the
assigned session id**. A useful reproduction must therefore observe the bubble
continuously across that redirect; checking only the first animation frame after
submit does not exercise the failure boundary.

Browser probes on both the worktree's isolated `test1` and main's primary
`test1` showed the optimistic bubble promptly and retained it for 20–35 seconds,
but neither run was a valid negative reproduction:

- `POST /api/chat/send` succeeded and returned a turn id.
- The backend log showed the SDK assigning a session id and completing the turn.
- The frontend logged `send-from-idle`, `enter-streaming`, and `stream-start`,
  but received neither an in-stream `system/init` frame nor the fallback
  `chat-session-assigned` broadcast.
- Consequently the browser stayed on `?session=new`; the redirect under
  suspicion never happened.

The shared-router browser path was not delivering the tRPC WebSocket events
needed for assignment. An attempted direct-Vite-port browser run wedged during
navigation and did not produce usable evidence. Manually changing the URL to
the backend-assigned id would be a false reproduction: without
`onSessionAssignment` it is intentionally classified as explicit navigation and
remounts the chat.

### Next reproduction attempt

Use a browser/environment where realtime turn frames and session assignment are
known to work. Start from an existing chat, choose **New session**, submit a
uniquely identifiable first message, and record these transitions until after
the assigned-id URL lands:

1. message present immediately after submit;
2. `SESSION_ASSIGNED` / assignment announcement;
3. URL changes from `session=new` to `session=<id>`;
4. whether `InteractiveChat` remounts or its message count drops to zero;
5. when the message becomes visible again.

Current source already contains the `f8ecf363` assignment handshake:
`InteractiveChat-ws.ts` calls `onSessionAssignment(sessionId)` immediately before
navigation, and `ChatPage.tsx` uses that announcement to keep `keyState.epoch`
stable across the assignment. The next investigation should verify that runtime
ordering with mount/message-count evidence rather than assuming the handshake
works or replacing it speculatively.

## Related (distinct issues, cross-check when fixing)

- [sent-message-disappears-reappears-late](../../bugs/2026-08-06-sent-message-disappears-reappears-late-deferred-resync.md)
  — an **existing**-chat variant (intermediate history snapshot omits the message,
  ~20s), likely the same "optimistic entry not protected across a server snapshot"
  family but a different trigger; a fix here should check whether it also covers
  that.
- [open-chat-flashes-agent-working-no-send](../../bugs/2026-08-05-open-chat-flashes-agent-working-no-send.md)
  — adjacent new/opened-session render glitch.
- [chat-send-receipts-fail-often](2026-08-04-chat-send-receipts-fail-often-message-actually-sent.md)
  — different symptom (receipt shows failed), same chat-send surface.

## Manual testing

Follow the concrete reproduction or verification steps above. Confirm the
observed result matches the expected behavior described in this issue before
clearing the manual-testing flag.
