/**
 * Google Drive connector — syncs Drive with the box filesystem.
 *
 * Everything is card-based: a card's `drive-id` IS the configuration, and its
 * card type says what the box promises about the Drive item. Three kinds,
 * dispatched on in `sync()`:
 *
 * - **file** (`.gdoc.card` / `.gsheet.card`) — content mirrored two-way.
 * - **folder** (`.gfolder.card`) — the directory the card sits in mirrors the
 *   Drive folder's membership (`drive-folder-sync.ts`).
 * - **link** (`.glink.card`) — a pointer; only its Drive metadata is re-stamped.
 *
 * Does NOT create new documents on Drive — only pulls and pushes edits.
 */

import { errorMessage } from "../lib/error-guards.js";
import type { Connector, SyncResult } from "./index.js";
import { registerConnector } from "./index.js";
import { getGoogleAuth } from "./google-auth.js";
import { isGoogleServiceAllowed } from "../core/box/config.js";
import { loadDriveConfig } from "./drive-config.js";
import { loadTransientState } from "./transient-state.js";
import {
  DEFAULT_DRIVE_STATE,
  commitDriveStateDelta,
  type DriveTransientState,
} from "./google-drive-state.js";
import { stageAndCommitPaths } from "../lib/git.js";
import { createGoogleAuthService } from "../services/google-auth.js";
import { createGoogleDriveService } from "../services/google-drive.js";
import type { GoogleDriveService } from "../services/google-drive.js";
import { getHandlerForMimeType, getAllDriveHandlers } from "./drive-types.js";
import { attachDirFor } from "../shared/attach-path.js";
import { findDriveCardTracking, type TrackedDriveCard } from "./google-drive-tracking.js";
import { stampGlinkCard } from "./drive-card-stamp.js";
import { syncFolderCard } from "./drive-folder-sync.js";
import type { FolderSyncDeps } from "./drive-folder-types.js";
import { assertNever } from "../lib/invariant.js";
import { moveCardsToTrash } from "../core/commands/trash.js";
import type { CommandContext } from "../core/command-runner.js";

// Ensure handlers are registered
import "./drive-handler-sheets.js";
import "./drive-handler-docs.js";

// State types + the delta-merging state writer live in the sibling state-IO
// module; re-export the surface CLI callers (`cli/commands/drive.ts`) import.
export {
  emptyFileState,
  type DriveTransientState,
} from "./google-drive-state.js";

// ─── Connector ──────────────────────────────────────────────────────────────

class GoogleDriveConnector implements Connector {
  name = "google-drive";
  produces: string[];
  inboxPaths: string[] = [];
  triggeredBy?: string;

  private boxRoot: string;
  private injectedService?: GoogleDriveService | undefined;

  constructor(boxRoot: string, service?: GoogleDriveService) {
    this.boxRoot = boxRoot;
    this.injectedService = service;
    // Produce all card types from registered handlers
    this.produces = getAllDriveHandlers().map((h) => h.cardType);
  }

  private async getService(): Promise<GoogleDriveService | null> {
    if (this.injectedService) return this.injectedService;

    const auth = await getGoogleAuth(this.boxRoot);
    if (!auth) return null;

    const authService = createGoogleAuthService(auth, { boxRoot: this.boxRoot });
    return createGoogleDriveService(authService);
  }

