---
title: "Field-test quiescence times out on a gmail intake job that never drains"
area: callback-box
filed-by: agent
discovered-in: worktree-integration-tests — field-test onboarding-first-days (dentist-email)
labels: [field-test-findings]
---

In the first full onboarding run, the `dentist-email` item's checks passed
(1/1 — the email became a task), but the harness quiescence check then timed
out "still busy: jobs", and the next item (`whats-needed`) began with "box was
not quiescent before the item: jobs". A `2026-08-11T08-40-00-gmail.intake.job.card`
sat in `box/jobs/` and never drained.

The `inject-email` pre-action runs a connector-scoped `cb wakeup --connector
gmail` (sync + reactor scoped to gmail). That created the email thread card and
an intake job. Something then left an intake job card behind that the scoped
wakeup's reactor did not clear — so composite quiescence (which requires
`box/jobs` empty) can never pass, and every email-bearing item eats its full
quiescence timeout before proceeding.

Two candidate fixes to weigh (needs a look at the wakeup/intake ordering):
- The pre-action should drain the intake job it creates (run an unscoped
  reactor pass, or a full wakeup, after injecting) before returning.
- Or quiescence should treat a not-yet-picked-up intake job the way it already
  treats background job types (excluded by name in the chunk-2 quiescence
  logic) — but only if such a job genuinely isn't work the run is waiting on,
  which for a freshly injected email it IS.

Distinct from the excluded `contains-backfill` background jobs; this is a
real intake job for the injected mail. Low urgency (the run completes; it just
wastes a timeout per email item) but it will recur every email run.
