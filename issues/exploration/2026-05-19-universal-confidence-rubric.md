---
title: "universal confidence rubric"
needs: [design]
area: callback-box
---

Percentage confidence numbers have no shared meaning — neither model nor user has calibrated 65%-vs-70% intuitions, so "60% confidence" is theater. But gradation itself is real and useful, provided each level is defined by an operational rubric: what evidence justifies it, what behavior it licenses, what promotes or demotes it. Draft bands:

- **Fact** — observed directly or stated by the user/source. Acted on without hedging. (Effectively "100%.")
- **Likely** — multiple consistent signals, or one strong direct signal not yet confirmed. Agent acts on it but stays ready to be corrected; may surface as "I'm assuming X — say if that's off."
- **Suspected** — one signal, or a pattern that fits but could be coincidence. Agent uses it to *steer* (e.g., avoid asking the wrong question) but doesn't act on it directly. Refutation trigger required.
- **Speculative** — possibility worth holding onto in case more evidence appears. Agent watches; does not act, does not hint.

Universality is the point: the same rubric applies wherever the agent commits to something below fact level — hypotheses (see below), cache-staleness assessments (see *Cache freshness, surfaced conditionally* in [prompt-audits.md](../../callback-box/docs/prompt-audits.md#cache-freshness-surfaced-conditionally) in prompt-audits.md), user-model dimensions, anything inferred from observation. A single shared vocabulary means the agent reasons consistently across these domains and the boxholder sees consistent hedging language.

Open questions:
- Are four bands the right count? Three (fact / likely / hunch) might be enough.
- How is band assignment surfaced — inline tag, separate field, structural placement (different files)?
- Demotion path: does evidence-against move a "likely" to "suspected," or straight out? Probably depends on the kind of evidence.