  async sync(): Promise<SyncResult> {
    // Skip policy check when a fake service is injected (tests)
    if (!this.injectedService) {
      const allowed = await isGoogleServiceAllowed(this.boxRoot, "drive");
      if (!allowed) {
        return { success: true, created: [], updated: [] };
      }
    }

    const service = await this.getService();
    if (!service) {
      return {
        success: false,
        created: [],
        updated: [],
        error: "Google auth not configured. Run: cb google-auth",
      };
    }

    const state = await loadTransientState<DriveTransientState>({
      boxRoot: this.boxRoot,
      connectorName: "google-drive",
      defaultValue: DEFAULT_DRIVE_STATE,
    });
    // Baseline for the end-of-sync delta merge: which files THIS sync changed
    // is `state` (mutated in place below) diffed against this snapshot. Deep
    // copy so the in-place mutation doesn't move the baseline underneath us.
    const stateSnapshot: DriveTransientState = structuredClone(state);

    const created: string[] = [];
    const updated: string[] = [];
    const pushed: string[] = [];
    // Anything that went wrong. Flattened into `result.error` at the end —
    // wakeup counts a connector error only from `error`, never from `success`,
    // so a failure that never lands here is a silent failure.
    const failures: string[] = [];

    // 1. Find live cards plus the Drive IDs retained by committed trash cards.
    const tracking = await findDriveCardTracking(this.boxRoot);

    // Two cards claiming one Drive ID are an ambiguous working copy: state is
    // keyed by Drive ID while attachments are per-card, so syncing either can
    // revert the other's edit upstream. Skip both — first-wins would leave the
    // stale copy on disk, ready to push again.
    for (const duplicate of tracking.duplicates) {
      failures.push(
        `Duplicate drive-id ${duplicate.driveId} claimed by ${duplicate.relPaths.join(", ")} — both skipped`,
      );
    }

    // 2. Sync each tracked card, dispatching on which kind of Drive card it
    //    is. Folder cards are collected rather than synced here: a mirror pass
    //    descends into subfolders itself, and the whole pass shares one
    //    cycle guard and recursion budget.
    const folderCards: TrackedDriveCard[] = [];
    for (const card of tracking.liveCards) {
      try {
        switch (card.kind) {
          case "file": {
            const result = await this.syncFile({
              driveId: card.driveId,
              cardPath: card.absPath,
              service,
              state,
            });
            created.push(...result.created);
            updated.push(...result.updated);
            pushed.push(...result.pushed);
            break;
          }
          case "link": {
            const file = await service.getFile(card.driveId);
            if (await stampGlinkCard(card.absPath, file)) updated.push(card.relPath);
            break;
          }
          case "folder":
            folderCards.push(card);
            break;
          default:
            assertNever(card.kind);
        }
      } catch (err) {
        failures.push(`Sync failed for ${card.relPath}: ${errorMessage(err)}`);
      }
    }

    // 3. Folder mounts — every `.gfolder.card`, mirroring into its own directory.
    const config = await loadDriveConfig(this.boxRoot);
    if (config.folders !== undefined && config.folders.length > 0) {
      // Transitional: the config array is no longer read for discovery, and a
      // box still carrying one would otherwise silently stop mirroring.
      console.warn(
        "[google-drive] config/connectors/google-drive.json `folders` is ignored — "
          + "a folder mount is a .gfolder.card in the directory it mirrors. "
          + `Convert with \`cb drive mount\`: ${config.folders.map((f) => f.localPath).join(", ")}`,
      );
    }
    const claimedDriveIds = new Set([
      ...tracking.liveCards.map((card) => card.driveId),
      ...tracking.duplicates.map((duplicate) => duplicate.driveId),
      ...tracking.trashedDriveIds,
    ]);
    // A card we could not read may be the trash tombstone that suppresses a
    // folder child. Discovery would recreate the deleted card AND wipe its
    // retained hashes, so it fails closed while any local identity is unknown.
    if (tracking.unreadable.length > 0) {
      failures.push(
        `Unreadable Drive card(s), folder discovery skipped: ${tracking.unreadable.join(", ")}`,
      );
    } else {
      const deps: FolderSyncDeps = {
        boxRoot: this.boxRoot,
        service,
        claimed: claimedDriveIds,
        visitedFolders: new Set<string>(),
        liveCards: tracking.liveCards,
        budget: { foldersMirrored: 0 },
        syncFile: (opts) =>
          this.syncFile({ driveId: opts.driveId, cardPath: opts.cardPath, service, state }),
        forgetFileState: (driveId) => {
          delete state.files[driveId];
        },
        trashCard: async (cardPath) => {
          const receipt = await moveCardsToTrash(this.commandContext(), [cardPath]);
          return receipt.gitPaths;
        },
      };
      for (const card of folderCards) {
        try {
          const folder = await syncFolderCard(
            { driveId: card.driveId, cardPath: card.absPath, depth: 0 },
            deps,
          );
          created.push(...folder.created);
          updated.push(...folder.updated);
          pushed.push(...folder.pushed);
          failures.push(...folder.failures);
          // Not failures — a child that left the mirror, or a recursion cap.
          // Absorbing them silently is exactly what the mirror must not do.
          for (const note of folder.notes) console.warn(`[google-drive] ${card.relPath}: ${note}`);
        } catch (err) {
          failures.push(`Folder sync failed for ${card.relPath}: ${errorMessage(err)}`);
        }
      }
    }

    // Save state via a serialized delta merge (not a whole-sync lock): the CLI
    // `cb drive add` writes the same file from another process, so we merge the
    // per-file entries THIS sync changed into freshly-loaded state rather than
    // clobbering the file wholesale. See commitDriveStateDelta / mergeDriveState.
    await commitDriveStateDelta({
      boxRoot: this.boxRoot,
      snapshot: stateSnapshot,
      working: state,
    });

    // Stage and commit if anything changed — scoped to exactly the paths this
    // sync produced (never a bare commit that could sweep a concurrent
    // mutator's staged files).
    const allChanged = [...created, ...updated, ...pushed];
    if (allChanged.length > 0) {
      const parts: string[] = [];
      if (created.length > 0) parts.push(`${created.length} new`);
      if (updated.length > 0) parts.push(`${updated.length} updated`);
      if (pushed.length > 0) parts.push(`${pushed.length} pushed`);
      await stageAndCommitPaths(this.boxRoot, {
        paths: allChanged,
        message: `Sync Google Drive: ${parts.join(", ")}`,
      });
    }

    return {
      success: failures.length === 0,
      created,
      updated,
      ...(pushed.length > 0 ? { pushed } : {}),
      ...(failures.length > 0 ? { error: failures.join("; ") } : {}),
    };
  }

