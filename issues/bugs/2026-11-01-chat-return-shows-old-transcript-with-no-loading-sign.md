---
title: "On return to a chat, the old transcript shows with no sign that newer history is loading"
workstream: unattached
area: beebox
labels: [chat, ux]
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
- Not confirmed which client this was (desktop web, mobile web, or the iOS
  app's web view). The iOS app suspends the web view in the background, so
  the wait is probably longest there.

Related: [iOS chat list stale while the box is asleep](2026-10-26-ios-shows-stale-chat-when-box-is-asleep.md)
(the same "old state with no sign it is old" problem for the chat list) and
[sent message disappears then reappears](2026-08-06-sent-message-disappears-reappears-late-deferred-resync.md)
(the same deferred-resync path).
