---
title: "full-suite files a fresh red report every hour for the same failure, each blaming its own previous report commit"
workstream: full-suite-report-loop
area: monorepo
labels: [tests, schedules]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "there were failing schedules again…?" turned up 13 reports for one failure
resolution: implemented
---

> Closed 2026-08-27: `c6be8b524` carries completed-run known-red state, rejects
> non-deployed bisect results, and names reports for their failing files.

Overnight 2026-08-26→27 one real failure (`annotations.doctest.md`, broken by
the `drive-folder-mounts` landing `1ae39b40`) produced THIRTEEN issues and
thirteen commits on main. The first report was correct. Every hourly run after
it: still red → bisect from "last tested commit" → the only new landing is the
schedule's own previous `chore(issues): full-suite red after …` docs-only
commit → blame it, file another issue, commit again. A feedback loop where the
reporter's own commits are the only thing left to blame.

Two missing pieces in `schedules/full-suite/` (both named in the retro,
`issues/exploration/2026-08-26-post-test-economics-retro.md`, improvement 1):

1. **Carry known-red files forward.** A file already red at the baseline is not
   attributable to a new landing; the report for it already exists. Re-file
   only on a NEW failing file (or a recovery).
2. **A docs-only landing cannot be blamed** for a code test failure — the same
   "deployed paths" rule the deploy hook uses should bound the bisect's
   candidate set.

Cleanup done 2026-08-27: the twelve duplicates closed as superseded into the
first report; the underlying id collision fixed.
