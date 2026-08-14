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

## Unspeakable content must be announced, not dropped

Boxholder: some things can't be said aloud — a link, a path, a code block. Those
still get written. But with no visual feedback the user doesn't know they exist,
so the agent has to **introduce the fact that supplemental information is
there**: say that a link is in the message, then stop. The failure mode to
avoid is either reading a URL character by character or silently writing
something the listener never learns about.

That makes the guidance two-sided — compress what's speakable, and flag what
isn't — rather than a blanket "be shorter".

## Mute is not known today, and should be

Checked: nothing tracks it. The only audio-adjacent state is the `narration`
feature (on/off, set by the user) and a speech-playback signal that flows
frontend → native shell (`use-native-bridge.ts:70,78`). Neither reaches the
agent, and neither is mute.

Three states the agent would want distinguished:

- narration **off** — the user chose not to hear replies;
- narration **on but inaudible** — muted, silenced, or volume at zero, so speech
  plays to nobody and leaning on voice is exactly wrong;
- narration **on and audible** — the case this feature is for.

Implementation caveat worth recording before anyone estimates it: iOS does not
expose the ringer/silent switch through a supported API. `AVAudioSession`
gives output volume, and route changes reveal headphones or a speaker, but
"silenced" is inferred rather than read. Web has even less. So this may be a
best-effort signal, and the agent's guidance should degrade sensibly when it's
unknown rather than assuming audible.

## Design questions

- **What the agent does with it.** "Lean on voice" needs to mean something
  concrete: shorter, no markdown structure the ear can't parse, front-load the
  answer, avoid "as you can see above". Worth stating as guidance rather than
  leaving to interpretation — a vague hint produces a vague change.
- **Focused is not the same as listening.** Narration mode may be off, or the
  phone muted. The flag says the screen is unattended, not that audio is
  reaching anyone. Consider whether the signal is focus, or focus combined with
  the `narration` feature state.
- **Staleness — accepted.** The tag is composed per turn, so it reports focus at
  send time and a long turn can outlive it. The boxholder's call: live with the
  lag rather than build mid-turn updates. Worth stating in the prompt so the
  agent treats it as a hint about the moment the message was sent.
- **Web and iOS parity.** Web tab visibility and iOS scene phase are different
  signals with different granularity; both should map to one attribute rather
  than the agent learning two vocabularies.
- **Privacy/creepiness.** "I noticed you put your phone down" would be unwelcome.
  The instruction should shape *how* the agent answers, never become something it
  remarks on.
