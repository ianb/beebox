---
title: "retrospective integration d6"
workstream: unknown
area: beebox
resolution: implemented
---

**Closed:** Done (as a procedure, not code): belief updates happen in an `<agent>` step in `templates/procedures/process-retrospective.procedure.card`; integration drains the whole backlog and strengthens existing beliefs. The loop has closed end-to-end on test1.

Integration is intentionally NOT `integrate.ts`. Belief updates are
judgment, not a deterministic transform, so they stay an `<agent>` step in
`templates/procedures/process-retrospective.procedure.card`: the procedure
arranges the inputs (full ledger, current belief cards, pending reports,
target-card candidates) and the agent applies the evidence model, escalates
to question cards where policy requires, finalizes the report, and commits
with a `Retro-Run` trailer. The loop has closed end-to-end on test1 and
edited real belief cards.

The remaining work (done in this pass) was reliability + context, not a new
component: integration now drains the **whole backlog** keyed off the ledger
(previously it keyed off only the latest report via `ls -t | head -1`, so an
observation that landed in an earlier report was stranded behind a newer
run), it's handed the current belief state so it strengthens an existing
belief instead of adding near-duplicates, and the weekly schedule
(`config/schedules/process-retrospective.scheduled-script.card`) is enabled
once a few manual runs are reviewed. Maintainer: "analysis must end with
integration" — it does.
