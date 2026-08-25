---
title: "Trashing a Google Drive card does not stop it syncing"
workstream: connector-sync-isolation
design: ../../../callback-box/docs/implemented-plans/connector-sync-isolation.md
area: callback-box
filed-by: agent
discovered-in: worktree-user-stories-refresh — user-story catalog verification
resolution: implemented
---

> **Resolved by `878a393c` in `connector-sync-isolation`.** Drive sync and status now share one live-card scan. Cards in semantic trash do not sync, while their Drive IDs suppress folder rediscovery. Restoring the card resumes sync; hard deletion leaves the configured folder authoritative and performs a fresh materialization. Focused filesystem doctests, a knowledge audit, and an independent source recheck passed; no live authenticated Google account was available.

**What is wrong.** The Drive connector's untracking story is 'the card's existence IS the config' (header comment, `callback-box/src/connectors/google-drive.ts:1-11`; also `src/connectors/drive-config.ts:7`), and the Gmail connector implements exactly that. Drive has one direct violation plus one folder-mount ambiguity.

**Planning correction.** The first mechanism below is the connector bug. The
second is a contract conflict, not the same bug: a configured folder mount is
also explicit tracking state, so raw hard deletion removes the only per-child
record while leaving the folder subscription in force. The implementation plan
therefore uses the already-committed trash card as the durable per-child
tombstone. It deliberately does not add a second hidden discovery-history
store merely to make raw hard deletion override a folder mount.

1. *Trashed cards keep syncing.* The working-set glob is `glob("**/*.${h.cardType}.card", { cwd: this.boxRoot })` with no ignore list (`google-drive.ts:139-145`). `cb trash` soft-deletes by moving the card into `getBoxDir(boxRoot, "trash")` = `store/trash` (`src/core/commands/trash.ts:140`, `src/lib/box-layout-spec.ts:158-159`), which is inside the box root. The trashed card is therefore still globbed, still yields a `drive-id` via `readDriveIdFromCard`, and `syncFile` keeps pulling Drive changes into it — and pushing local edits back out to Drive — from its trash path. Compare `src/connectors/gmail-tracking.ts:10-18`, whose `TRACKED_THREAD_IGNORE` covers `store/trash/**`, `.git/**`, `node_modules/**`, `tmp/**`, `.callback-box/**`, `procedure/runs/**`.

2. *Folder-mounted cards come back after deletion.* `syncFolder` (`google-drive.ts:274-323`) lists the mounted Drive folder and creates a card for every file whose id is not in `existingDriveIds` (the ids harvested from the glob). Hard-deleting the card removes it from that set, so the next sync re-creates the card at `<folder.localPath>/<safeName>.<cardType>.card` and resumes syncing it. Untracking such a file actually requires editing the folder entry out of `config/connectors/google-drive.json`.

**User-visible consequence.** A box owner who trashes a Drive card expects the file to stop syncing; instead the box keeps writing Drive updates into `store/trash/` and committing them, and local edits made before the trash can still be pushed up to the live Google document. A box owner who hard-deletes a folder-mounted card sees it reappear on the next `cb wakeup`; that behavior follows the still-configured folder mount, but the current documentation/catalog does not explain the distinction or name `cb rm` as the durable per-child gesture.

**Files involved.** `callback-box/src/connectors/google-drive.ts` (glob at 139-145; `syncFolder` at 274-323), `callback-box/src/connectors/gmail-tracking.ts` (the ignore list that gets it right), `callback-box/src/core/commands/trash.ts:140` and `callback-box/src/lib/box-layout-spec.ts:158-159` (where trash lives), `callback-box/src/connectors/drive-config.ts` (folder mounts).

**How this was established.** Read both connectors' working-set construction and compared them; traced `cb trash`'s destination to `store/trash` under the box root and confirmed the Drive glob has no `ignore` option, so that path is in scope; read `syncFolder`'s `existingDriveIds` skip condition and its `fs.access` existence check, both of which pass for a deleted card and lead to re-creation. Note the Drive glob also lacks the `node_modules/**` and `.git/**` guards Gmail has.

## User-story catalog recheck

The story was narrowed from raw deletion to the supported trash-and-restore lifecycle and re-keyed as [`connectors/stop-syncing-something-by-trashing-its-card`](../../../callback-box/user-stories/catalog/2026-08-21.md). An independent adversarial source recheck marked it accurate on 2026-08-23, and the old ID remains an alias.
