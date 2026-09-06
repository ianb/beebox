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

## What is known about MAI-Transcribe-2 (checked 2026-09-06)

**It is three days old and in public preview.** Announced 2026-09-03 by the
Microsoft AI team; Microsoft Learn states it is "not recommended for production
workloads" and ships without an SLA. The line is churning — MAI-Transcribe-1
(Apr 2026) was already deprecated in Aug, 1.5 landed in Jun, 2 in Sep. On
OpenRouter it is served exclusively by Azure. That maturity, not the accuracy
numbers, is the thing that should govern adoption.

**Vendor claims:** 5.2% average WER on FLEURS across 60 languages; long-form
processing 10x faster than GPT-Transcribe, 7x faster than ElevenLabs Scribe v2,
5x faster than Gemini 3.5 Transcribe. Claims to beat Whisper V3-Large, with no
per-model breakdown published. Pricing $0.10/hour of audio, described as
introductory through end of 2026.

**Independent:** Artificial Analysis ranks it #2 at 2.0% WER (up from #3 for
1.5). That is the only substantive third-party accuracy measurement found. A
figure placing Whisper large-v3 near 23% in the same framing appears in
secondary coverage but could not be traced to a primary source — discard it.

**Against Voxtral specifically, nothing has been published by anyone** — not
Microsoft, not a third-party benchmark, not a practitioner writeup. That is a
real absence rather than an unsearched corner. Mistral's own claim for Voxtral
Mini Transcribe V2 is ~4% FLEURS WER against ~10.3% for Whisper large-v3, which
is a vendor number on a different benchmark and not comparable to the
Artificial Analysis figure.

**Diarization quality is undocumented.** No DER numbers and no maximum speaker
count from any source; only that the feature exists and is opt-in.

## Local smoke test (2026-09-06)

One 14-second clip, four turns, two TTS voices, with white noise added at
descending SNR. Median of 2-3 runs through OpenRouter.

| Model | Latency (median) | WER clean / 5 dB / 0 dB | Cost per 14s |
|---|---|---|---|
| `microsoft/mai-transcribe-2` | 0.74-0.96s | 0% / 0% / 0% | $0.00039 |
| `deepgram/nova-3` | 0.72-1.01s | 0% / 0% / 0% | $0.00100 |
| `mistralai/voxtral-mini-transcribe` | 1.16-1.52s | 0% / 0% / 0% | $0.00070 |
| `openai/whisper-1` | 1.65-3.61s | 0% / 0% / 0% | $0.00140 |
| `openai/whisper-large-v3` | 1.34-2.74s | 0% / 0% / 2.6% | $0.00011 |
| `openai/gpt-4o-transcribe` | 0.95-1.50s | 15.8% / 100% / 100% | $0.00048 |

**This cannot rank accuracy** — 38 words of clean synthetic speech is too easy,
and everything but one model scored perfectly. What it supports is the latency
ordering, where MAI is consistently fastest and `whisper-1` slowest by 2-4x, and
the observation that MAI's speed claim is not marketing.

**The incidental find is the more actionable one.** At 5 dB and 0 dB SNR,
`openai/gpt-4o-transcribe` did not degrade — it hallucinated, returning "The
filter takes advantage of gravity to function", a fluent sentence unrelated to
the audio. `whisper-1` and `mai-transcribe-2` transcribed the same audio
correctly. That model is the box's `whisper-llm` HQ mode, and a confident
fabrication is worse than a garbled transcript because nothing downstream can
tell. Worth its own look, on real noisy recordings, independent of anything
about diarization.

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
