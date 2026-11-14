---
title: "A shared chat shows who is typing or speaking"
workstream: unattached
area: beebox
labels: [chat, multi-user, presence]
filed-by: agent
discovered-by: Ian
discovered-in: "worktree-chat-presence — split from the chat presence issue, 2026-11-12"
---

Split from [chat presence](../closed/features/2026-11-11-chat-shows-who-is-present-and-typing.md),
which shipped the "who is present" half. The boxholder wants the familiar
"… is typing" indicator in a chat more than one person has open, and the same
for someone dictating or recording a voice message.

## What exists

- **A per-chat channel.** `chatPresence.watch`
  (`beebox/src/webapp/trpc/routers/chat-presence.ts`) is a WebSocket
  subscription per open chat; `beebox/docs/chat-presence.md` says how to add
  a frame kind and an upstream mutation to it.

## To decide

- **What starts and ends a signal:** a keystroke in the composer, the mic
  turning on, a voice recording in progress; how long one lasts without a new
  signal. Signals are never stored.
- **The iOS composer is native** (`ios-app/BeeBox/Views/NativeComposerView.swift`),
  so iOS typing needs a native→web bridge message (`beebox/docs/mobile-contract.md`).
- **Where it shows:** on the head under the profile avatar, or near the composer.

## Status (2026-11-13)

The web half shipped: the presence channel carries a `composing` frame, and
presence heads show typing and dictating badges
(`beebox/docs/chat-presence.md`, plan `beebox/docs/plans/chat-typing-indicators.md`).
iOS shows other people's badges, since the heads are web.

Remaining: the iOS native composer does not report its own typing or
dictating. It needs a native-to-web bridge message
(`beebox/docs/mobile-contract.md`) that calls the same composing mutation.
