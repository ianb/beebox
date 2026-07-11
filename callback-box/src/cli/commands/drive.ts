/**
 * cb drive — Manage Google Drive sync (Sheets, Docs).
 *
 * Usage:
 *   cb drive inspect <url-or-id>        — preview file metadata
 *   cb drive add <url-or-id> <path>     — mount a file at a local path
 *   cb drive sync                       — sync all mounted files
 *   cb drive status                     — show mount status
 *   cb drive list [folder-url-or-id]    — browse Drive files
 */

import * as fs from "node:fs/promises";
import { isRecord } from "../../lib/is-record.js";
import * as path from "node:path";
import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { getGoogleAuth } from "../../connectors/google-auth.js";
import { extractDriveFileId } from "../../connectors/drive-types.js";
import { createGoogleAuthService } from "../../services/google-auth.js";
import { createGoogleDriveService } from "../../services/google-drive.js";
import type { GoogleDriveService } from "../../services/google-drive.js";
import { stageAndCommitPaths } from "../../lib/git.js";
import { attachDirFor } from "../../shared/attach-path.js";
import { updateTransientState } from "../../connectors/transient-state.js";

// Ensure handlers are registered
import "../../connectors/drive-handler-sheets.js";
import "../../connectors/drive-handler-docs.js";
import { getHandlerForMimeType, getAllDriveHandlers } from "../../connectors/drive-types.js";
import {
  createGoogleDriveConnector,
  emptyFileState,
  type DriveTransientState,
} from "../../connectors/google-drive.js";

async function requireDriveService(boxRoot: string): Promise<GoogleDriveService> {
  const auth = await getGoogleAuth(boxRoot);
  if (!auth) {
    console.error("Google auth not configured. Run: cb google-auth");
    process.exit(1);
  }
  const authService = createGoogleAuthService(auth);
  return createGoogleDriveService(authService);
}

function requireFileId(input: string): string {
  const fileId = extractDriveFileId(input);
  if (!fileId) {
    console.error(`Could not extract file ID from: ${input}`);
    console.error("Provide a Google Drive/Sheets URL or a file ID.");
    process.exit(1);
  }
  return fileId;
}

export const driveCommand = new Command("drive")
  .description("Manage Google Drive sync (Sheets, Docs)")
  .action(async () => {
    // Default action: show status
    await driveCommand.commands.find((c) => c.name() === "status")?.parseAsync([], { from: "user" });
  });

driveCommand
  .command("inspect <url-or-id>")
  .description("Preview file metadata without syncing")
  .action(async (input: string) => {
    const boxRoot = await requireBoxRoot();
    const service = await requireDriveService(boxRoot);
    const fileId = requireFileId(input);

    const file = await service.getFile(fileId);
    const handler = getHandlerForMimeType(file.mimeType);

    console.log(`Title:    ${file.name}`);
    console.log(`Type:     ${file.mimeType}`);
    console.log(`ID:       ${file.id}`);
    console.log(`Modified: ${file.modifiedTime}`);
    console.log(`Owner:    ${file.owners?.[0]?.emailAddress ?? "unknown"}`);
    if (file.webViewLink) {
      console.log(`Link:     ${file.webViewLink}`);
    }

    if (handler) {
      const info = await handler.inspect(file, service);

      const tabs = info.details["tabs"];
      if (Array.isArray(tabs)) {
        console.log(`\nSheet tabs (${tabs.length}):`);
        for (const tab of tabs) {
          if (isRecord(tab)) console.log(`  - ${String(tab["title"])} (gid: ${String(tab["gid"])})`);
        }
      }

      const lossy = info.details["lossy"];
      if (isRecord(lossy)) {
        const present = Object.entries(lossy).filter(([, n]) => typeof n === "number" && n > 0);
        if (present.length > 0) {
          console.log("\nLossy content (will not survive markdown push):");
          for (const [type, count] of present) {
            console.log(`  - ${type}: ${String(count)}`);
          }
        }
      }

      if (typeof info.details["comments"] === "number" && info.details["comments"] > 0) {
        console.log(
          `\nComments: ${info.details["comments"]} (captured to a read-only sidecar on sync)`,
        );
      }

      const revisionId = info.details["revisionId"];
      if (typeof revisionId === "string") {
        console.log(`\nRevision: ${revisionId}`);
      }

      console.log(`\nCard type: ${handler.cardType}`);
    } else {
      console.log("\nNo handler registered for this file type.");
    }
  });

