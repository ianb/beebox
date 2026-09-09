---
title: "`bin/smoke --report`'s trim footer sums p50s that a trim would not recover"
workstream: smoke-review
area: monorepo
labels: [tests]
filed-by: agent
discovered-by: agent
discovered-in: worktree-smoke-review — the weekly smoke-tier review, 2026-09-09
---

`formatSmokeReport` (`bin/smoke-lib.ts:262-275`) ends every report with a
trim nomination. The rule is two counts:

```ts
const idle = summary.steps.filter(
  (step) => step.failed === 0 && step.ran >= TRIM_EVIDENCE_RUNS,
);
const seconds = idle.reduce((sum, step) => sum + step.medianSeconds, 0);
```

This week's report printed:

```
Never caught anything in 20+ runs, costing 3.8s of every walk: browse-list, page-errors.
```

Neither number supports a trim, and the weekly `smoke-review` schedule is
told to decide trims from exactly this footer.

## The stated cost is not recoverable

`browse-list` is 3.3s of the 3.8s. Its step body is
(`bin/smoke.ts`, step `browse-list`):

```ts
await session.open(`${baseUrl}/browse`);
const snapshot = await session.snapshot();
```

then two assertions. The `card-open` step that follows opens no page of its
own — it begins with `session.snapshot({ interactiveOnly: true })` and reads
the listing `browse-list` navigated to. So deleting `browse-list` does not
save 3.3s; it moves the navigation into `card-open` and saves the second
snapshot. The footer reports a prerequisite's total duration as though it
were slack.

`page-errors` is the other 0.5s. It is the cheapest step in the walk and holds
its only assertion on uncaught page errors (`session.run(["errors"])`). No
other step reads the console. 0.5s out of a 120s budget is not a cost worth
naming.

## The rule has no notion of a distinct failure mode

A step is trimmable when a long clean record meets a real cost *and* no
failure mode of its own — a step whose only failures an earlier step would
already have caught. That last part cannot be derived from `ran` and
`failed`; it comes from what the steps check. The current filter is
`failed === 0 && ran >= 20`, which is the naive reading of a clean log, and
the report prints it as its own recommendation.

The nomination it produces is also unstable in the wrong direction. `restart`
(p50 1.0s) escapes the footer only because it has failed 6 times; on a clean
month the walk's mandatory first step would be nominated too, and it is the
step the tier exists for — a box that cannot boot fails there. The steps a
count-based rule deletes first are the rare-but-catastrophic ones.

## Evidence from this review

Smoke steps, all time, at 2026-09-09 (142 runs, 36 red, 4 fault-injected
runs excluded):

```
step             ran  failed  forced     p50   last failure
restart          141       6       0    1.0s   2026-09-02T18:10:06.074Z
cold-start       136       6       2    7.9s   2026-09-05T06:51:27.326Z
backend           18       1       0    4.6s   2026-08-26T22:42:53.036Z
chat-shell       129       5       0    6.8s   2026-08-26T22:08:45.405Z
place-menu       124       3       0    3.6s   2026-08-31T22:19:16.011Z
browse-list      111       0       0    3.3s   never failed
card-open        111       5       0    5.5s   2026-09-08T05:19:49.667Z
page-errors      106       0       0    0.5s   never failed
place-switch      98      10       2    7.2s   2026-09-07T14:37:51.868Z
```

The 2026-09-09 review trimmed nothing. It read the footer, checked the two
nominated steps against `bin/smoke.ts`, and rejected both for the reasons
above.

## Directions

- Drop the seconds figure, or state only the part a trim recovers. The
  footer's job is to raise a candidate, and `ran`/`failed`/`p50` already do
  that; the summed total is the part that misleads.
- Say what the nomination is and is not. "Never failed in N runs — check
  whether an earlier step already covers it" is honest; "costing Ns of every
  walk" asserts a saving the code does not support.
- Exclude steps another step depends on. `browse-list` is a prerequisite
  navigation for `card-open`, and that relation is in the step list, not in
  the log.

Related: [`--report` lost 63 runs at the rename](../bugs/2026-09-02-smoke-report-lost-its-history-at-the-rename.md),
[merge-time smoke tier](../closed/exploration/2026-08-26-merge-time-smoke-tier.md).
