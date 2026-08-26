---
title: "Smoke runs leave no record, so 'how often does the smoke tier fail?' is unanswerable"
workstream: unattached
area: monorepo
needs: [design]
labels: [tests]
filed-by: agent
discovered-by: agent
discovered-in: building the merge-time smoke tier (2026-08-26)
---

`bin/smoke` prints its verdict and exits; nothing durable records that it ran.
`bin/test-ledger.ts` records every other run, which is what makes flake rates,
`careful.txt` candidates and the full-suite schedule's "last commit tested"
answerable. The smoke tier has none of that: after a month we will not be able
to say how often it went red, on which commits, or whether any of its steps is
itself flaky — the questions the ledger exists to answer.

Not done at the time because `LedgerRecord` is TAP-file-shaped (`ranFiles` and
`implicated` are fileset hashes, `failures[]` names files, `mode` is
`full | selected`) and a smoke run has no files — it has named steps. Bending
the record needs a decision from whoever owns the ledger's vocabulary, and
`bin/test-*` was live under the test-economics workstream that week.

Options, roughly in order of appeal:

- A `mode: "smoke"` record whose `failures[]` carries step names rather than
  file paths, with the derived-flake machinery excluding it (it has no
  isolated re-run, so fail-then-pass means nothing there).
- A separate append-only log beside the ledger, and `test-ledger report`
  learns to read both. Avoids bending a schema; adds a second store.
- Leave it unrecorded and rely on the `/finish` report. Cheapest, and
  defensible if the tier turns out to fail rarely and loudly.

Related: `issues/exploration/2026-08-26-merge-time-smoke-tier.md`.
