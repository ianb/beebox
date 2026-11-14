# Chat presence

When two box members have the same chat open, each sees the other's head
under the profile avatar. A person alone sees nothing. Plan:
[implemented-plans/chat-presence.md](implemented-plans/chat-presence.md).

## What counts as present

A person is present in a chat while their page holds a live
`chatPresence.watch({ sessionId })` subscription. The web client
(`frontend/src/components/AppNav/PresenceHeads.tsx`) holds one only while
all of these are true:

- the chat is the current conversation (a session id; a brand-new chat
  counts from its reservation, which nobody else can know before its first turn);
- the page is active: in a browser, visible and focused; in the iOS web view,
  visible and shown (the native composer takes DOM focus from the page, so
  focus does not count there).

A card open over the chat still counts. In the iOS app, the native box screen
covers the web view without unloading it; the app reports that with
`window.beeboxShellShown = false` and a `beebox:shell-shown` event
(`docs/mobile-contract.md`, B15), and the person is present nowhere.

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

## The server side

`core/chat/presence/room.ts` keeps one in-memory room per `(boxRoot,
sessionId)`. Nothing is written to disk, and there is no "last seen".
`webapp/trpc/routers/chat-presence.ts` joins the room for the subscription's
lifetime. Identity comes from `ctx.user`, never from the client. The box's own
agent (`ctx.actor === "agent"`) and a caller with no identity never join.

Each subscriber receives `ChatPresenceFrame`s. `{ t: "others", people:
[{ email, name }] }` is everyone present except the subscriber, one entry per
person, earliest arrival first. It is sent on join and whenever that list
changes. The `call` kind is in `docs/chat-calls.md`; the `composing` kind is
below. Each kind is sent on join and then only when it changes; their order
relative to each other is not fixed.

## Composing

A head shows a small badge while that person is typing (three dots) or
dictating (a mic); its tooltip says "Tomas is typing". Nobody sees their own.
The text itself is never sent, and nothing is stored or logged: this is not
the activity log (`docs/implemented-plans/activity-log.md`).

- **Typing** is an edit by the person in the composer (`ComposerTextarea`'s
  `onChange`: a keystroke or a paste) that leaves text, until 5 seconds pass
  without one or the text empties (a send or a clear). Draft restores and
  dictated text do not count, and typing done in another chat is forgotten
  on arrival in a new one.
- **Dictating** is the web composer's mic recording (`voice.isTranscribing`).
- `frontend/src/lib/composing.ts` holds the state. Once the tab's watch has
  its first frame, `PresenceHeads` sends the state with the
  `chatPresence.setComposing` mutation on each change and every 3 seconds
  while it is set, and sends null when the tab leaves the chat. One send is
  in flight at a time and a newer state replaces one not yet sent, so they
  arrive in order and a stale state is never sent late.
- The room accepts a state only from a person with a watcher in that room.
  One not re-sent within 8 seconds clears, and so does one whose person's
  last watcher leaves. Watchers hear `{ t: "composing", active: [{ email,
  doing }] }`, everyone else composing, on each change.
- One person's tabs share one state: the latest send wins.
- The mutation goes over HTTP to the box the page names, while the watch is
  on the WebSocket. Should the two ever name different boxes, the room
  refuses the state and nobody sees a badge.
- The iOS native composer does not report yet; iOS shows the others' badges.

## Adding to the channel

New work adds frame kinds to
the `ChatPresenceFrame` union, and an upstream message gets its own
`authedProcedure` mutation that names a recipient in the same room. Two rules
hold for any addition:

- A watcher learns only about the room it named. When chats can be private,
  `watch` must make the same permission decision as reading the chat's
  transcript before it joins, and end a watcher whose access is revoked.
- Nothing about presence is stored.
