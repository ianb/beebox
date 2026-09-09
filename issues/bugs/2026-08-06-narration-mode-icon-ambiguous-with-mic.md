---
title: "Find a better narration-mode icon — a mic can't signal it (both modes use the mic)"
workstream: unknown
needs: [design]
area: beebox
filed-by: agent
discovered-in: main session — boxholder
priority: important
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
- [chat output vocabulary ia pass](../docs-and-chores/2026-06-02-chat-output-vocabulary-ia-pass.md)
  — adjacent narration/chat-surface work, but that's about output tags, not the
  mode indicator.

## Re-encountered 2026-09-08

Boxholder, from the main session: "I definitely need a better icon indicator
for navigation in the toolbar. It's a mic which makes no sense."

Where the glyph actually lives: `ChatBarChrome` portals the `SessionChip` and
`VoiceChip` into the app bar's chip slot, so the mic is the only pictorial
control in the top bar on a chat page. It is being read as the bar's navigation
affordance, not as a voice control at all — a stronger failure than the
narration-vs-mic ambiguity above. Whatever replaces it needs to read as
"voice/audio settings" at a glance, and the bar may need a distinct, obvious
navigation entry point next to it (see `AppNav`/place pill, which use caret,
folder, and back glyphs).
