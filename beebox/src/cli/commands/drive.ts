/**
 * bbx drive — Manage Google Drive mounts.
 *
 * Three kinds of Drive card, three ways to make one:
 *
 *   bbx drive add <url-or-id> <path>       — sync a Doc or Sheet two-way
 *   bbx drive mount <url-or-id> <dir>      — mirror a folder into a directory
 *   bbx drive link <url-or-id> <path>      — a pointer; nothing is copied
 *   bbx drive unmount <dir-or-card>        — stop mirroring; children stay
 *
 * And the read-only ones:
 *
 *   bbx drive inspect <url-or-id>          — preview Drive metadata
 *   bbx drive sync                         — sync every Drive card
 *   bbx drive status                       — what this box has mounted
 *   bbx drive list [folder-url-or-id]      — browse Drive
 *
 * Every verb that needs Google runs through `drive-dispatch.ts`, so it works
 * the same in a box agent's shell (which holds no credential and asks the
 * box's server) as under the tooling profile (which runs it in-process). Each
 * takes `--json` and prints exactly one object: the result, or the refusal.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { spawnProfile } from "../../lib/spawn-profile.js";

// Ensure handlers are registered
import "../../connectors/drive-handler-sheets.js";
import "../../connectors/drive-handler-docs.js";
import { createGoogleDriveConnector } from "../../connectors/google-drive.js";
import type { SyncResult } from "../../connectors/index.js";
import { requireDriveId } from "../../connectors/drive-mounts.js";
import {
  dispatchDrive,
  localDriveService,
  reportRefusal,
  runDriveVerb,
  syncWrongProfileRefusal,
  type DriveRefusal,
} from "./drive-dispatch.js";
import { driveAddCommand, driveInspectCommand } from "./drive-file-cli.js";
import { driveStatusCommand } from "./drive-status-cli.js";
import {
  driveLinkCommand,
  driveMountCommand,
  driveUnmountCommand,
} from "./drive-mount-cli.js";

/** One row of `bbx drive list`. Matches the `drive.list` procedure's shape. */
interface DriveListRow {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  owner: string | null;
}

export const driveCommand = new Command("drive")
  .description("Manage Google Drive mounts (files, folders, pointers)")
  .action(async () => {
    // Default action: show status
    await driveCommand.commands.find((c) => c.name() === "status")?.parseAsync([], { from: "user" });
  });

const driveSyncCommand = new Command("sync")
  .description("Sync all mounted Drive files")
  .option("--json", "Print the sync result as one JSON object")
  .action(async (options: { json?: boolean }) => {
    const json = options.json === true;
    // The one verb that does NOT delegate. A connector sync is a whole
    // connector run, not one procedure call, and the forced equivalent of
    // "let it happen" is the server running the same wakeup child the schedule
    // runs. So outside the tooling profile this points at that verb rather
    // than doing something subtly different under the same name.
    if (spawnProfile() !== "tooling") {
      reportRefusal(syncWrongProfileRefusal(), json);
      process.exit(1);
    }

    const boxRoot = await requireBoxRoot();
    const connector = createGoogleDriveConnector(boxRoot);
    connector.triggeredBy = "bbx drive sync";
    const result = await connector.sync();

    const refusal = syncRefusal(result);
    if (refusal !== null) {
      reportRefusal(refusal, json);
      process.exit(1);
    }

    if (json) {
      console.log(JSON.stringify(result));
      return;
    }
    if (result.created.length === 0 && result.updated.length === 0 && (!result.pushed || result.pushed.length === 0)) {
      console.log("Everything up to date.");
      return;
    }
    if (result.created.length > 0) console.log(`Created: ${String(result.created.length)} file(s)`);
    if (result.updated.length > 0) console.log(`Updated: ${String(result.updated.length)} file(s)`);
    if (result.pushed && result.pushed.length > 0) {
      console.log(`Pushed: ${String(result.pushed.length)} file(s)`);
    }
  });

/**
 * A sync that did not do the work, as a refusal. A skip is a success for the
 * wakeup cycle, but this verb is someone asking for a sync NOW: saying "up to
 * date" about a service we never contacted is the invisible
 * nothing-happened failure this whole seam exists to remove.
 */
function syncRefusal(result: SyncResult): DriveRefusal | null {
  if (result.skipped) {
    return {
      kind: result.skipped.reason === "not-allowed" ? "FORBIDDEN" : "PRECONDITION_FAILED",
      message: `Sync skipped (${result.skipped.reason}): ${result.skipped.detail}`,
      fix: "boxholder",
    };
  }
  if (!result.success) {
    return { kind: "SYNC_FAILED", message: `Sync failed: ${result.error ?? "unknown"}`, fix: "machine" };
  }
  return null;
}

const driveListCommand = new Command("list")
  .description("List spreadsheets in Drive (or in a specific folder)")
  .argument("[folder-url-or-id]", "Drive folder URL or ID")
  .option("--json", "Print the listing as one JSON array")
  .action(async (folderInput: string | undefined, options: { json?: boolean }) => {
    const boxRoot = await requireBoxRoot();
    await runDriveVerb({
      json: options.json,
      run: () =>
        dispatchDrive<DriveListRow[]>({
          local: async () => {
            const service = await localDriveService(boxRoot);
            const files = folderInput === undefined
              ? await service.listSpreadsheets()
              : await service.listFiles(requireDriveId(folderInput));
            return files.map((file) => ({
              id: file.id,
              name: file.name,
              mimeType: file.mimeType,
              modifiedTime: file.modifiedTime,
              owner: file.owners?.[0]?.emailAddress ?? null,
            }));
          },
          remote: (client) =>
            client.drive.list.query(folderInput === undefined ? {} : { folder: folderInput }),
        }),
      print: (files) => {
        if (files.length === 0) {
          console.log("No spreadsheets found.");
          return;
        }
        console.log(`${String(files.length)} file(s):\n`);
        for (const file of files) {
          console.log(`  ${file.name}`);
          console.log(`    ID: ${file.id}  Type: ${file.mimeType}`);
          if (file.owner !== null) console.log(`    Owner: ${file.owner}`);
          console.log(`    Modified: ${file.modifiedTime}`);
          console.log("");
        }
      },
    });
  });

driveCommand.addCommand(driveInspectCommand);
driveCommand.addCommand(driveAddCommand);
driveCommand.addCommand(driveSyncCommand);
driveCommand.addCommand(driveStatusCommand);
driveCommand.addCommand(driveListCommand);
driveCommand.addCommand(driveMountCommand);
driveCommand.addCommand(driveLinkCommand);
driveCommand.addCommand(driveUnmountCommand);
