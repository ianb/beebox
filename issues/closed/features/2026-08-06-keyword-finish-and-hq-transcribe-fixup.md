---
title: "Voice keyword that finishes the message AND runs an HQ-transcription fixup pass on it"
workstream: unknown
area: callback-box
filed-by: agent
discovered-in: main session — boxholder
resolution: implemented
---

Implemented in `62ac30ff`. The web and native iOS voice paths now recognize
`clean up and send` and `send and clean up`, hold the frozen current message for
HQ transcription, and send the realtime transcript if HQ transcription fails.

> **Job to be done:** *When I've dictated a message and the live on-device
> transcription came out rough (names, jargon, a garbled clause), I want to say one
> keyword that both ends the message and re-transcribes the audio at high quality —
> so I send a cleaned-up version without stopping to fix it by hand.*

Add a voice **keyword** that (a) finishes/sends the current message and (b) triggers
the **HQ transcription pass** on that message's audio — treating the HQ pass as a
deliberate *fixup* of the rough realtime transcript.

## What exists to build on

- The keyword spotter and keyword set — `src/frontend/src/input/voice-intent.ts`,
  `speech-keywords.ts` (a new keyword slots in here; `KeywordHint.tsx` surfaces it).
- The HQ transcription pass already exists — `api-chat.ts:97` (`hq-transcribe`), and
  `voice-intent.ts` already models "realtime-pass transcript at keyword-fire time
  (before any HQ pass)" (`:27`) and "after any HQ pass rewrites it" (`:42`). So the
  fixup capability is there; this feature is a keyword whose semantics explicitly
  invoke it as the finish action.

## Design questions for whoever builds it

- **New keyword vs. modifier.** Is this a distinct keyword ("…and clean up" / a
  dedicated phrase) alongside the normal send keyword, or a variant? The normal send
  presumably sends the realtime transcript; this one asks for the HQ fixup. Define
  the phrasing (with the alternates convention `speech-keywords.ts` uses).
- **Timing — the crux.** Does the message **hold for the HQ pass and send the
  cleaned-up version**, or send immediately and let HQ rewrite it in place? Today
  `voice-intent.ts:46` notes the HQ result "lands in the NEXT" turn because the
  pending transcript is cleared before the HQ round-trip — so a naive wiring would
  put the fixup on the wrong message. The whole point of this keyword is that the
  HQ result lands on **this** message, so the flow must hold/associate the HQ pass
  with the message being finished (a brief pending state, then send/replace with the
  HQ text), not spill into the next one.
- **Feedback while it works.** The HQ round-trip takes a moment — show that a fixup
  is in flight (reuse the `hqInFlight` state, `InteractiveChat-recovery.tsx:32`) so
  the message isn't perceived as stuck.
- **Failure.** If the HQ pass fails, fall back to sending the realtime transcript
  (never lose the message) — same posture as the recovered-dictation path.

## Related

- `docs/implemented-plans/input-extraction.md` (chunk 5) — the keyword-spotter design.
