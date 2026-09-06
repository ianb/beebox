---
title: "A diarizing HQ transcription backend that works over OpenRouter"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-openrouter-services — probing what OpenRouter can serve after Voxtral was ruled out
labels: [providers, voice]
---

`voxtral-diarized` is the box's only speaker-labeled transcription mode, and it
cannot run over OpenRouter: `mistralai/voxtral-mini-transcribe` rejects
`verbose_json` outright and returns no speaker data in `json` mode
(measured 2026-09-06, recorded in
[the OpenRouter consolidation issue](2026-08-31-openrouter-optional-services-consolidation.md)).
So a box holding only an OpenRouter key has HQ transcription — the Whisper
family works at full fidelity — but no way to get a diarized transcript at all.

That gap is closable, but only by adopting a different model, which is why this
is filed rather than folded into the routing change.

## What was measured

Same 16-second, four-turn, two-voice clip through OpenRouter's
`/audio/transcriptions`, with `verbose_json` and a provider-option passthrough:

| Model | Passthrough | Result |
|---|---|---|
| `microsoft/mai-transcribe-2` | `azure.diarization.enabled: true` | Four segments, speakers `0,1,0,1`, matching the real turns exactly. $0.00047 for 16s. |
| `x-ai/grok-stt-1.0` | `xai.diarize: true` | Speaker labels present, but three speakers for a two-speaker clip. |
| `deepgram/nova-3` | `deepgram.diarize: true` | Flag is forwarded, but every segment came back speaker 0. |
| `fish-audio/transcribe-1`, `qwen/qwen3-asr-*` | assorted | No speaker labels. |

Only 9 of OpenRouter's 20 transcription models accept `verbose_json` at all,
which is the precondition for any speaker or timestamp data.

**The passthrough mechanism is sound.** The `speaker` field appears only when a
diarize flag is sent — not with `diarize: false`, not with a bogus option key,
not with an empty options object — so OpenRouter forwards these and preserves
real speaker values rather than defaulting them.

**Treat the negative rows as untested, not as verdicts.** The clip was
TTS-synthesized with one voice crudely pitch-shifted in Python. That is
unnatural input, and Deepgram's poor showing is at least as likely to be an
artifact of it as a property of `nova-3`. Re-run against real two-person audio
before concluding anything about a specific vendor.

## The tension

`mai-transcribe-2` is a genuinely working diarizing transcriber reachable with
the key the box already has, and it is cheap. But adopting it means a new model
from a new provider in the HQ vocabulary — not a routing decision. Open
questions before it would be worth building:

- How does its WER and turn accuracy compare to Voxtral diarized on the
  boxholder's real recordings? The retranscribe machinery keeps samples.
- Does it become an `hqService` value of its own, or the thing
  `voxtral-diarized` silently becomes when the box has no Mistral key? The
  second is a silent model substitution, which the OpenRouter work deliberately
  avoided everywhere else — so probably the first.
- Is a diarized HQ pass something an OpenRouter-only box actually needs, or is
  "grant a Mistral key if you want diarization" the honest and cheaper answer?

Evaluate alongside the other diarization-adjacent watch items:
[Gemini transcription](../watch/2026-08-27-gemini-transcribe-as-transcription-backend.md)
and [Deepgram Flux](2026-08-13-deepgram-flux-stt-tts-turn-taking.md).
