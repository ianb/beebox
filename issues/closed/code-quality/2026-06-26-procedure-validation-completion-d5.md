---
title: "procedure validation completion d5"
area: callback-box
resolution: implemented
---

**Closed:** Done: model-judged instruction validation, `severity: review` auto-retry, and resumable runs (`cb procedure resume`) all landed. See `docs/procedure-implementation.md`.

All three landed. `src/core/procedure/engine-phase.ts` does **model-judged
instruction validation** against the step's git diff (no longer a pass-by-default
stub), and `engine-step.ts` / `engine-run-phase.ts` implement **`severity: review`
auto-retry** — a bounded self-heal that re-invokes the agent with the failure
context (cost-ceiling guarded) and gates the step when it can't heal. The final
piece, **resumable runs from a failed step**, now ships as `cb procedure resume
[run-dir]` (`resumeProcedure` in `engine.ts`): it re-enters the existing run dir
at the first not-`completed`/`skipped` step — the failed one — re-running it and
everything after while leaving earlier completed/skipped steps untouched. Run
orchestration (`runSteps`/`finalizeRun`) is shared with `startProcedure` via
`engine-orchestrate.ts`. See `docs/procedure-implementation.md`.