driveCommand
  .command("add <url-or-id> <path>")
  .description("Mount a Drive file at a local path")
  .action(async (input: string, localPath: string) => {
    const boxRoot = await requireBoxRoot();
    const service = await requireDriveService(boxRoot);
    const fileId = requireFileId(input);

    const file = await service.getFile(fileId);
    const handler = getHandlerForMimeType(file.mimeType);
    if (!handler) {
      console.error(`No handler for file type: ${file.mimeType}`);
      process.exit(1);
    }

    // Resolve path relative to box root
    const resolvedPath = path.isAbsolute(localPath)
      ? localPath
      : path.join(boxRoot, localPath);

    const cardPath = resolvedPath.endsWith(`.${handler.cardType}.card`)
      ? resolvedPath
      : `${resolvedPath}.${handler.cardType}.card`;

    // Check if card already exists
    try {
      await fs.access(cardPath);
      console.error(`Card already exists at: ${path.relative(boxRoot, cardPath)}`);
      process.exit(1);
    } catch (_e) {
      // Expected: fs.access throws when the card does not exist, which is the
      // desired state for a fresh create. The specific error is irrelevant —
      // any failure to access means there's nothing to collide with, so proceed.
    }

    // Delegate first-time creation to the handler's pull(): it knows
    // how to write the card and the type-specific local files (JSON tabs
    // for sheets, sibling .md for docs). Empty state means "fresh sync".
    // localDir must match the connector's attach scope (`<basename>.attach/`)
    // so the card's `attach/` refs resolve to the files written here.
    const localDir = attachDirFor(cardPath);
    await fs.mkdir(path.dirname(cardPath), { recursive: true });

    const fileState = emptyFileState();
    const result = await handler.pull({
      file, localDir, cardPath, boxRoot, service, state: fileState,
    });

    // Persist the per-file state into the connector's transient state file so
    // future `cb drive sync` runs see this file as already-synced. Delta-merge
    // under the serialized RMW lock: add ONLY this new file's entry to
    // freshly-loaded state, so a concurrent server `sync()` writing the same
    // file (from another process) isn't clobbered.
    await updateTransientState<DriveTransientState>({
      boxRoot,
      connectorName: "google-drive",
      defaultValue: { files: {} },
      update: (fresh) => ({ files: { ...fresh.files, [fileId]: fileState } }),
    });

    await stageAndCommitPaths(boxRoot, {
      paths: result.written,
      message: `Add Drive ${handler.cardType}: ${file.name}`,
    });

    console.log(`Created ${path.relative(boxRoot, cardPath)}`);
    console.log(`  "${file.name}" (${handler.cardType})`);
    for (const written of result.written) {
      if (written !== path.relative(boxRoot, cardPath)) {
        console.log(`  → ${written}`);
      }
    }
  });

driveCommand
  .command("sync")
  .description("Sync all mounted Drive files")
  .action(async () => {
    const boxRoot = await requireBoxRoot();
    const connector = createGoogleDriveConnector(boxRoot);
    connector.triggeredBy = "cb drive sync";
    const result = await connector.sync();

    if (!result.success) {
      console.error(`Sync failed: ${result.error}`);
      process.exit(1);
    }

    if (result.created.length === 0 && result.updated.length === 0 && (!result.pushed || result.pushed.length === 0)) {
      console.log("Everything up to date.");
    } else {
      if (result.created.length > 0) console.log(`Created: ${result.created.length} file(s)`);
      if (result.updated.length > 0) console.log(`Updated: ${result.updated.length} file(s)`);
      if (result.pushed && result.pushed.length > 0) console.log(`Pushed: ${result.pushed.length} file(s)`);
    }
  });

driveCommand
  .command("status")
  .description("Show status of mounted Drive files")
  .action(async () => {
    const boxRoot = await requireBoxRoot();
    const { glob } = await import("glob");

    const cardPaths: string[] = [];
    for (const h of getAllDriveHandlers()) {
      const matches = await glob(`**/*.${h.cardType}.card`, { cwd: boxRoot });
      cardPaths.push(...matches);
    }
    cardPaths.sort();

    if (cardPaths.length === 0) {
      console.log("No Drive files mounted.");
      console.log('Use "cb drive add <url> <path>" to mount a Drive file.');
      return;
    }

    console.log(`${cardPaths.length} mounted file(s):\n`);
    for (const relPath of cardPaths) {
      const cardPath = path.join(boxRoot, relPath);
      const content = await fs.readFile(cardPath, "utf-8");

      const driveIdMatch = content.match(/drive-id="([^"]+)"/);
      const titleMatch = content.match(/<title>([^<]+)<\/title>/);
      const modifiedMatch = content.match(/<modified>([^<]+)<\/modified>/);
      const statusMatch = content.match(/\bstatus="([^"]+)"/);
      const sheetMatches = [...content.matchAll(/<sheet-tab[^>]*\btitle="([^"]+)"/g)];
      const lossyMatches = [...content.matchAll(/<item type="([^"]+)" count="([^"]+)"/g)];

      console.log(`  ${relPath}`);
      if (titleMatch) console.log(`    Title: ${titleMatch[1]}`);
      if (driveIdMatch) console.log(`    Drive ID: ${driveIdMatch[1]}`);
      if (modifiedMatch) console.log(`    Last synced: ${modifiedMatch[1]}`);
      if (statusMatch && statusMatch[1] !== "synced") {
        console.log(`    Status: ${statusMatch[1]}`);
      }
      if (sheetMatches.length > 0) {
        const tabs = sheetMatches.map((m) => m[1]).filter(Boolean);
        console.log(`    Tabs: ${tabs.join(", ")}`);
      }
      if (lossyMatches.length > 0) {
        const summary = lossyMatches.map((m) => `${m[1]}=${m[2]}`).join(", ");
        console.log(`    Lossy: ${summary}`);
      }
      console.log("");
    }
  });

driveCommand
  .command("list [folder-url-or-id]")
  .description("List spreadsheets in Drive (or in a specific folder)")
  .action(async (folderInput?: string) => {
    const boxRoot = await requireBoxRoot();
    const service = await requireDriveService(boxRoot);

    let files;
    if (folderInput) {
      const folderId = requireFileId(folderInput);
      files = await service.listFiles(folderId);
    } else {
      files = await service.listSpreadsheets();
    }

    if (files.length === 0) {
      console.log("No spreadsheets found.");
      return;
    }

    console.log(`${files.length} file(s):\n`);
    for (const file of files) {
      const owner = file.owners?.[0]?.emailAddress ?? "";
      console.log(`  ${file.name}`);
      console.log(`    ID: ${file.id}  Type: ${file.mimeType}`);
      if (owner) console.log(`    Owner: ${owner}`);
      console.log(`    Modified: ${file.modifiedTime}`);
      console.log("");
    }
  });
