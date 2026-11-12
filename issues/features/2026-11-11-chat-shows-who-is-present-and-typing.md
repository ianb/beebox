---
title: "A chat with more than one person shows who is present, and who is typing or speaking"
workstream: unattached
area: beebox
labels: [chat, multi-user, presence]
filed-by: agent
discovered-by: Ian
discovered-in: "main checkout — boxholder request, 2026-11-11"
---

A box can have more than one member (the owner plus `allowedEmails` in
`_config/box.json`), and two people can have the same chat open. Today
neither sees the other. The boxholder wants a chat with more than one person
in it to show:

- **Who is present:** the people who have this chat open now.
- **Who is typing or speaking:** the familiar "… is typing" indicator, and
  the same for someone dictating or recording a voice message.

## What exists

- **Presence per box, not per chat.** `presence.heartbeat`
  (`beebox/src/webapp/trpc/routers/presence.ts`) counts the tabs heard from in
  the last 90 seconds, for deciding whether to notify
  (`beebox/docs/implemented-plans/notifications.md`, Track A). It records a
  tab session id, not a person or a chat.
- **Messages know their sender.** Accepted messages carry `user` and
  `userEmail` (`beebox/src/core/chat/session/accepted-messages.ts`), so the
  transcript can already say who sent what.
- **Live chat events** already reach every open tab over the WebSocket, so a
  presence or typing event can travel the same way.

## To decide

- **What counts as present (boxholder, 2026-11-11):** two states.
  **Present** means the chat is in a focused browser tab, or open in the iOS
  app while the app is in the foreground. **Idle** means the chat is open in
  a tab without focus, or the app is running but not in the foreground.
  Still to decide: whether to show yourself as well as other people, and how
  soon a closed tab or a stopped app drops out.
- **Typing and speaking signals:** what starts and ends them (a keystroke in
  the composer, the mic turning on, a voice recording in progress), how long
  one lasts without a new signal, and that they are never stored.
- **Where it shows:** a row of names or avatars near the composer or the
  chat header. Show nothing when only one person is present, so a
  single-person box sees no change.
- **The iOS app:** whether it sends the same signals, through the shared
  bridge contract (`beebox/docs/mobile-contract.md`).
- **The agent:** whether the box agent sees who is present, for example to
  address the right person.

Related: [private chat sessions](2026-09-28-private-chat-sessions-search-gating.md),
which decides who may see a chat at all.

This is the prerequisite for [voice and video calls in a shared chat](2026-11-11-voice-and-video-calls-in-a-shared-chat.md).
