# Chat presence

When two box members have the same chat open, each sees the other's head
under the profile avatar. A person alone sees nothing. Plan:
[plans/chat-presence.md](plans/chat-presence.md).

## What counts as present

A person is present in a chat while their page holds a live
`chatPresence.watch({ sessionId })` subscription. The web client
(`frontend/src/components/AppNav/PresenceHeads.tsx`) holds one only while
all of these are true:

- the chat is the current conversation (a session id; a brand-new chat
  counts from its reservation, which nobody else can know before its first turn);
- its transcript is on screen (`workspace.transcriptVisible`);
- the page is active: in a browser, visible and focused; in the iOS web view,
  visible (the native composer takes DOM focus from the page).

The client joins once these have held for one second and leaves as soon as
one stops. tRPC's adapter drops a stop that arrives before the subscription
registers, which leaves the watcher in the room until the socket closes
(`issues/bugs/2026-11-12-trpc-ws-drops-early-subscription-stop.md`). The
delay keeps ordinary churn (a focus flicker, a quick chat switch) out of that
window. It remains reachable when a reconnect resends the start and the
person leaves within the milliseconds the server takes to resolve the new
socket's context.
When the client leaves, the server removes the person. A closed tab or a dead connection ends it too: tRPC aborts
the subscription when the WebSocket closes, and the server's keep-alive drops
an unresponsive socket within about 35 seconds.

Known gap: in the iOS app, the web view stays mounted and visible to the page
behind the native box screen, so a person who switches to the box screen
stays present in their last chat until the app goes to the background.

## The server side

`core/chat/presence/room.ts` keeps one in-memory room per `(boxRoot,
sessionId)`. Nothing is written to disk, and there is no "last seen".
`webapp/trpc/routers/chat-presence.ts` joins the room for the subscription's
lifetime. Identity comes from `ctx.user`, never from the client. The box's own
agent (`ctx.actor === "agent"`) and a caller with no identity never join.

Each subscriber receives `ChatPresenceFrame`s. Today there is one kind:
`{ t: "others", people: [{ email, name }] }`, everyone present except the
subscriber, one entry per person, earliest arrival first. It is sent on join
and whenever that list changes.

## Adding to the channel

Later work (typing indicators, call signaling, ringing) adds frame kinds to
the `ChatPresenceFrame` union, and an upstream message gets its own
`authedProcedure` mutation that names a recipient in the same room. Two rules
hold for any addition:

- A watcher learns only about the room it named. When chats can be private,
  `watch` must make the same permission decision as reading the chat's
  transcript before it joins, and end a watcher whose access is revoked.
- Nothing about presence is stored.
