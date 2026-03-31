/**
 * cb drive — Manage Google Drive sheet sync.
 *
 * Usage:
 *   cb drive inspect <url-or-id>        — preview file metadata
 *   cb drive add <url-or-id> <path>     — mount a file at a local path
 *   cb drive sync                       — sync all mounted files
 *   cb drive status                     — show mount status
 *   cb drive list [folder-url-or-id]    — browse Drive files
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { getGoogleAuth } from "../../connectors/google-auth.js";
import { extractDriveFileId } from "../../connectors/drive-types.js";
import { createGoogleAuthService } from "../../services/google-auth.js";
import { createGoogleDriveService } from "../../services/google-drive.js";
import type { GoogleDriveService } from "../../services/google-drive.js";
import { stageFiles, commit } from "../lib/git.js";
import { safeFilename } from "../../connectors/chat-utils.js";

// Ensure handlers are registered
import "../../connectors/drive-handler-sheets.js";
import { getHandlerForMimeType } from "../../connectors/drive-types.js";
import { createGoogleDriveConnector } from "../../connectors/google-drive.js";

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
  .description("Manage Google Drive sheet sync")
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
      if (info.details["tabs"]) {
        const tabs = info.details["tabs"] as Array<{ title: string; gid: number }>;
        console.log(`\nSheet tabs (${tabs.length}):`);
        for (const tab of tabs) {
          console.log(`  - ${tab.title} (gid: ${tab.gid})`);
        }
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
    } catch {
      // Good
    }

    // Do initial sync via the connector's sync logic
    const { createSheetTemplate } = await import("../../schemas/sheet.js");
    const spreadsheet = await service.getSpreadsheet(fileId);
    const owner = file.owners?.[0]?.emailAddress ?? "unknown";
    const link = file.webViewLink ?? `https://docs.google.com/spreadsheets/d/${fileId}/edit`;

    const cardBasename = path.basename(cardPath, `.${handler.cardType}.card`);
    const localDir = path.join(path.dirname(cardPath), cardBasename);
    await fs.mkdir(localDir, { recursive: true });

    const sheetRefs: Array<{ file: string; title: string; gid: string }> = [];
    const written: string[] = [];

    for (const sheet of spreadsheet.sheets) {
      const tabTitle = sheet.properties.title;
      const gid = String(sheet.properties.sheetId);
      const safeName = safeFilename(tabTitle, "sheet");
      const jsonRelPath = `${cardBasename}/${safeName}.json`;
      const jsonPath = path.join(path.dirname(cardPath), jsonRelPath);

      const formulaValues = await service.getSheetValues(fileId, {
        sheetTitle: tabTitle,
        valueRenderOption: "FORMULA",
      });
      const formattedValues = await service.getSheetValues(fileId, {
        sheetTitle: tabTitle,
        valueRenderOption: "FORMATTED_VALUE",
      });

      const { buildSheetData, serializeSheetData } = await import("../../connectors/drive-sheet-data.js");
      const sheetData = buildSheetData(formulaValues, formattedValues);
      await fs.writeFile(jsonPath, serializeSheetData(sheetData));
      written.push(path.relative(boxRoot, jsonPath));

      sheetRefs.push({ file: jsonRelPath, title: tabTitle, gid });
    }

    const cardContent = createSheetTemplate({
      driveId: fileId,
      title: spreadsheet.properties.title,
      modified: file.modifiedTime,
      link,
      owner,
      sheets: sheetRefs,
    });

    await fs.mkdir(path.dirname(cardPath), { recursive: true });
    await fs.writeFile(cardPath, cardContent);
    written.push(path.relative(boxRoot, cardPath));

    await stageFiles(boxRoot, written);
    await commit(boxRoot, {
      message: `Add Drive sheet: ${spreadsheet.properties.title}`,
    });

    console.log(`Created ${path.relative(boxRoot, cardPath)}`);
    console.log(`  "${spreadsheet.properties.title}" (${sheetRefs.length} tab(s))`);
    for (const ref of sheetRefs) {
      console.log(`  → ${ref.file}`);
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

    const cardPaths = await glob("**/*.sheet.card", { cwd: boxRoot });

    if (cardPaths.length === 0) {
      console.log("No Drive files mounted.");
      console.log('Use "cb drive add <url> <path>" to mount a spreadsheet.');
      return;
    }

    console.log(`${cardPaths.length} mounted file(s):\n`);
    for (const relPath of cardPaths) {
      const cardPath = path.join(boxRoot, relPath);
      const content = await fs.readFile(cardPath, "utf-8");

      const driveIdMatch = content.match(/drive-id="([^"]+)"/);
      const titleMatch = content.match(/<title>([^<]+)<\/title>/);
      const modifiedMatch = content.match(/<modified>([^<]+)<\/modified>/);
      const sheetMatches = [...content.matchAll(/title="([^"]+)"/g)];

      console.log(`  ${relPath}`);
      if (titleMatch) console.log(`    Title: ${titleMatch[1]}`);
      if (driveIdMatch) console.log(`    Drive ID: ${driveIdMatch[1]}`);
      if (modifiedMatch) console.log(`    Last synced: ${modifiedMatch[1]}`);
      if (sheetMatches.length > 0) {
        const tabs = sheetMatches.map((m) => m[1]).filter(Boolean);
        console.log(`    Tabs: ${tabs.join(", ")}`);
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
