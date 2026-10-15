---
title: "Show the boxholder where this box's data actually goes, from its own configuration"
workstream: unattached
needs: [design]
area: beebox
labels: [security, providers]
filed-by: agent
discovered-by: Ian
discovered-in: main session — 2026-10-14
---

*When I have set up keys, models, and services over several months, I want
to see, for my box as it is configured now, which outside services receive
which of my data, so I can judge the privacy of my own setup and change the
parts I do not accept.*

The facts exist only as a developer document. Section 3 of
[the security report](../../beebox/docs/security-report.md) lists every
egress: destination, trigger, data sent, credential, opt-out. It describes
every possible configuration. It does not say which rows apply to one box.
The answer depends on settings in several places:

- the chat engine and models: `_config/box.json` (`agentEngine`,
  `agentModel`, `smallModel`, `engines`), plus per-chat model choices. A
  chat on an OpenRouter or GLM model sends the full turn context to that
  provider in place of Anthropic.
- the transcription backend (`_config/transcription.json`): Mistral by
  default, OpenAI Whisper for the HQ pass, Deepgram or OpenAI Realtime from
  the browser for live dictation.
- which keys the box is granted. OpenRouter is an intermediary for a service
  whose own key is absent (embeddings, audio questions, the Whisper pass), so
  a missing key can route data through one more company. This is easy to
  miss.
- Google services (`googleServices.*`), the git remote, publishing, Web Push.
- telemetry flags (`claudeCodeTelemetry` default on, `codexTelemetry` default
  off).

## What the view would show

For each destination that is active for this box: what data goes there
(full chat context, raw audio, each card's searchable text, scanned photos),
when (every turn, on capture, on sync), and the setting that changes it.
Possibly also each provider's stated retention and training policy, with a
link and the date it was checked. OpenRouter forwards to the model's own
provider, so its row has two policies.

## Open questions

- **Source of truth.** The security report is prose. An in-box view needs a
  structured registry in code: each egress site declares its destination,
  data class, and the config that turns it on. A test could then fail when
  a new outbound call is not registered. The security report could be
  generated from the same registry, or checked against it.
- **Provider policies.** They change, and they differ by plan and account
  (zero data retention, API terms vs consumer terms). A stated policy with a
  check date may be the most the box can say honestly.
- **Where it lives.** A Settings panel, a card the agent maintains, or both.
  The agent should be able to answer "who sees my voice notes?" from the
  same data.
- **Per-chat detail.** Model choice is per chat, so the box-level answer is
  "Anthropic, plus OpenRouter for these chats".
- **Members.** Whether a box member sees the same view for their own data.

## Related

- [Third-party engine privacy (closed)](../closed/bugs/2026-10-06-third-party-engine-privacy-telemetry-and-security-report.md):
  the telemetry fix and the egress row that this view would surface.
- [Git push confirmation](../decisions/2026-07-20-git-push-confirmation.md).
- [Privacy-neutral usage statistics](2026-10-06-privacy-neutral-usage-statistics.md):
  if that ships, it is one more row here.
