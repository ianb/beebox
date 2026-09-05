---
title: "release cloud provider honesty"
workstream: unknown
area: beebox
resolution: implemented
---

**Closed 2026-07-20** — decided in the soft-launch conversation
([soft-launch posture](../../decisions/2026-07-20-soft-launch-posture.md)):
disclose plainly. The README front-door gate includes a "what leaves your
machine" section (point 1 below); swappability (point 2) stays opportunistic,
not a launch requirement.

From the Rowboat review (`research/rowboat-review.md`, Tier 3). Rowboat markets itself as
"local-first" and got its top critical HN comment for shipping Deepgram (transcription),
ElevenLabs (voice), and PostHog (analytics) anyway. **We share the same exposure**: the
Claude Agent SDK loop (a configured provider key), transcription/TTS providers, and any
analytics all reach out to third parties.

For the source-available release this is a reputational + honesty issue, not just a
feature gap. Two things to settle in `docs/plans/source-available-release.md`:

1. **State the cloud dependencies plainly** — a clear "what talks to whom" list in the
   README/release docs, rather than letting "own your data / plain markdown / git" imply
   fully local. Our story is genuinely strong (data + history on disk), which is exactly
   why the cloud-call caveats should be up front, not discovered.
2. **Make them swappable/optional where feasible** — the model provider is already
   pluggable-ish (configured key, never ambient); transcription/TTS/analytics should be
   swappable or disable-able, and a local-model path (see the per-surface issue's Tier-2
   note on Ollama/LM Studio) would be a real differentiator. Decide which are
   must-swap vs. acceptable-with-disclosure for v1.

This is a decision to fold into the release plan, not net-new design. Cross-refs the
provider-auth polish work and `docs/plans/source-available-release.md`.
