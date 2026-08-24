---
title: "Mark low-confidence words in a transcript so a misheard word is visible"
workstream: transcript-confidence
area: callback-box
design: ../../../callback-box/docs/implemented-plans/transcript-confidence.md
labels: [transcription, voice, chat]
priority: important
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder asked whether Deepgram reports confidence
resolution: implemented
---

> **⏳ Awaiting manual testing** — implemented on `worktree-transcript-confidence`
> (design + build per the linked plan; commits `b4d11c33`…`932961d5`); dictate via
> the web composer against a Deepgram-realtime box and check the marks (see
> [Manual testing](#manual-testing)). Only the developer clears this.

When the boxholder reads back something they dictated — a memo, a chat turn, a
captured note — they want the words the transcriber was **unsure about** to be
visibly marked, so a misheard word can be spotted and fixed instead of silently
becoming what the box believes they said.

Today a transcript arrives as flat text. Every word looks equally certain,
including the ones the model was guessing at.

## Deepgram already sends this; we drop it

Confirmed 2026-08-14. No API change or Deepgram-side option is needed — the
data is in responses we already receive and discard.

- **Batch** — `src/core/transcription/deepgram.ts:57-62` declares
  `DeepgramWord` as `word` / `start` / `end` / `punctuated_word`. Deepgram sends
  a per-word `confidence` on top of those, and the interface does not declare
  it, so the mapping at line 127 cannot carry it through. The
  alternative-level `confidence` (a whole-utterance score) is dropped at the
  same point. Note the word array is only read at all when
  `options.wordTimestamps` is set.
- **Realtime** — `src/frontend/src/machines/transcription-connections.ts:144`
  reads `msg.channel.alternatives[0].transcript` and nothing else. The same
  `words[]` array with its confidences is present in that message, unread.

So the work is plumbing plus presentation, not integration.

## What the design has to settle

**Where the threshold comes from.** Deepgram confidence clusters very high for
most words, with the interesting signal in a thin tail; a threshold picked by
intuition will either mark nothing or mark everything. **Measure the actual
distribution on real dictation before choosing one** — that measurement is a
prerequisite, not a nice-to-have, because it decides whether the feature is
usable at all.

**Proper nouns are the false-positive machine.** Names, places, and jargon score
low because they are rare, not because they are wrong — and they are already the
words a reader's eye stops on. Marking every name trains the reader to ignore
the marks within a day. Worth considering whether known vocabulary (box
contacts, recurring names) suppresses a mark.

**Confidence is a partial signal, and the gap should be stated.** Low confidence
catches "I could not hear this." It does not catch the substitutions that
actually change meaning, where the model is confidently wrong on a plausible
homophone. The marking must not read as a correctness guarantee — an unmarked
transcript is not a verified one.

**How it renders, per surface.** Chat, a card body, and a read-aloud transcript
are different reading situations. Whatever the marker is, it has to survive
being stored in a card and degrade to something sane in plain text — a transcript
is markdown in a file, not only a rendered view.

**Whether the mark is durable or transient.** A marker that persists into the
stored card is provenance; one that only appears in the review moment is an
editing aid. These have different consequences for search, diffing, and what an
agent reading the card later believes.

**Voxtral parity.** `src/core/transcription/voxtral.ts` is the other backend.
If it reports nothing comparable, the design needs an answer for "this backend
cannot mark anything" that is not silently pretending everything is confident.

## Manual testing

> Verified by boxholder 2026-08-24

What shipped (see the linked plan for the design): dictating in the web
composer with Deepgram realtime now wraps low-confidence **phrase spans** in
`<unsure>…</unsure>` in the persisted `<speech>` message — a span seeds at a
word under 0.7 (lowered from 0.85 after the boxholder found the initial rate
too noisy) and spreads across adjacent sub-0.9 words, since real mishearings
sit in low-confidence regions rather than on one exactly-scored word — and
stamps `stt="deepgram"` whenever confidence data was captured. The chat agent
is prompted to treat marked meaning-critical words as unverified; the sent
bubble renders marked words with a subtle dotted underline.

To try (needs a real microphone, which no agent has):

1. On a Deepgram-realtime box, dictate a message with a keyword send ("…send
   message") — ideally including a name or a mumbled word. Check the sent
   bubble for dotted-underlined words, and the session JSONL (or
   `cb chat retranscribe`'s printed realtime transcript) for the `<unsure>`
   tags and `stt="deepgram"`.
2. Dictate and tap the send button instead of speaking the keyword — marks
   should still appear (this path was wired in the review fix round).
3. Say something with a marked meaning-critical word (e.g. an ambiguous
   can/can't) and watch whether the agent asks / retranscribes instead of
   acting on it.
4. Voxtral or iOS dictation: messages should carry NO `stt=` and no marks —
   absence, not a false claim.
5. Judge mark volume: measurement predicts ~2–5 marked words per long
   dictation, including function words (kept deliberately — the agent needs
   the shaky "can"/"not"). If the display feels noisy, a display-side filter
   is the knob to ask for; the stored marks stay.

## Related

Same surface as
[show a retranscription in chat](../../features/2026-08-12-show-retranscription-in-chat.md) —
both carry transcript provenance and quality into the UI, and they probably
want one design rather than two.

