---
title: "Request diarization as a capability, not as a transcription model"
workstream: unattached
area: beebox
needs: [design]
labels: [voice, chat]
filed-by: agent
discovered-by: Ian
discovered-in: main session — correcting diarization's place in transcription settings
---

Diarization is currently presented as an HQ transcription model choice:
`VoiceChip-panels.tsx` offers **Voxtral + diarization**, and the persisted
`hqService` value is `voxtral-diarized`. That exposes an implementation detail
as though the boxholder's intent were to select a model. It also makes the
availability of diarization look inseparable from one provider forever.

The boxholder should instead ask for **diarization** as a capability. The
clearest product expression may be the
[listening/note-taking mode](2026-08-29-listening-note-mode.md), where
speaker attribution is part of the mode's purpose, rather than another entry
in a model picker. The transcription resolver should then choose a configured
model that can provide diarization.

If no configured model can satisfy the request, say so explicitly. Do not
silently fall back to a non-diarized transcript, and do not require the
boxholder to know which provider/model combination happens to implement the
capability. The CLI's existing `retranscribe --diarize` behavior is the useful
precedent: it asks for the result and resolves the service behind that request.

Design needs to settle:

- Which user intents request diarization: listening/note-taking mode only,
  narration as well, or an additional explicit capability control.
- How capability availability is reported before recording starts and how a
  request fails if configuration changes during transcription.
- How the resolver ranks multiple capable services while preserving an
  advanced way to choose or pin a provider when that is genuinely needed.
- Whether `voxtral-diarized` remains an internal dispatch target or is replaced
  by a provider-independent request throughout configuration and wire types.
- Web and native parity: the mode/request, unavailable state, and resulting
  `diarized` provenance must mean the same thing on both surfaces.

