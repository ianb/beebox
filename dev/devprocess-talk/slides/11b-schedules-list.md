# Fifteen schedules on one screen
## Supporting: bin/schedules list, Oct 9, and what each produced
```text
scheduler: last tick 0w ago
agent-docs-refresh  every 1w  last 29h ago (handoff)  [1 alert(s)]
box-convergence     every 1h  last 0w ago (clean)
deferred-issues     every 1h  last 0w ago (clean)
full-suite          every 1h  last 1h ago (clean)
knip-sweep          every 1w  last 2d ago (handoff)  [2 alert(s)]
retrospective       every 3d  last 34h ago (handoff) [3 alert(s)]
sdk-update          every 1d  last 13h ago (handoff) [5 alert(s)]
smoke-review        every 1w  last 41h ago (handoff) [1 alert(s)]
tour-check          every 1w  last 36h ago (handoff) [2 alert(s)]
```

| Schedule | Runs / agent sessions | Produced |
|---|---|---|
| full-suite (1h, run-only) | 871 / 0 | 29 red landings attributed, 28 closed |
| sdk-update (1d, handoff) | 46 / 36 | 23 SDK bumps landed, 15 issues, a 3,293-line ledger |
| knip-sweep (1w) | 8 / 7 | 19 dead-code commits |
| tour-check (1w) | 7 / 7 | "three of five tours had been silently failing for months" before it |
| smoke-review (1w) | 8 / 7 | found landings nobody walks |
| retrospective (3d) | 2 / 2 | 3 guidance edits in its first day |

Notes:
Full table in reports/sweep-unattended-multimodel.md. 91 commits on main came from schedule workstreams; 48 public issues trace to runs.
