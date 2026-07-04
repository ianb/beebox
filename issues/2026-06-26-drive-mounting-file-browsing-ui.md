---
needs: [decision]
area: callback-box
---

# Google Drive mounting / file browsing UI

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
