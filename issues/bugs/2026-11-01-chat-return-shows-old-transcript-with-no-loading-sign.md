---
title: "On return to a chat, the old transcript shows with no sign that newer history is loading"
workstream: chat-catching-up
needs: [manual-testing]
area: beebox
labels: [chat, ux, ios]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — boxholder report, 2026-11-01"
---

Steps the boxholder took:

1. Send a message in a chat.
2. Leave while the agent works (switch away from the tab or app).
3. Come back after the agent has done a lot of work and written replies.

The chat shows only the sent message, as if nothing has happened. After a
while the agent's work and replies appear. The delay is acceptable. The
problem is that during the delay nothing says the transcript is out of date,
so the person reads it as "the agent did nothing."

Expected: while the chat is catching up after a return, it shows that it is
loading newer history (for example a "Catching up…" row at the end of the
transcript), and removes it when the refresh lands.

Leads, to check while fixing:

- `components/chat/everywhere/InteractiveChat/ws.ts`: a reconnect-driven
  `REFRESH` is deferred while the tab is hidden (`useDeferredResync`,
  `lib/deferred-resync.ts`) and fires on becoming visible. The time between
  becoming visible and the refresh result is the window with no indicator.
  Reconnecting the WebSocket after a long background adds to it.
- The chat machine (`machines/chatMachine/`) may already have a state for an
  in-flight refresh that the transcript does not render.
- Seen in the iOS app (boxholder, 2026-11-02). iOS suspends the app's web
  view in the background, so on return the WebSocket reconnects and the
  deferred refresh runs only after the view resumes. Check whether the native
  side (`ios-app/`) shows its own state before the web view repaints, and use
  the bbx-ios-overlap skill if the fix touches the bridge.

Related: [iOS chat list stale while the box is asleep](2026-10-26-ios-shows-stale-chat-when-box-is-asleep.md)
(the same "old state with no sign it is old" problem for the chat list) and
[sent message disappears then reappears](2026-08-06-sent-message-disappears-reappears-late-deferred-resync.md)
(the same deferred-resync path).

## What was done

Branch `worktree-chat-catching-up` (not merged).

- On a return after the page was hidden for 10 seconds or more, a chat that
  has a session and is idle refreshes its history over HTTP at once instead of
  waiting for the WebSocket to reconnect
  (`components/chat/everywhere/InteractiveChat/catch-up.ts`). A chat that was
  streaming is not refreshed (`streaming` ignores REFRESH); its stream resume
  or the stream watchdog brings it up to date.
- The status strip above the composer (`TargetStrip`) says "Catching up…"
  in place of "Thinking…" until history lands or the live stream shows new
  output. The chat machine counts successful history loads in
  `historySyncs`, so a failed fetch does not end the label. The label waits
  400 ms before it shows, so a fast refresh never flashes it. After 20 s it
  ends at the first moment no fetch is in flight.
- A brief switch away (under 10 s) changes nothing: no extra fetch, no label.
- iOS needs no native change: when the web content survives the background,
  the resumed page gets `visibilitychange` like a browser tab; when it died,
  the app reloads the page and the normal loading state covers it.

Verified in a local browser by faking a 30 s hide with history requests slowed
to 3 s (label shown, then cleared on arrival), a failed history request (label
kept), and a brief hide (nothing). Not verified on a device or in the iOS
simulator.

## Manual testing

On the iPhone app:

1. Open a chat and send a message that makes the agent work for a while (for
   example, ask it to research something and write a card).
2. Leave the app at once (home screen, or switch to another app) for a minute
   or more, until the agent has finished.
3. Come back to the app.

Expected: right after returning, the strip above the message box reads
"Catching up…" while the chat still shows the old transcript; the agent's
work and replies then appear and the strip goes away. If the reply arrives
almost at once, the strip may not show at all, which is also correct.

Also check that switching away for a few seconds and back shows no
"Catching up…".
