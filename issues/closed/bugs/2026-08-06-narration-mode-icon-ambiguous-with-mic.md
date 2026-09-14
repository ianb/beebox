---
title: "Find a better narration-mode icon — a mic can't signal it (both modes use the mic)"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: main session — boxholder
priority: important
resolution: implemented
---

The narration-mode indicator is built on a **microphone glyph**, but a mic can't
carry that meaning: **voice input uses the mic in BOTH narration mode and normal
mode.** So the icon the user reads as "mic" says "you can talk," not "narration
mode is on" — the one distinction it's supposed to make is exactly the one the
mic can't make.

The current attempts to overload the mic don't resolve it:

- `VoiceChip` (`beebox/src/frontend/src/components/chat/VoiceChip.tsx:53`,
  `MicIcon`) draws a plain mic and only **dims it** (`opacity-40`) when narration
  is off vs. full opacity when on — a brightness difference, not a different
  symbol.
- `NarrationMicIcon`
  (`beebox/src/frontend/src/components/chat/InteractiveChat-controls.tsx:81`)
  already tries to disambiguate by adding a **chat bubble** beside the mic body —
  but the mic is still the dominant shape, so it still reads as "voice."
- The voice button
  (`beebox/src/frontend/src/components/chat/InteractiveChat-voice-button.tsx:47`)
  leans on the **tooltip text** ("Voice input (narration mode)" vs. "Voice input")
  to carry the mode — i.e. the glyph alone doesn't communicate it.

## What "better" needs to do

Find an icon (or a clearer visual treatment) that signals **narration mode
specifically** — the "user is speaking at length, not issuing a command, and
doesn't expect a reply" state (see the narration semantics in
`beebox/src/core/chat/session/prompts.ts` `NARRATION_OVERLAY`) — and reads
as distinct from ordinary voice input at a glance, without relying on a tooltip or
on a brightness difference the user has to A/B to notice.

Directions to weigh (design, not decided): a non-mic metaphor for "extended
utterance / thinking out loud" (a speech-bubble-forward mark, waveform, a
stream/flow glyph); a clear on/off *state* treatment (a filled/outlined pair, a
distinct accent color, a small "mode on" badge) rather than a different symbol; or
separating the two concerns entirely — one control for "voice input available"
and a separate, unmistakable indicator for "narration mode engaged."

## Related

- `beebox/src/frontend/src/components/chat/VoiceChip.tsx` — the split-pill
  chip face; `VoiceChipFace` doctest exercises it standalone, so an icon change is
  testable there.
- [chat output vocabulary ia pass](../../docs-and-chores/2026-06-02-chat-output-vocabulary-ia-pass.md)
  — adjacent narration/chat-surface work, but that's about output tags, not the
  mode indicator.

## Re-encountered 2026-09-08

Boxholder, from the main session: "I definitely need a better icon indicator
for narration mode in the toolbar. It's a mic which makes no sense."

Same complaint as the original filing, now raised unprompted while using the
app — the mic reads as microphone/input, and there is no glyph in the bar that
says "the assistant is speaking to you." Where it lives: `ChatBarChrome`
portals `SessionChip` and `VoiceChip` into the app bar's chip slot, so
`VoiceChipFace` is the only pictorial control up there on a chat page and is
carrying both the input and the narration meanings at once.

## Closed 2026-09-14 — the mic was wrong because narration is a relationship

Designed with the boxholder in the main session. The filing was right that a mic
cannot signal narration; the reason turned out to be deeper than "both modes use
the mic". **Narration changes what the BOX does as much as what you do** — per
`NARRATION_OVERLAY`, its turn defaults to silent and it receives instead of
answering. Both participants' states flip together and are perfectly correlated,
so no single-participant picture can carry it. That is why every mic variant
failed, including the compound mic-plus-bubble.

The chip now carries two orthogonal facts, one per segment:

- **Who holds the floor** — taking turns, or you narrating while the box
  listens. Two marks whose weight says who has it, deliberately abstract rather
  than two silhouettes: at 16px a relationship survives as weight and little
  figures do not. Podcast — the box holding the floor while you listen — is the
  third value of this same axis, slotted but unbuilt.
- **How the box answers** — aloud, or in writing. The muted state draws written
  lines rather than a slashed speaker, because a slash says *suppressed* and
  that is not what happens: the box still answers, in text.

Both are shown because neither implies the other, which the boxholder spotted
while enumerating the states: in narration the box is silent by default but may
still speak *by exception* — when asked, or when you are hands-busy — and
answering in text removes that exception, so a genuine question arrives as a
callout instead. Four readable combinations from two controls.

Nothing is conveyed by dimming any more. The accessible name says the whole
thing in words ("Voice — you are narrating, it listens, answers in text"),
because a relationship and a channel do not survive being read as a list of
toggle names.

Two follow-ups, neither blocking: the big round voice button still uses
`NarrationMicIcon` (a mic with a bubble attached, the same flaw at a larger
size), and "Mute" may want renaming now that the state means "answers in text".
Podcast mode itself is noted on
[listening-note-mode](../../features/2026-08-29-listening-note-mode.md), which was
reframed the same day: ambient listening is narration with diarization, not a
mode of its own.
