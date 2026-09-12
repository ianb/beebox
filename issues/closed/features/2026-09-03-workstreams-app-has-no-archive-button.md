---
title: "The workstreams app offers no Archive or Unarchive; only the CLI can archive a row"
workstream: unattached
area: beebox
labels: [workstreams, ui]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder looked for the archive option and could not find it
priority: important
resolution: implemented
---

`bin/workstreams archive <name>` / `unarchive <name>` exist, the app's shared
verb list (`workstreams-app/src/shared/actions.ts`) includes both, and the
server's action runner passes any verb through to the CLI. The frontend has
never rendered a button for either: `workstreamActionVerbs`
(`workstreams-app/src/frontend/components/WorkstreamActions.tsx`) yields only
focus, close, resume, and retry, and has since the app's first commit
(2026-08-13). The page does render an "Archived" section for rows the CLI
archived, so the read side exists and the write side does not.

The CLI's rules say when the verb applies: never for a scheduled record
(disable it in `schedule.yaml` instead), and never for a row removed with
unmerged work (it refuses to hide recovery state). So the button belongs on
dormant, culled-and-merged, and stale rows, and Unarchive on rows in the
Archived section. The boxholder lives in the web UI; a verb only the CLI
offers is a verb they cannot reach.


## Fixed 2026-09-12

`workstreamActionVerbs` now yields `archive` and `unarchive`, and
`WorkstreamActions` renders a button for each. Nothing else changed — the
shared verb list and the server's pass-through already carried both; only the
frontend never offered them.

Which rows get the verb mirrors the CLI's own refusals, so the button never
offers what `bin/workstreams archive` will reject:

- **Archive** on settled rows only — dormant, stale, and culled-and-merged.
- **Never** on a scheduled record (`enabled: false` in its `schedule.yaml` is
  how you stop one) or on a row removed with UNMERGED work (archiving would
  hide recovery state).
- **Unarchive** is an archived row's only verb: the others act on something the
  boxholder deliberately put away.

`test/workstream-archive-actions.doctest.md` pins each of those cases,
including both halves of the culled split — merged is archivable, unmerged is
not. `workstream-launching-ui.doctest.md` needed its dormant expectation
updated for the new verb, with a note saying why.
