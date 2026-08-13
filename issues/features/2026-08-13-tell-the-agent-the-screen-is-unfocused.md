---
title: "Tell the agent when the screen isn't focused, and that it should lean on voice"
workstream: unattached
area: callback-box
labels: [chat, voice, agent-context]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder request
---

When the screen isn't focused — the iOS app backgrounded, a web tab in the
background — the agent should be told, along with a suggestion to **lean on
voice more heavily**. Right now it answers identically whether the person is
reading the screen or has the phone in a pocket.

The reply shape should differ. Unfocused means prose the user won't see and
formatting they can't scan; the useful response is one they can hear.

## The seam already exists

Each user turn is prepended with a `<chat-app .../>` tag carrying **feature
flags plus situational context** — `composeTurnContent`
(`src/core/chat/session/start.ts:139-160`) already assembles it, including
box-local time and, on a new conversation, last-activity and calendar. The chat
prompt tells the agent to skim it (`prompts.ts:99`).

So this is a new attribute on an existing channel rather than new plumbing. The
client already tracks focus for other reasons — visibility changes are a
suspected trigger in
[send receipts fail](../bugs/2026-08-04-chat-send-receipts-fail-often-message-actually-sent.md),
and iOS scene transitions already forward to the box log as `[ios] lifecycle`.

## Design questions

- **What the agent does with it.** "Lean on voice" needs to mean something
  concrete: shorter, no markdown structure the ear can't parse, front-load the
  answer, avoid "as you can see above". Worth stating as guidance rather than
  leaving to interpretation — a vague hint produces a vague change.
- **Focused is not the same as listening.** Narration mode may be off, or the
  phone muted. The flag says the screen is unattended, not that audio is
  reaching anyone. Consider whether the signal is focus, or focus combined with
  the `narration` feature state.
- **Staleness.** The tag is composed per turn, so it reports focus *at send
  time*. A long agent turn may finish after the user has come back — or left.
  Decide whether that is acceptable (probably yes) or whether the state should
  update mid-turn.
- **Web and iOS parity.** Web tab visibility and iOS scene phase are different
  signals with different granularity; both should map to one attribute rather
  than the agent learning two vocabularies.
- **Privacy/creepiness.** "I noticed you put your phone down" would be unwelcome.
  The instruction should shape *how* the agent answers, never become something it
  remarks on.
