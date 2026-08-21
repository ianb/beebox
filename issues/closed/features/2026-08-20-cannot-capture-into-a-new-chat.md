---
title: "You can't capture into a new chat — \"send a message first\" blocks the most natural way to start one"
workstream: new-chat-first-emission
area: callback-box
needs: [design]
labels: [capture, chat]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder noticed capture failing on first messages
---

Capture does not work on the first message of a chat. This is **deliberate, not
broken**: the affordance is disabled until the chat has a server-assigned
session id.

- `InteractiveChat.tsx:331-332` —
  `captureDisabledReason={sessionId === null ? "Send a message first" : undefined}`,
  and the same for `uploadFilesDisabledReason`.
- `InteractiveChat-composer.tsx:230-231, 248-250` — the Add-menu item and the
  mobile capture button both render `disabled`, with the label becoming
  `"Capture… (send a message first)"`.

So the answer to "is capture broken on the first message" is no — it is
switched off, on purpose, and says so.

## The job it blocks

*When I have just taken photos of something and want to ask about them, I want
to open a chat and put the photos in as the opening move, so I can say "what is
this?" with the thing itself attached.*

That is a natural way to start a conversation — arguably the most natural one
for capture, since the photos are usually the reason the chat exists. Today it
requires sending a throwaway message first, which puts a piece of throat-clearing
at the top of the transcript and makes the user do bookkeeping for the system's
benefit.

The `/capture` deep link exists precisely because capture-first is a real
entry point, so the composer disallowing it is an inconsistency between two
doors into the same action.

## The gate is stricter than the data model needs

The staging session does not require a chat id. `targetSessionId` is
`string | null` (`core/capture/staging-schema.ts:119-121`), and the delivery
layer handles null deliberately:

- `core/capture/deliver.ts:74-102` `resolveCaptureDeliveryTarget` — staging's
  target if that chat still exists → else most-active session → else
  `sessionId: null`, meaning "create a fresh session at delivery time".
- `core/chat/session/deliver-user-message.ts:141-163` — on a null target it
  calls `registry.createNew()` and wires `session-assigned` to persist the id
  back via `setStagingTargetSessionId`.
- Covered by `test/core/capture/deliver-message.doctest.md:32-50`.

The literal `"new"` sentinel never leaks into the capture path either — the
chat machine normalizes it to `null` at `machines/chatMachine.ts:88`. So the
plumbing for a capture with no chat yet already exists and is tested.

## Why removing the gate is not a one-liner

The gate is doing real work. If the composer allowed capture at
`sessionId === null`, two independent session creations can race:

- the capture's own delivery-time `registry.createNew()`
  (`deliver-user-message.ts:141`), and
- the composer's send-time `registry.createNew()`
  (`chat-send-target.ts:19-27`),

with nothing coordinating them. The capture would not be lost, but it could
land as the first message of a *different* new chat than the one the typed
message opens — which is worse than the current honest refusal.

**So the design question is how a still-unassigned chat gets one session id that
both paths agree on.** Options worth weighing: have the client mint the session
id up front rather than the server assigning it on first send; have the capture
path reuse the assignment latch `ChatPage` already runs
(`ChatPage.tsx:133-163`); or let whichever path arrives first create the session
and make the second one join it.

## Not covered by tests

No doctest or tour exercises a capture in a chat with no session: the capture
tour (`test/tours/capture.tour.ts`) runs against a box that already has
sessions and asserts only that the overlay renders. The two-`createNew` race
above is unexercised.

## Note on iOS

The web capture affordance is switched off entirely on the native shell
(`captureEnabled={!usesNativeShell}`), so iOS reaches capture through its own
native path. Whether the same first-message restriction is felt there needs a
separate check — the gate examined here is the web composer's.

Related: [failed capture chip cannot be discarded](../bugs/2026-08-20-failed-capture-chip-cannot-be-discarded.md)
— also about capture states the UI won't let the user act on.
