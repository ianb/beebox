---
title: "drive mounting file browsing ui"
workstream: drive-folder-mounts
needs: [decision]
area: callback-box
resolution: implemented
---

**Closed 2026-08-26:** the decision landed as the fuller of the two options
this issue sketched — not the small `updateConfig`-writer CLI command, but the
card-based redesign in `callback-box/docs/implemented-plans/drive-folder-mounts.md`
(commit 544fa0c96 and the `bin/land` merge that follows it). A folder mount is
now a `.gfolder.card` (not a config entry or a browsed-and-picked tree), driven
from both `DriveSection.tsx` settings and `cb drive mount`/`link`/`unmount`.
The dead `updateConfig`/`available` procedures are gone from the `drive`
router, replaced by `mounts`/`mount`/`unmount`/`link`/`syncFolder`.

Surfaced by the user-story audit (`docs/plans/user-story-audit-followups.md` D9).
The Drive backend is built but has no driver: `src/webapp/trpc/routers/drive.ts`
exposes `available` (lists spreadsheets), `inspect` (file details — currently
dead, no caller), and `updateConfig` (folder-mount config), but **no UI or CLI
calls `updateConfig`**, and `DriveSection.tsx` documents itself as read-only with
"mounting is done via CLI" — except no such CLI command exists. So configuring
which Drive folders sync to which local paths means hand-editing
`config/connectors/google-drive.json`.

Two ways to give it a driver:
- **`cb drive mount <folder-id-or-url> <local-path>`** (smaller). A CLI command
  that writes the mount into the connector config, mirroring `cb drive add`.
  Lowest-effort; agent- and human-usable; no new UI surface.
- **A folder-browser in `DriveSection.tsx`** (bigger). Browse the Drive tree,
  pick folders, call the existing `updateConfig` mutation. This is the "browse
  and select files is a whole feature" the maintainer flagged — real tree-paging
  UI, the dead `inspect` endpoint finally gets a caller, but a lot more work.

Maintainer hasn't experimented with Drive mounting at all, so this is exploratory
— start with the CLI command if/when there's a real need, promote to UI later.
Resolve the dead `inspect` endpoint as part of whichever path is taken (wire it
up or delete it).

**Amended 2026-08-26:** the tRPC router never had an `inspect` procedure — only
the CLI `cb drive inspect` exists (and works); the "dead endpoint" line above
is stale. The rest stands. Superseded in direction by
`callback-box/docs/plans/drive-folder-mounts.md`, which makes a folder mount a
card (`.gfolder.card`) rather than a config entry.
