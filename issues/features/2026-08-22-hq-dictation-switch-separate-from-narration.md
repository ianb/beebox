---
title: "A switch for always-HQ dictation, separate from narration mode"
workstream: unattached
area: callback-box
needs: [design]
labels: [voice, transcription, chat]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder wanting HQ dictation without narration mode
---

> There should be a switch, maybe like model selection, to get HQ dictation
> always. Right now it's conflated with narration mode, but maybe doesn't need
> to be.

## The conflation, in one line

`src/frontend/src/components/chat/InteractiveChat-voice.ts:132`:

```ts
const runHq = narrationEnabledRef.current || intent.hq;
```

So the high-quality transcription pass runs when **narration mode** is on, or
when a single send asks for it. There is no way to say "always transcribe me at
HQ" without also turning on narration mode, which changes how the agent
*responds* (`core/narration-mode-doc.ts`) — a different concern entirely.

The per-send `intent.hq` already exists, so the missing piece is a persistent
preference that sets it, not a new transcription path.

## The mechanism is already there

`core/chat/features.ts` is a registry of chat features with exactly the shape
this needs — `allowedValues`, `default`, `uiKind: "toggle" | "select"`, `label`
— and `narration` is already one of them. Features surface to the settings UI
and render into the `<chat-app …>` envelope the agent reads
(`<chat-app narration="on" prose="off" …>`).

Adding an entry there gets the switch, its UI affordance, its persistence, and
the agent-visible signal at once. Worth checking that assumption against the
code rather than trusting this note, but it looks like a small change.

Open questions worth deciding rather than assuming: whether the preference is
per-chat (like the existing features) or per-box, and whether it should be a
`select` (off / auto / always) rather than a toggle, since "auto" is arguably
what the current threshold behavior already is.

## Retranscription stops being available — say so minimally

**This is the part to get right.** `cb chat retranscribe` *is* an HQ pass over
the retained recording — it exists to escalate from fast live transcription to
the better model. When dictation already ran at HQ, there is no higher tier to
escalate to, so retranscribing returns the same text and spends the user's turn
for nothing.

The agent has to know this, and **it must be signalled in the smallest possible
way — not another paragraph of prompt.** The prompt already spends a long
paragraph on retranscribe and a second on `<unsure>` marks; a third would make
the guidance worse, not better.

The obvious minimal shape: the feature renders itself into the `<chat-app>`
envelope like every other feature, and the retranscribe guidance gains one short
clause keyed to it. One attribute the agent can already see, one sentence tying
it to the existing tool advice.

A per-message marker on the `<speech>` wrapper (which already carries
`message-id`, `user`, `local-time`) is the alternative, and is more precise —
the setting can change mid-conversation, so a session-level attribute describes
*now* rather than the message the agent is looking at. Decide between them
deliberately; both are one attribute, so the tie-breaker is accuracy, not size.

Whichever is chosen, resist restating the reasoning in the prompt. The agent
needs to know the tool won't help here, not why.

## Related

- [Mark low-confidence words in transcripts](2026-08-15-mark-low-confidence-words-in-transcripts.md)
  — the other axis of transcription quality, and the source of the second
  prompt paragraph this one must not become a third of.
- [The first message of a chat can't have its audio retranscribed](../bugs/2026-08-18-first-message-audio-not-retranscribable.md)
  — documents the retention model retranscription depends on. Note its finding
  that native iOS voice sends already can never be retranscribed, for the same
  underlying reason: the HQ pass happened elsewhere and nothing kept the audio.
  An always-HQ switch makes that pre-existing case the common one, so the
  signalling decided here should cover both rather than being narrowly scoped
  to this switch.
