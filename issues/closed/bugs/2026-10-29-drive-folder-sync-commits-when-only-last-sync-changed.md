---
title: "Drive folder sync commits every pass, because `last-sync` on the folder card always changes"
workstream: drive-sync-noop-commits
area: beebox
labels: [connectors, google-drive, git-history]
resolution: implemented
filed-by: agent
discovered-by: Ian
discovered-in: "main session — boxholder looking at a box's commit history, 2026-10-29"
---

Resolved by plan `beebox/docs/implemented-plans/drive-sync-time-out-of-card.md` (commits bd8223f78, 7b30d768a, eeea955df on `worktree-drive-sync-noop-commits`): the sync time moved into the gitignored Drive state, the folder card is written only when its content changes, and migration `gfolder-last-sync-2026-10` strips `last-sync` from existing cards. Calendar and Gmail were checked and do not commit on a pass that changed nothing.

A box's history fills with "Sync Google Drive: 1 updated" commits, several an
hour, each a one-line diff on the mount's `.gfolder.card`:

```
-last-sync: 2026-10-29T16:01:27.963Z
+last-sync: 2026-10-29T16:16:48.091Z
```

Nothing in Drive changed. `stampOutcome`
(`src/connectors/google-drive/folder-sync.ts`) stamps the current time into
`last-sync` on every pass, and `stampGfolderCard`
(`src/connectors/google-drive/card-stamp.ts`) writes the card even when
nothing else differs. The sync then counts the card as updated and commits.
`stampGlinkCard` in the same file already skips the write when the fields are
unchanged.

The boxholder's ask: a pass that changed nothing makes no commit; the
`last-sync` time does not count as a change.

Directions:

- **Keep the sync time out of the card.** Store it in gitignored runtime
  state under `.beebox/`, keyed by the folder card, and have the readers use
  it: `src/frontend/src/renderers/gfolder.tsx` ("last sync" and the
  mirrored / never-synced badge), `DriveMountRow.tsx`, `mount-list.ts`,
  `tracking.ts`, and `bbx drive status`. The card keeps what Drive
  says (title, link) and `error`, which change only when something happened.
  The schema text in `src/schemas/gfolder.ts` that documents `last-sync`
  changes with it, and existing cards need the field dropped (a migration).
- **Smaller: skip the write when only `last-sync` would change.** The card's
  date then means "last pass that changed something", while the UI labels it
  "last sync", so this only fits if the label changes too.

The first is the strict reading of the ask. Check whether other connectors
(calendar, email) stamp a run time into cards the same way.
