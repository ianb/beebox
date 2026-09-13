# Plan-directory migration history

Archived on 2026-09-13 from the plan conventions page. Dates and follow-ups
below describe earlier checkpoints, not current tasks or verified file
locations. Use the [current plan conventions](../plans/README.md) when working
with plans today.

## Historical migration account (done)

This dated account records the first backlog migration; it is not the current
plan index. The first backlog batch was migrated and its then-known `docs/…`
references rewritten:

- → `implemented-plans/`: `selection-commentary.md`, `markdoc-tags-plan.md`
  (+ `.review.md`, `.review-adapted-trial.md`), `markdoc-format-investigation.md`,
  `shared-frontend-backend-code.subplan.md`, `narration-mode-design.md`
  (feature shipped, despite the doc's stale "proposal" header — later
  found to be inaccurate; see 2026-07-04 below).
- → `plans/` (still open): `pdf-intake-design.md` (partially implemented; its
  remaining historical and superseded material is labeled in the plan),
  `source-editor.md` (unimplemented proposal). The intake → triage → handle
  core was built, while several mechanisms in its design were not; current
  operation is in `docs/triage.md` and the mixed design record is in
  `docs/reports/triage-design-2026-09-13.md`.

**2026-07-04:** `implemented-plans/narration-mode-design.md` was moved back
to `plans/narration-mode.md` — the doc opens "Status: proposal, for
discussion" and was never actually implemented; its earlier placement in
`implemented-plans/` above was a misfiling, not a correction.

**Follow-ups:**
- Regenerate the doc graph (`pnpm doc-graph`) — it's generated and still shows
  the old paths; it self-heals on the next run.
- A few more plan-shaped docs remain in `docs/` and need a judgment call on
  reference-vs-proposal before moving: `activities-design-2026-04-19.md`,
  `event-bus.md`, `photo-storage-investigation.md`. Left in place
  (some read more like vision/reference than active proposals — `design.md`,
  `design-vision.md`, `stack-decisions.md` were judged reference and stayed
  at the time; on 2026-07-04 the design-reconciliation execution split
  `design.md` into `docs/design/` and retired `design-vision.md` to
  `unimplemented-plans/design-vision-superseded.md`).
  `design-card-views.md` has since moved to `unimplemented-plans/`
  (superseded by the shipped renderer registry, now
  `design-card-views-superseded.md`), `attach-implementation.md`
  to `implemented-plans/` (superseded by `docs/asset-manifests.md`, now
  `attach-directories-superseded.md`), and
  `capture-pipeline-redesign.md` to `unimplemented-plans/` (parked 2026-03).
