---
title: "knowledge budget always loaded context"
workstream: unknown
needs: [design]
area: callback-box
---

The always-loaded layer (agent-guide.md, CLAUDE.md includes, system prompts) has no size discipline: every addition feels individually justified, and the layer only grows. Establish an explicit budget — a token/line cap the always-loaded corpus must stay under — so adding direct knowledge forces a trade: make the new thing indirect (a pointer to an on-demand doc), or demote something else to indirect to make room. Triggered 2026-06-12 when a credentials section initially landed as full inline policy and got corrected to a pointer; the principle generalizes: **direct knowledge is "where to look + the one rule that can't wait"; everything else is indirect.**

Mechanics worth considering: a generate-docs check that fails (or warns) when agent-guide.md exceeds the budget; a per-section line allowance; pairing with [Doc usage mining — what agents actually open](2026-05-28-doc-usage-mining.md) so demotion candidates are chosen by observed usage rather than guesswork. Connects to the [Capability map for the boxholder agent](2026-05-19-capability-map.md) global-vs-conditional-load question and the IA pass below — all three are the same tension (context cost vs. discoverability) at different scales.
