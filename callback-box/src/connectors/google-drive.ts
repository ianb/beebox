/**
 * Google Drive connector — syncs Drive files with the box filesystem.
 *
 * Two sync sources:
 * 1. Card-based: globs for *.sheet.card (and future types) anywhere in the box.
 *    The card's drive-id attribute IS the config — no separate mapping needed.
 * 2. Folder mounts: config/connectors/google-drive.json lists Drive folders to auto-sync.
 *    New files in mounted folders get cards created automatically.
 *
 * Does NOT create new documents on Drive — only pulls and pushes edits.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { glob } from "glob";
import type { Connector, SyncResult } from "./index.js";
import { registerConnector } from "./index.js";
import { getGoogleAuth } from "./google-auth.js";
import { isGoogleServiceAllowed } from "../webapp/box-config.js";
import { loadDriveConfig } from "./drive-config.js";
import { loadTransientState, saveTransientState } from "./transient-state.js";
import { stageFiles, commit } from "../cli/lib/git.js";
import { createGoogleAuthService } from "../services/google-auth.js";
import { createGoogleDriveService } from "../services/google-drive.js";
import type { GoogleDriveService } from "../services/google-drive.js";
import { getHandlerForMimeType, getAllDriveHandlers } from "./drive-types.js";
import type { FileState } from "./drive-types.js";
import { safeFilename } from "./chat-utils.js";

// Ensure the sheets handler is registered
import "./drive-handler-sheets.js";

// ─── State types ────────────────────────────────────────────────────────────

interface DriveTransientState {
  files: Record<string, FileState>;
}

const DEFAULT_STATE: DriveTransientState = { files: {} };

// ─── Card parsing ───────────────────────────────────────────────────────────

/**
 * Extract drive-id from a card file by reading the XML.
 * Uses a simple regex rather than full XML parse — the attribute is on the root element.
 */
async function readDriveIdFromCard(cardPath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(cardPath, "utf-8");
    const match = content.match(/drive-id="([^"]+)"/);
    return match ? match[1]! : null;
  } catch {
    return null;
  }
}

// ─── Connector ──────────────────────────────────────────────────────────────

class GoogleDriveConnector implements Connector {
  name = "google-drive";
  produces: string[];
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

    const authService = createGoogleAuthService(auth);
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
      defaultValue: DEFAULT_STATE,
    });

    const created: string[] = [];
    const updated: string[] = [];
    const pushed: string[] = [];

    // 1. Find all existing drive cards
    const cardPatterns = getAllDriveHandlers().map(
      (h) => `**/*.${h.cardType}.card`,
    );
    const cardPaths: string[] = [];
    for (const pattern of cardPatterns) {
      const matches = await glob(pattern, { cwd: this.boxRoot });
      cardPaths.push(...matches);
    }

    // 2. Sync each card
    for (const relCardPath of cardPaths) {
      const cardPath = path.join(this.boxRoot, relCardPath);
      const driveId = await readDriveIdFromCard(cardPath);
      if (!driveId) continue;

      try {
        const result = await this.syncFile({
          driveId,
          cardPath,
          service,
          state,
        });
        created.push(...result.created);
        updated.push(...result.updated);
        pushed.push(...result.pushed);
      } catch (err) {
        console.error(`[google-drive] Error syncing ${relCardPath}: ${(err as Error).message}`);
      }
    }

    // 3. Folder mounts — discover new files
    const config = await loadDriveConfig(this.boxRoot);
    if (config.folders) {
      for (const folder of config.folders) {
        try {
          const newFiles = await this.syncFolder({
            folder,
            existingDriveIds: new Set(
              await Promise.all(
                cardPaths.map((p) => readDriveIdFromCard(path.join(this.boxRoot, p))),
              ).then((ids) => ids.filter(Boolean) as string[]),
            ),
            service,
            state,
          });
          created.push(...newFiles.created);
          updated.push(...newFiles.updated);
          pushed.push(...newFiles.pushed);
        } catch (err) {
          console.error(`[google-drive] Error syncing folder ${folder.localPath}: ${(err as Error).message}`);
        }
      }
    }

    // Save state
    await saveTransientState({
      boxRoot: this.boxRoot,
      connectorName: "google-drive",
      data: state,
    });

    // Stage and commit if anything changed
    const allChanged = [...created, ...updated, ...pushed];
    if (allChanged.length > 0) {
      await stageFiles(this.boxRoot, allChanged);
      const parts: string[] = [];
      if (created.length > 0) parts.push(`${created.length} new`);
      if (updated.length > 0) parts.push(`${updated.length} updated`);
      if (pushed.length > 0) parts.push(`${pushed.length} pushed`);
      await commit(this.boxRoot, {
        message: `Sync Google Drive: ${parts.join(", ")}`,
      });
    }

    return {
      success: true,
      created,
      updated,
      ...(pushed.length > 0 ? { pushed } : {}),
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

    const cardBasename = path.basename(cardPath, `.${handler.cardType}.card`);
    const localDir = path.join(path.dirname(cardPath), cardBasename);

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
  }): Promise<{ created: string[]; updated: string[]; pushed: string[] }> {
    const { folder, existingDriveIds, service, state } = opts;

    const files = await service.listFiles(folder.driveFolderId);
    const created: string[] = [];
    const updated: string[] = [];
    const pushed: string[] = [];

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

      // Check if card already exists at this path
      try {
        await fs.access(cardPath);
        continue; // Already exists
      } catch {
        // Good, doesn't exist yet
      }

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

    return { created, updated, pushed };
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

/**
 * Content hash utility — exposed for CLI status command.
 */
export function driveContentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}
