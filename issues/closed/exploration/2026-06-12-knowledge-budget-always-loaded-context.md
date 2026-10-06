---
title: "knowledge budget always loaded context"
workstream: doc-structure
needs: [design]
area: beebox
resolution: implemented
---

**Closed:** Resolved by [the agent guide spec](../../../beebox/docs/implemented-plans/agent-guide-spec.md)
(commit `d46da959b` and the tracks around it): `src/core/agent-guide/ledger.yaml`
gives every always-loaded rule a row, a bin (`law`/`core`/`indirect`/`delete`),
and a reason; `lint.ts` asserts the rendered guide and the always-loaded total
stay under the ledger's `budget:` header. The always-loaded guide went from
9,508 to 5,595 words (test1 clone) as a result of the binning this issue asked
for.

The always-loaded layer (agent-guide.md, CLAUDE.md includes, system prompts) has no size discipline: every addition feels individually justified, and the layer only grows. Establish an explicit budget — a token/line cap the always-loaded corpus must stay under — so adding direct knowledge forces a trade: make the new thing indirect (a pointer to an on-demand doc), or demote something else to indirect to make room. Triggered 2026-06-12 when a credentials section initially landed as full inline policy and got corrected to a pointer; the principle generalizes: **direct knowledge is "where to look + the one rule that can't wait"; everything else is indirect.**

Mechanics worth considering: a generate-docs check that fails (or warns) when agent-guide.md exceeds the budget; a per-section line allowance; pairing with [Doc usage mining — what agents actually open](../../exploration/2026-05-28-doc-usage-mining.md) so demotion candidates are chosen by observed usage rather than guesswork. Connects to the [Capability map for the boxholder agent](../../exploration/2026-05-19-capability-map.md) global-vs-conditional-load question and the IA pass below — all three are the same tension (context cost vs. discoverability) at different scales.
