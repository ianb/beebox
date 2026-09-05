---
title: "Consolidate optional model services under OpenRouter where practical"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main session — reducing billing and configuration overhead during the external cutover
labels: [providers, configuration]
priority: important
---

Bee Box can require separate provider accounts, API keys, configuration, and
bills for auxiliary model-backed services. Determine which of these workloads
can use one OpenRouter account without losing important behavior. Consolidation
is the goal. Using OpenRouter for every workload is not a requirement.

This question is separate from routing the main agent model through OpenRouter.
That work belongs to [provider-endpoint config](../features/2026-07-18-provider-endpoint-config.md).
This issue covers optional services around the agent:

- OpenAI embeddings for semantic search.
- Gemini or Claude scan vision.
- OpenAI HQ transcription and text-to-speech.
- Mistral Voxtral, Deepgram, and OpenAI Realtime transcription paths.
- Other model-backed helpers found during the inventory.

Do not include non-model connectors such as Google Workspace, Telegram, web
push, Cloudflare publishing, or git remotes. OpenRouter cannot replace their
service-specific APIs.

Voice needs its own conclusion. An OpenRouter model that accepts audio is not
necessarily a replacement for a speech API. Check realtime streaming, partial
and final transcript boundaries, word timing and confidence, diarization,
custom vocabulary, text-to-speech output, latency, and browser-safe ephemeral
credentials. It is acceptable for voice to remain on specialist providers.
Compare the findings with the existing [Gemini transcription watch](../watch/2026-08-27-gemini-transcribe-as-transcription-backend.md),
[Deepgram Flux exploration](2026-08-13-deepgram-flux-stt-tts-turn-taking.md),
and [Fish Audio exploration](2026-06-15-fish-audio-s2-streaming-transcription.md).

## Research (incomplete)

Build a current inventory from the provider-key configuration, service
factories, transcription backends, health checks, and security report. For each
workload, record:

- The current provider, endpoint shape, model, credential, and automatic or
  manual trigger.
- Whether OpenRouter offers the required endpoint and model, not only a model
  with a similar marketing label.
- Whether adoption is a base-URL change, a small adapter, or a new protocol.
- Feature parity, including structured output, image and audio input, streaming,
  metadata, file limits, and retry behavior.
- Data-egress and retention differences introduced by an aggregator.
- Current and projected cost, minimum spend, rate limits, and whether one bill
  actually reduces operational overhead.
- The new failure concentration from placing several optional services behind
  one account and balance.
- Which provider keys and configuration fields can be removed, and which must
  remain as fallbacks or for specialist features.

Finish with three groups: safe to consolidate now, possible after a bounded
adapter or test, and keep on a specialist provider. Treat voice as a separate
line item in that recommendation.
