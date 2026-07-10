---
title: "decision shaped thinking discipline"
area: callback-box
---

"Council" architectures (multiple agents deliberating in rounds) are mostly theater when the agents share the same underlying model and inputs — the diversity is in prompts, not priors, and they converge. The valuable *outputs* of a council (multiple paths considered, strongest cases surfaced, committed decision with dissent) come from a thinking discipline, not the architecture. A single agent with a good deliberation prompt produces the same outputs cheaper.

Draft template for a reusable deliberation prompt, applicable to any decision-shaped task:

1. **Enumerate the valid paths** — at least two, genuinely distinct, no strawmen.
2. **Steelman each** — what makes it the right call? Best version, not weakest.
3. **Name the decisive question** — what evidence or consideration would distinguish them? If there isn't one, the paths aren't actually distinct.
4. **Commit, with named dissent** — pick a path. State the strongest case against it explicitly. Commitments with named dissent are more trustworthy than commitments without.

When the architecture version (actual subagents) still earns its keep: only when perspectives need to be grounded in *genuinely different inputs* (one agent sees only calendar, another only email, etc.) — the case already covered in the [Subagent strategy for callback-box](2026-05-19-subagent-strategy.md) entry.

Worth drafting as a reusable prompt fragment the boxholder agent can invoke for non-trivial decisions, rather than per-decision improvisation.
