/**
 * Google Drive connector — syncs Drive files with the box filesystem.
 *
 * Two sync sources:
 * 1. Card-based: globs for *.gsheet.card (and future types) anywhere in the box.
 *    The card's drive-id attribute IS the config — no separate mapping needed.
 * 2. Folder mounts: config/connectors/google-drive.json lists Drive folders to auto-sync.
 *    New files in mounted folders get cards created automatically.
 *
 * Does NOT create new documents on Drive — only pulls and pushes edits.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode, errorMessage } from "../lib/error-guards.js";
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
import { safeFilename } from "./chat-utils.js";
import { attachDirFor } from "../shared/attach-path.js";
import { driveIdFromCardContent, findDriveCardTracking } from "./google-drive-tracking.js";

// Ensure handlers are registered
import "./drive-handler-sheets.js";
import "./drive-handler-docs.js";

// State types + the delta-merging state writer live in the sibling state-IO
// module; re-export the surface CLI callers (`cli/commands/drive.ts`) import.
export {
  emptyFileState,
  type DriveTransientState,
} from "./google-drive-state.js";

/** Read a file, or `null` when it does not exist. Other errors propagate. */
async function readIfPresent(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error: unknown) {
    if (errnoCode(error) === "ENOENT") return null;
    throw error;
  }
}

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

    // 2. Sync each card
    for (const card of tracking.liveCards) {
      try {
        const result = await this.syncFile({
          driveId: card.driveId,
          cardPath: card.absPath,
          service,
          state,
        });
        created.push(...result.created);
        updated.push(...result.updated);
        pushed.push(...result.pushed);
      } catch (err) {
        failures.push(`Sync failed for ${card.relPath}: ${errorMessage(err)}`);
      }
    }

    // 3. Folder mounts — discover new files
    const config = await loadDriveConfig(this.boxRoot);
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
    } else if (config.folders) {
      for (const folder of config.folders) {
        try {
          const newFiles = await this.syncFolder({
            folder,
            existingDriveIds: claimedDriveIds,
            service,
            state,
          });
          created.push(...newFiles.created);
          updated.push(...newFiles.updated);
          pushed.push(...newFiles.pushed);
          failures.push(...newFiles.failures);
        } catch (err) {
          failures.push(`Folder sync failed for ${folder.localPath}: ${errorMessage(err)}`);
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

  private async syncFolder(opts: {
    folder: { driveFolderId: string; localPath: string };
    existingDriveIds: Set<string>;
    service: GoogleDriveService;
    state: DriveTransientState;
  }): Promise<{
    created: string[];
    updated: string[];
    pushed: string[];
    failures: string[];
  }> {
    const { folder, existingDriveIds, service, state } = opts;

    const files = await service.listFiles(folder.driveFolderId);
    const created: string[] = [];
    const updated: string[] = [];
    const pushed: string[] = [];
    const failures: string[] = [];

    for (const file of files) {
      // Skip files we already have cards for
      if (existingDriveIds.has(file.id)) continue;

      const handler = getHandlerForMimeType(file.mimeType);
      if (!handler) continue;

      // Create card for new file
      const safeName = safeFilename(file.name);
      const cardPath = path.join(
        this.boxRoot,
        folder.localPath,
        `${safeName}.${handler.cardType}.card`,
      );

      // A card may already occupy the derived path. Two remote children can
      // share one safe name, so "occupied" is not necessarily "already mine":
      // compare the occupant's Drive ID before assuming anything.
      const occupant = await readIfPresent(cardPath);
      if (occupant !== null) {
        const occupantId = driveIdFromCardContent(occupant);
        if (occupantId === file.id) {
          // Benign re-mount: the same file, already carded at this path.
          existingDriveIds.add(file.id);
          continue;
        }
        const relCardPath = path.relative(this.boxRoot, cardPath);
        failures.push(
          occupantId === null
            ? `Drive file ${file.id} ("${file.name}") maps to ${relCardPath}, which holds a card with no readable drive-id`
            : `Drive file ${file.id} ("${file.name}") maps to ${relCardPath}, already claimed by drive-id ${occupantId}`,
        );
        continue;
      }

      // Discovery after a hard delete is a fresh mount. Retained transient
      // hashes describe attachment files that no longer exist; keeping them
      // would make the handlers mistake the missing files for local edits and
      // recreate only the card with dangling attach refs.
      delete state.files[file.id];
      const result = await this.syncFile({
        driveId: file.id,
        cardPath,
        service,
        state,
      });

      created.push(...result.created);
      updated.push(...result.updated);
      pushed.push(...result.pushed);
      existingDriveIds.add(file.id);
    }

    return { created, updated, pushed, failures };
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
