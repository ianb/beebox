---
title: "A connector-scoped wakeup skips inbox items that an unscoped intake job already holds"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
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
