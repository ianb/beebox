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
import { convertConfigFolders } from "./drive-folder-convert.js";
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
import { getAllDriveHandlers } from "./drive-types.js";
import { findDriveCardTracking, type TrackedDriveCard } from "./google-drive-tracking.js";
import { stampGlinkCard } from "./drive-card-stamp.js";
import { syncDriveFile } from "./drive-file-sync.js";
import { syncFolderCard } from "./drive-folder-sync.js";
import { createFolderSyncDeps } from "./drive-sync-deps.js";
import { assertNever } from "../lib/invariant.js";

// Ensure handlers are registered

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

    // 1. Convert any legacy `folders` config into mount cards FIRST, so a
    //    converted mount is scanned and mirrored on this same pass.
    const configPaths: string[] = [];
    const config = await loadDriveConfig(this.boxRoot);
    if (config.ok) {
      const conversion = await convertConfigFolders({ boxRoot: this.boxRoot, config: config.value });
      created.push(...conversion.created);
      if (conversion.configPath !== null) configPaths.push(conversion.configPath);
    } else {
      // A config file that exists but does not parse is never read as "no
      // folder mounts": that would silently drop the mounts it still owes a
      // conversion, and the box would look correctly empty while it wasn't.
      console.error(`[google-drive] ${config.error}`);
      failures.push(config.error);
    }

    // 2. Find live cards plus the Drive IDs retained by committed trash cards.
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

    // 3. Sync each tracked card, dispatching on which kind of Drive card it
    //    is. Folder cards are collected rather than synced here: a mirror pass
    //    descends into subfolders itself, and the whole pass shares one
    //    cycle guard and recursion budget.
    const folderCards: TrackedDriveCard[] = [];
    for (const card of tracking.liveCards) {
      try {
        switch (card.kind) {
          case "file": {
            const result = await syncDriveFile({
              driveId: card.driveId,
              cardPath: card.absPath,
              boxRoot: this.boxRoot,
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

    // 4. Folder mounts — every `.gfolder.card`, mirroring into its own directory.
    // A card we could not read may be the trash tombstone that suppresses a
    // folder child. Discovery would recreate the deleted card AND wipe its
    // retained hashes, so it fails closed while any local identity is unknown.
    if (tracking.unreadable.length > 0) {
      failures.push(
        `Unreadable Drive card(s), folder discovery skipped: ${tracking.unreadable.join(", ")}`,
      );
    } else {
      const deps = createFolderSyncDeps({ boxRoot: this.boxRoot, service, state, tracking });
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
    // The rewritten config rides in the same commit as the cards it became.
    const allChanged = [...new Set([...created, ...updated, ...pushed, ...configPaths])];
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
}

export function createGoogleDriveConnector(
  boxRoot: string,
  service?: GoogleDriveService,
): Connector {
  const connector = new GoogleDriveConnector(boxRoot, service);
  registerConnector(connector);
  return connector;
}
