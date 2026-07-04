---
needs: [design]
area: callback-box
---

# Surfacing context-size measurements well

The knowledge-audit report shows each audit's loaded-context size — `initial` (the always-on baseline the box pays every turn) → `peak` (+`added` over N turns), read from the session JSONL's per-turn `usage` (`lib/context-usage.ts`) — and every run appends those numbers to a committed history ledger (`src/dev/context-history.yaml`, `lib/context-history.ts`), so the git history is a free trend line. That closes the *raw-measurement* and *persistence* halves of the loop. What's left is making the trend **legible and enforceable** rather than something you reconstruct by diffing the ledger by hand:

- **Run-over-run delta in the report — DONE.** Each audit's context line now carries the change since the prior run (`Context: 38k initial (4 turns; −3k from last run)`), read from the ledger before the current run is appended (`lib/report.ts` `formatBaselineDelta`, wired in `knowledge-audit.ts`).
- **Aggregate summary at the top of the report — DONE.** The report opens with a `## Context baselines` table of every audit's baseline sorted high→low with its Δ-last-run, and calls out the lowest baseline as the cleanest estimate of the pure always-on tier (`lib/report.ts` `renderContextSummary`).
- **Baseline-ceiling assertion (the deferred check).** Once the ledger establishes a known-good baseline, a per-box budget in the audit config that fails the run when `initial` exceeds it — catches always-on bloat the way a bundle-size check catches JS bloat. Caveat already noted: `initial` includes the audit prompt + harness `WORKING DIRECTORY:` system prompt, a small constant that an absolute ceiling has to account for.
- **Compositional breakdown.** The most *actionable* and the most work: split the baseline into system prompt vs. agent-guide vs. box CLAUDE.md vs. tool schemas, so you know *which* tier to trim. The JSONL doesn't break `usage` down this way — it'd mean token-counting each component separately (the API's count-tokens endpoint, or a local tokenizer) and reconciling against the measured total.

Open questions: whether the trend belongs in the audit report or in a dedicated `cb context-budget` command that runs the 0-read audits purely as a measurement harness; how the ledger handles a box being audited from many worktrees (the box clone's HEAD churns on template-sync — see the harness note); whether the breakdown is worth the second token-counting pass or whether the ledger + a delta already give cb-context everything it needs.
