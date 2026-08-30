---
title: "Regular doc refreshes (docs-claim vs. code adjudication)"
workstream: unknown
---

2026-07-04 · process to institutionalize.

The 2026-07 docs reorg found that the highest-value doc auditing wasn't
link-checking (now automated via `pnpm doc-check`) but adjudicating
**docs claim X, code does Y — which is right?** That pass caught one real
bug (reactor session resume was broken, not the doc) and one real doc error
(wakeup's description predated the reactor), and neither direction is
detectable by freshness tooling.

Proposal: a periodic doc-refresh pass (add to
`beebox/docs/maintenance.md` with a cadence, or a scheduled routine):

1. `pnpm doc-graph` + `doc-check` (mechanical layer — already enforced at
   commit time, so this is just the report).
2. Sample the live reference docs (flat `docs/`, `docs/design/`, module
   CLAUDE.mds) and spot-check their concrete claims against code —
   explicitly deciding per divergence whether the doc or the code is wrong.
3. Anthropic's own guidance: re-audit CLAUDE.md content after model
   releases — strip instructions that existed to work around a weaker
   model's limitations.

The 2026-07 baseline (docs verified against code) makes drift-since-last-
refresh a meaningful signal; keep the cadence low (quarterly-ish) so it
stays an adjudication, not a chore.
