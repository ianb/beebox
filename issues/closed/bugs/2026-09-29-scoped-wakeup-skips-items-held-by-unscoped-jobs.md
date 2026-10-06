---
title: "A connector-scoped wakeup skips inbox items that an unscoped intake job already holds"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
resolution: implemented
discovered-in: worktree-card-fields-review — cross-model review of the job-routing change (connector replaces source)
---

A full wakeup creates intake jobs with no `connector`. A later
connector-scoped wakeup (for example gmail) collects the refs of every
existing job (`beebox/src/cli/commands/wakeup/steps.ts`,
`collectExistingJobRefs`), so it treats an item held by an unscoped job as
already jobbed and creates no job for it. The scoped reactor then filters
jobs by `connector` (`beebox/src/core/reactor/job-discovery.ts`), so it
also skips the unscoped job. The item waits for the next full wakeup.

The same gap existed when jobs routed by `source`: a scoped run filtered on
the connector name and skipped `source: wakeup` jobs. The delay is bounded
by the full-wakeup cadence, so it is a latency problem, not a lost item.

Options: collect existing refs only from jobs the scoped run will process,
or move matching refs from the unscoped job into a connector job.

## Resolution

A scoped wakeup now counts an item held only by an intake job its reactor
skips (another connector's, or unscoped) as unjobbed. The item joins the
scoped job and is removed from the other job, which is deleted when that
empties it (`beebox/src/cli/commands/wakeup/steps.ts`,
`removeItemsFromIntakeJob` in `beebox/src/job-cards/intake-utils.ts`).
