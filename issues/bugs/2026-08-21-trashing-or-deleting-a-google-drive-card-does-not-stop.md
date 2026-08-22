---
title: "Trashing or deleting a Google Drive card does not stop it syncing"
workstream: unattached
area: callback-box
filed-by: agent
discovered-in: worktree-user-stories-refresh — user-story catalog verification
stories: [connectors/stop-syncing-something-by-deleting-its-card]
---

**What is wrong.** The Drive connector's untracking story is 'the card's existence IS the config' (header comment, `callback-box/src/connectors/google-drive.ts:1-11`; also `src/connectors/drive-config.ts:7`), and the Gmail connector implements exactly that. The Drive connector does not, in two distinct ways.

1. *Trashed cards keep syncing.* The working-set glob is `glob("**/*.${h.cardType}.card", { cwd: this.boxRoot })` with no ignore list (`google-drive.ts:139-145`). `cb trash` soft-deletes by moving the card into `getBoxDir(boxRoot, "trash")` = `store/trash` (`src/core/commands/trash.ts:140`, `src/lib/box-layout-spec.ts:158-159`), which is inside the box root. The trashed card is therefore still globbed, still yields a `drive-id` via `readDriveIdFromCard`, and `syncFile` keeps pulling Drive changes into it — and pushing local edits back out to Drive — from its trash path. Compare `src/connectors/gmail-tracking.ts:10-18`, whose `TRACKED_THREAD_IGNORE` covers `store/trash/**`, `.git/**`, `node_modules/**`, `tmp/**`, `.callback-box/**`, `procedure/runs/**`.

2. *Folder-mounted cards come back after deletion.* `syncFolder` (`google-drive.ts:274-323`) lists the mounted Drive folder and creates a card for every file whose id is not in `existingDriveIds` (the ids harvested from the glob). Hard-deleting the card removes it from that set, so the next sync re-creates the card at `<folder.localPath>/<safeName>.<cardType>.card` and resumes syncing it. Untracking such a file actually requires editing the folder entry out of `config/connectors/google-drive.json`.

**User-visible consequence.** A box owner who trashes a Drive card expects the file to stop syncing; instead the box keeps writing Drive updates into `store/trash/` and committing them, and local edits made before the trash can still be pushed up to the live Google document. A box owner who deletes a folder-mounted card sees it silently reappear on the next `cb wakeup`, with no indication that the folder mount, not the card, is what tracks it. Both cases contradict the documented rule, and the second means untracking has a separate unsubscribe step after all.

**Files involved.** `callback-box/src/connectors/google-drive.ts` (glob at 139-145; `syncFolder` at 274-323), `callback-box/src/connectors/gmail-tracking.ts` (the ignore list that gets it right), `callback-box/src/core/commands/trash.ts:140` and `callback-box/src/lib/box-layout-spec.ts:158-159` (where trash lives), `callback-box/src/connectors/drive-config.ts` (folder mounts).

**How this was established.** Read both connectors' working-set construction and compared them; traced `cb trash`'s destination to `store/trash` under the box root and confirmed the Drive glob has no `ignore` option, so that path is in scope; read `syncFolder`'s `existingDriveIds` skip condition and its `fs.access` existence check, both of which pass for a deleted card and lead to re-creation. Note the Drive glob also lacks the `node_modules/**` and `.git/**` guards Gmail has.

## Updating the user-story catalog

This issue is why [`connectors/stop-syncing-something-by-deleting-its-card`](../../callback-box/user-stories/catalog/2026-08-21.md#flagged-worth-a-human-glance) is currently
flagged ❌ in [the user-story catalog](../../callback-box/user-stories/catalog/2026-08-21.md) — a catalogue of what callback-box can
actually do, where every claim is checked against the source.

**When you fix this, re-check that story so the catalog stops being wrong.** It is a
short agent run over just the affected stories, not the full regeneration:

```
Workflow({scriptPath: "callback-box/user-stories/pipeline/recheck.workflow.mjs",
          args: {root: "<repo root>", date: "2026-08-21",
                 ids: ["connectors/stop-syncing-something-by-deleting-its-card"]}})

pnpm exec tsx callback-box/user-stories/pipeline/apply-recheck.ts 2026-08-21
pnpm exec tsx callback-box/user-stories/pipeline/render.ts \
  > callback-box/user-stories/catalog/2026-08-21.md
```

The recheck is adversarial by design: it will not mark the story accurate just because
this issue was closed — it re-reads the code. If it still refutes, that is worth knowing
before you call the fix done. Details in
[the pipeline README](../../callback-box/user-stories/README.md).
