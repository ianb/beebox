---
title: "`bin/smoke --report` lost 63 runs at the rename, and reports the remainder as all-time"
workstream: smoke-review
area: monorepo
labels: [tests]
filed-by: agent
discovered-by: agent
discovered-in: worktree-smoke-review — the weekly smoke-tier review, 2026-09-02
priority: normal
---

`smokeLogPath` (`bin/smoke-lib.ts:113`) derives the log's name from the product
name, so the 2026-08-30 product rename (`35c1e38df`) moved it from
`callback-smoke-log.jsonl` to `beebox-smoke-log.jsonl`. Nothing
migrated the old file. Both still sit in the shared git dir; `--report` reads
only the second one.

The tier is six days older than that rename, so this is most of its life:

|                        | `--report` says | actually |
| ---------------------- | --------------: | -------: |
| runs, all time         |              21 |       80 |
| runs, 2026-08-26→09-02 |              21 |       76 |
| fault injections ever  |               0 |        4 |

(Run counts exclude fault-injected runs, as `--report` does; 84 lines total
across the two files.)

The report does not know it is truncated, and it says "21 runs logged" without
qualification, so the number reads as the tier's whole record.

## Why this matters more than the arithmetic

The weekly `smoke-review` schedule exists to decide, from these counts, whether
a step still earns its two-minute slot. It ran against the truncated table this
week. Merging both logs (fault-injected runs excluded, as `--report` does):

```
step             ran  failed     p50   last failure        --report said
restart           80       6    1.2s   2026-09-02T18:10Z   ran 21, failed 6
cold-start        74       3    8.2s   2026-08-30T23:05Z   ran 15, failed 3
chat-shell        70       5    6.4s   2026-08-26T22:08Z   ran 12, NEVER FAILED
place-menu        65       3    3.6s   2026-08-31T22:19Z   ran 12, failed 1
browse-list       61       0    3.3s   never               ran 11, never failed
card-open         61       0    5.4s   never               ran 11, never failed
page-errors       61       0    0.5s   never               ran 11, never failed
place-switch      39       1    7.5s   2026-08-28T23:54Z   ran 11, NEVER FAILED
backend           18       1    4.6s   2026-08-26T22:42Z   absent
```

Two steps the report calls "never failed" have caught something. `place-switch`
is the one that hurts: it was added because a menu that listed all seven
landmarks and moved you nowhere passed every assertion `place-menu` makes, and
it is the most expensive step in the walk at 7.5s. A trim argued from "11 runs,
never failed, costs the most" is exactly the argument the truncated table
supports and the full one refutes. A step that has retired is also invisible —
`backend` ran 18 times and does not appear at all.

The fault-injection line is the other loss. Two of the four declared injections
(2026-08-28T15:09Z and 15:24Z) were `PlacePill onSelectLandmark` made a no-op —
the deliberate proof that `place-switch` goes red on the 2026-08-20 shape. The
review's briefing printed "Fault-injected runs in this window (0). None." The
tier's own evidence that its wiring works is in the file nothing reads.

Coverage reads wrong in the same direction. The briefing compared 21 runs
against 159 landings on `main` and invites the conclusion that the gate is
barely running. Of those 159 first-parent landings, 21 touch a deployed path
(`DEPLOYED_PATHS_PATTERN`, `bin/deployed-paths.ts`) and therefore owe a walk;
the merged logs hold 76 in-window runs across 18 worktree branches. The gate is
running on everything it should, several times per landing. The truncated
number says the opposite.

## Directions

Migrating the one file by hand fixes today and not the next rename. The
durable shapes, roughly in order of appeal:

- `--report` reads every `*-smoke-log.jsonl` in the git common dir and
  concatenates by `ts`. Old names keep working, no migration step, and a future
  rename is a non-event. Costs a glob where there was a constant.
- Name the log for the thing rather than the product — `smoke-log.jsonl` — and
  migrate once. Smaller code; still a one-time hand migration, and the same bug
  recurs for anything else keyed on the product name.
- Have the report state its own range (`21 runs logged, 2026-08-30 → 2026-09-02`)
  whichever of the above lands. A dated range would have made this visible in
  the first review after the rename instead of the third.

`beebox-test-ledger.jsonl` / `beebox-test-filesets.jsonl` and the
`beebox-test-locks/` directory were renamed the same way (`bin/test-ledger-lib.ts:295`),
stranding a 13.7MB `callback-test-ledger.jsonl`. That one is a selector cache
that rebuilds, so it is cheaper to lose — but it is the same defect, and worth
fixing in the same pass.

Related: [smoke runs leave no record](../closed/code-quality/2026-08-26-smoke-runs-are-not-in-the-test-ledger.md),
[merge-time smoke tier](../closed/exploration/2026-08-26-merge-time-smoke-tier.md).
