---
title: "OpenAI retires its batch STT models — move `whisper` off OpenAI hosting"
workstream: unattached
area: beebox
activate-on: 2026-12-01
category: code-quality
filed-by: agent
discovered-by: agent
discovered-in: worktree-openrouter-services — checking OpenAI TTS updates surfaced the STT deprecation
labels: [providers, voice]
---

OpenAI deprecated its whole batch speech-to-text lineup on **2026-08-26**, with
**shutdown on 2027-02-26** (developers.openai.com/api/docs/deprecations). Every
model behind the box's HQ transcription services is on the list:

| HQ service | Model | |
|---|---|---|
| `whisper` (the default `hqService`) | `whisper-1` | retiring |
| `whisper-llm` | `gpt-4o-transcribe` | retiring |
| `whisper-llm-mini` | `gpt-4o-mini-transcribe` | retiring |
| — | `gpt-4o-transcribe-diarize` | retiring (never adopted) |

`whisper-1` also backs the non-HQ batch path (`transcribeAudio` with
`service: "whisper"`), reached from capture and the transcribe preaction.
Deferred to 2026-12-01 rather than filed live: there is nothing broken today and
the fix is small, but it wants doing with runway rather than in February.

## Do not take OpenAI's named replacement

The deprecation notice points at `gpt-transcribe` / `gpt-live-transcribe`.
Checked against the live API on 2026-09-06:

- **`gpt-transcribe` is `json`-only.** It rejects `verbose_json` and
  `diarized_json` outright ("not compatible with model"), so it returns no
  duration, no language, and **no word timestamps**. The capture pipeline asks
  for word timestamps on every clip (`core/capture/transcribe-clips.ts`) and
  `bbx chat retranscribe --timestamps` writes them to a sidecar.
- **`gpt-live-transcribe` is not valid on `/v1/audio/transcriptions`** at all
  (`Invalid URL (POST /v1/audio/transcriptions)`) — it is a realtime model.

Following the official migration would therefore be a feature regression.

## The actual swap, verified

`whisper-large-v3` is the same Whisper family, hosted by people other than
OpenAI, and it keeps everything `whisper-1` gives us. Measured on the same clip
through OpenRouter (`openai/whisper-large-v3`, served by DeepInfra, Groq, and
Together):

| | `whisper-1` (today) | `whisper-large-v3` |
|---|---|---|
| duration | 3.21 | 3.216 |
| language | `english` | `en` |
| word timestamps | 9 | 9 |
| cost / 14s | $0.00140 | $0.00011 |

Feature parity, and about thirteen times cheaper. Two small differences to
handle rather than discover:

- **The language string differs** (`english` vs `en`). That value lands in card
  frontmatter via `applyFrontmatterTranscription`, so switching backends changes
  what cards say unless it is normalized. Worth normalizing at the seam anyway —
  the backends already disagree about this.
- Words arrive with a leading space (`" This"`); the existing parser trims.

## What is genuinely open

- **Which host.** OpenRouter reaches it with the key the box may already have
  (`core/openrouter.ts`), but Groq or DeepInfra direct are also options and the
  box has no credential for either. Routing it through OpenRouter is the
  smallest change and needs no new secret.
- **The two LLM variants.** `whisper-llm` / `whisper-llm-mini` have no
  equivalent outside OpenAI, and their value was always questionable — they
  return text only, and under noise `gpt-4o-transcribe` was observed
  hallucinating a fluent unrelated sentence rather than degrading (see
  [the diarizing-backend issue](../exploration/2026-09-06-openrouter-diarizing-stt-backend.md)).
  Retiring them alongside the models may be the right answer rather than finding
  a substitute.
- **Nothing is lost on diarization.** `gpt-4o-transcribe-diarize` is retiring
  too, but the box never adopted it; `voxtral-diarized` and `mai-diarized` are
  unaffected.