  private async syncFile(opts: {
    driveId: string;
    cardPath: string;
    service: GoogleDriveService;
    state: DriveTransientState;
  }): Promise<{ created: string[]; updated: string[]; pushed: string[] }> {
    const { driveId, cardPath, service, state } = opts;

    const file = await service.getFile(driveId);
    const handler = getHandlerForMimeType(file.mimeType);
    if (!handler) {
      console.warn(`[google-drive] No handler for ${file.mimeType} (${file.name})`);
      return { created: [], updated: [], pushed: [] };
    }

    // Initialize state for this file
    if (!state.files[driveId]) {
      state.files[driveId] = {
        contentHashes: {},
        lastModified: "",
        extra: {},
      };
    }
    const fileState = state.files[driveId];

    const localDir = attachDirFor(cardPath);

    const isNew = fileState.lastModified === "";

    // Push local changes first
    const pushResult = await handler.push({
      file, localDir, cardPath, boxRoot: this.boxRoot, service, state: fileState,
    });

    // Then pull remote changes
    const pullResult = await handler.pull({
      file, localDir, cardPath, boxRoot: this.boxRoot, service, state: fileState,
    });

    const created = isNew && pullResult.changed ? pullResult.written : [];
    const updated = !isNew && pullResult.changed ? pullResult.written : [];

    return {
      created,
      updated,
      pushed: pushResult.pushed,
    };
  }

  /** A minimal command context so the connector can reuse `cb rm`'s trash move. */
  private commandContext(): CommandContext {
    return {
      boxRoot: this.boxRoot,
      write: () => {},
      // The move is already reported through the folder pass's notes; `cb rm`'s
      // own narration would be duplicate output on a wakeup.
      writeLine: () => {},
    };
  }
}

export function createGoogleDriveConnector(
  boxRoot: string,
  service?: GoogleDriveService,
): Connector {
  const connector = new GoogleDriveConnector(boxRoot, service);
  registerConnector(connector);
  return connector;
}
