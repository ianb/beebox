---
title: Measure a minimal system prompt for ClaudeScanVision (~15k tokens/call at stake)
workstream: unknown
priority: normal
---

`ClaudeScanVision` (`beebox/src/services/scan-vision-claude/core.ts`) uses
`systemPrompt: { type: "preset", preset: "claude_code" }` because that is the
configuration every model-comparison experiment ran
(`scratch/model-comparison/REPORT.md`). The preset costs roughly 15k input
tokens per stateless call — amortized over a 3-page batch, but still the
single largest fixed cost on the Claude scan path.

Codex's review of `beebox/docs/plans/scan-vision-claude.md` suggested a
short custom system prompt instead. It was deliberately not bundled into the
switch: swapping the system prompt is an unmeasured behavior change (structured
output discipline, transcription completeness, and schema conformance were all
measured under the preset), and the boxholder had already accepted the cost.

The measurement is cheap with the existing harness: clone
`scratch/model-comparison/run-batch3.ts`, replace the preset with a one-line
system prompt, and compare slot completeness + cost on the 12 prepared pages.
If quality holds, the swap saves ~5k tokens/page.

Re-reviewed 2026-10-30: the preset is still used, now set in query.ts rather than core.ts. The scratch/model-comparison harness the issue says to clone is gone, so the measurement needs a new harness.

Out of date in the body above: Change the file reference to beebox/src/services/scan-vision-claude/query.ts and replace the 'clone run-batch3.ts' step, since scratch/model-comparison/ is gone.
