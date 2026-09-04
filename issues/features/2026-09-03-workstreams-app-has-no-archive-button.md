---
title: "The workstreams app offers no Archive or Unarchive; only the CLI can archive a row"
workstream: unattached
area: beebox
labels: [workstreams, ui]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder looked for the archive option and could not find it
priority: important
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
