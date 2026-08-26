---
title: "A small-model slot for title, summary and chat-review passes"
workstream: model-engine-policy
area: callback-box
---

Chat-review, title and summary passes run on the box's main model. OpenCode's
`small_model` config key routes exactly those passes (title, summary, compaction) to a
cheaper model, with no router or fallback logic — one declared slot, static choice.

That fits the boxholder's stated preferences: static provider choice (no routing), and
operational simplicity over per-call cost — which argues *for* one config knob and
*against* anything adaptive. Open question: per engine (`claude`/`codex` each get a
small model) or one box-level value that `normalizeModelId` (`src/core/agent/run.ts`)
maps per engine.

Source: [research/opencode/inspiration.md](../../research/opencode/inspiration.md).
