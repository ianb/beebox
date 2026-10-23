---
title: "Voxtral rejects the box's context_bias when it holds spaces, so a voxtral transcription with a prompt fails with 400"
workstream: unattached
area: beebox
labels: [transcription, voxtral]
filed-by: agent
discovered-by: agent
discovered-in: worktree-apple-stt-tuning — server-engine comparison runs for the Apple speech tuning research
resolution: implemented
---

Fixed in `9f7de8352`. `voxtralContextBias` in `beebox/src/core/transcription/voxtral/request.ts`
splits the prompt into unique single words, which the API accepts. A live
probe found no list-length limit up to 2,000 words. Repeated fields, a JSON
array, and `context_bias[]` were all rejected for multi-word entries, so the
split is the only form that works with `voxtral-mini-latest`. A newer model
that takes phrases would let multi-word terms through again.


`buildVoxtralRequestBody` (`beebox/src/core/transcription/voxtral/request.ts:100`)
sends a caller's `prompt` as one `context_bias` form field. On 2026-10-23,
`voxtral-mini-latest` answered such a request with:

```
400 Bad Request - Context bias item 'Monro Inc Earnings Conference Call' must not contain commas or whitespace (context_bias_input_method=comma_separated)
```

The API reads the field as a comma-separated list of single tokens. Any entry
with a space fails the whole request.

The one known caller with a prompt is the transcribe preaction
(`beebox/src/core/preactions/transcribe.ts:113`). It sends the card's existing
text as the prompt. That text almost always has spaces, so a voxtral
transcription of a card that already has content probably fails. This was
seen with direct API calls through `transcribeAudioHq` in the research
harness. The preaction path itself was not run.

Questions to settle:

- Does the API accept repeated `context_bias` fields, or a JSON array, for
  multi-word terms? Mistral's documentation for Voxtral 3 shows entries such as
  "Alder Creek Design", so the newer models may accept them
  ([move to Voxtral 3](../../features/2026-10-20-upgrade-transcription-to-voxtral-3.md)).
- Should re-transcription send the old text as bias at all? A whole transcript
  is not a term list. Whisper's `prompt` takes prose; `context_bias` does not.
- Until then, a prompt that the API rejects should not fail the
  transcription. Retry without the bias, or split terms into single words.
  The research harness split terms into words, and that raised voxtral's
  proper-noun recall on Earnings-21 from 67% to 77%
  ([research](../../../research/apple-speech-tuning/README.md)).
