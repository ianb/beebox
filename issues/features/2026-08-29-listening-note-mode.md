---
title: "Listening/note mode — diarized ambient listening with typed notes alongside, for interviews and group planning"
workstream: unattached
area: callback-box
needs: [design]
labels: [voice, chat]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "something like narration mode, but listening/note mode"
---

A subtle alternative to narration mode: the box **listens** rather than takes
dictation. Diarization on by default (who said what), and the boxholder can
**type notes while it listens** — the two streams interleave instead of the
mic owning the composer. The boxholder's cases: requirements interviews,
group planning — settings where the audio is *other people talking* and the
boxholder's own contribution is annotations, not speech.

How it differs from what exists:

- **Narration mode** (`narration` chat feature, `core/chat/features.ts:34`)
  is still dictation-shaped: one voice, the transcript becomes the message.
  Listening mode's transcript is *ambient material*, attributed by speaker,
  that the typed notes reference.
- **Capture** records and files; it doesn't sit inside a chat where the agent
  can follow along and the boxholder annotates live.

Design questions (`needs: [design]`):

- **Diarization source.** Voxtral realtime is the current streaming path;
  whether it diarizes, and at what quality, decides feasibility. The Gemini
  3.5 Transcribe watch item
  (../watch/2026-08-27-gemini-transcribe-as-transcription-backend.md) lists
  word-level timestamps + diarization to three speakers on the *pre-recorded*
  path — a checkpointed HQ pass (like narration's) may be the honest v1, with
  realtime diarization later.
- **The interleaved record.** How turns land in the chat: speaker-attributed
  transcript blocks with typed notes threaded between them at their moment?
  This is provenance-adjacent — the transcript-confidence work's
  which-transcriber marker applies to diarized segments too.
- **The agent's role while listening.** Silent scribe by default? Summoned by
  a typed question? Narration's checkpoint model (process on pause) is the
  precedent.
- **Speaker naming.** Diarization gives "Speaker 1/2"; letting the boxholder
  name them (once, inline) makes the record durable. Names of third parties
  in a box raise the usual sensitivity — the box owns its data, but group
  settings mean people who didn't opt in; worth one deliberate line in the
  design.
- **Consent/recording indicator.** A mode whose point is recording other
  people should be visibly on (tab title/favicon session-indicator issue
  `2026-08-04` is adjacent).
- **Surface.** A third state on the existing mic control vs a chat feature
  flag (`listening`) seeded per landmark — the features registry
  (`core/chat/features.ts`) handles non-boolean values, and the sticky-HQ
  precedent applies to stickiness.

Related: `2026-05-19-spark-mode.md` (ambient-adjacent, different intent);
iOS parity matters (`cb-ios-overlap`) since interviews happen on the phone.
