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
 */

import * as fs from "node:fs/promises";
import { isRecord } from "../../lib/is-record.js";
import * as path from "node:path";
import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { extractDriveFileId } from "../../connectors/drive-types.js";
import { requireDriveService } from "./drive-service.js";
import { folderProblemCounts } from "../../connectors/drive-mount-list.js";
import type { DriveFile, GoogleDriveService } from "../../services/google-drive.js";
import { DriveIdClaimedError } from "../../connectors/drive-mount-errors.js";
import {
  driveLinkCommand,
  driveMountCommand,
  driveUnmountCommand,
} from "./drive-mount-cli.js";
import { stageAndCommitPaths } from "../../lib/git.js";
import { attachDirFor } from "../../shared/attach-path.js";
import { updateTransientState } from "../../connectors/transient-state.js";
import { withDriveMirrorLock } from "../../connectors/drive-lock.js";

// Ensure handlers are registered
import "../../connectors/drive-handler-sheets.js";
import "../../connectors/drive-handler-docs.js";
import { getHandlerForMimeType, type DriveTypeHandler } from "../../connectors/drive-types.js";
import {
  createGoogleDriveConnector,
  emptyFileState,
  type DriveTransientState,
} from "../../connectors/google-drive.js";
import { DEFAULT_DRIVE_STATE, normalizeDriveState } from "../../connectors/google-drive-state.js";
import {
  driveCardSummary,
  findDriveCardTracking,
  type DriveCardKind,
} from "../../connectors/google-drive-tracking.js";

/** How `bbx drive status` names each kind of Drive card. */
const DRIVE_KIND_LABEL: Record<DriveCardKind, string> = {
  file: "file (synced two-way)",
  folder: "folder (mirrored)",
  link: "link (pointer, nothing copied)",
};

/** Print the live Drive-card working set. Exported for filesystem doctests. */
export async function runDriveStatus(boxRoot: string): Promise<void> {
  const { liveCards, duplicates, unreadable } = await findDriveCardTracking(boxRoot);

  if (liveCards.length === 0 && duplicates.length === 0 && unreadable.length === 0) {
    console.log("No Drive cards in this box.");
    console.log('Use "bbx drive mount <folder-url> <dir>" to mirror a folder,');
    console.log('"bbx drive add <url> <path>" to sync a Doc or Sheet,');
    console.log('or "bbx drive link <url> <path>" to keep a pointer.');
    return;
  }

  console.log(`${String(liveCards.length)} Drive card(s):\n`);
  for (const card of liveCards) {
    const summary = driveCardSummary(card.content);

    console.log(`  ${card.relPath}`);
    console.log(`    Kind: ${DRIVE_KIND_LABEL[card.kind]}`);
    if (summary.title !== null) console.log(`    Title: ${summary.title}`);
    console.log(`    Drive ID: ${card.driveId}`);
    if (summary.modified !== null) console.log(`    Last synced: ${summary.modified}`);
    if (summary.status !== null && summary.status !== "synced") {
      console.log(`    Status: ${summary.status}`);
    }
    if (card.kind === "folder") {
      const problems = folderProblemCounts(card.content);
      if (problems.notInFolder > 0) {
        console.log(`    Not in folder: ${String(problems.notInFolder)} (still syncing on their own)`);
      }
      if (problems.unknown > 0) {
        console.log(`    Unknown: ${String(problems.unknown)} (Drive could not be read)`);
      }
    }
    if (summary.tabs.length > 0) {
      console.log(`    Tabs: ${summary.tabs.join(", ")}`);
    }
    if (summary.lossy.length > 0) {
      const lossy = summary.lossy
        .map((item) => `${item.type}=${String(item.count)}`)
        .join(", ");
      console.log(`    Lossy: ${lossy}`);
    }
    console.log("");
  }

  // Ambiguous local identity is not synced at all, so it must be visible here
  // rather than looking like an absent mount.
  for (const duplicate of duplicates) {
    console.log(`  ! Duplicate drive-id ${duplicate.driveId} (not synced):`);
    for (const relPath of duplicate.relPaths) console.log(`      ${relPath}`);
    console.log("");
  }
  for (const relPath of unreadable) {
    console.log(`  ! No readable drive-id: ${relPath}`);
  }
  if (unreadable.length > 0) console.log("");
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
  .description("Manage Google Drive mounts (files, folders, pointers)")
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

    // Everything from here is one Drive writer's span: the claim check, the
    // pull, and the state write. A connector sync in another process would
    // otherwise pull this same file between the check and the write. The lock
    // is taken OUTSIDE the git commit below — see connectors/drive-lock.ts for
    // why that is the only safe order.
    let written: string[];
    try {
      written = await withDriveMirrorLock(boxRoot, () =>
        addDriveFileUnderLock({ boxRoot, service, card: { file, handler, cardPath } }),
      );
    } catch (e) {
      if (!(e instanceof DriveIdClaimedError)) throw e;
      console.error(e.message);
      process.exit(1);
    }

    console.log(`Created ${path.relative(boxRoot, cardPath)}`);
    console.log(`  "${file.name}" (${handler.cardType})`);
    for (const item of written) {
      if (item !== path.relative(boxRoot, cardPath)) console.log(`  → ${item}`);
    }
  });

/** `bbx drive add`'s write span: claim check, first pull, state, commit. */
async function addDriveFileUnderLock(opts: {
  boxRoot: string;
  service: GoogleDriveService;
  card: { file: DriveFile; handler: DriveTypeHandler; cardPath: string };
}): Promise<string[]> {
  const { boxRoot, service } = opts;
  const { file, handler, cardPath } = opts.card;
  const fileId = file.id;

  // A second card for the same Drive ID is never a valid mount: transient
  // state is keyed by Drive ID while attachments are per-card, so the two
  // working copies overwrite each other upstream. Refuse at creation.
  const tracking = await findDriveCardTracking(boxRoot);
  const claimedBy = [
    ...tracking.liveCards.filter((card) => card.driveId === fileId).map((card) => card.relPath),
    ...tracking.duplicates
      .filter((duplicate) => duplicate.driveId === fileId)
      .flatMap((duplicate) => duplicate.relPaths),
  ];
  // Thrown rather than exited: `process.exit` inside the lock would skip the
  // release and leave the box's Drive lock held until it went stale.
  if (claimedBy.length > 0) throw new DriveIdClaimedError({ driveId: fileId, claimedBy });

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
  // future `bbx drive sync` runs see this file as already-synced. Delta-merge
  // under the serialized RMW lock: add ONLY this new file's entry to
  // freshly-loaded state, so a concurrent server `sync()` writing the same
  // file (from another process) isn't clobbered.
  await updateTransientState<DriveTransientState>({
    boxRoot,
    connectorName: "google-drive",
    defaultValue: DEFAULT_DRIVE_STATE,
    update: (fresh) => {
      const base = normalizeDriveState(fresh);
      return { ...base, files: { ...base.files, [fileId]: fileState } };
    },
  });

  await stageAndCommitPaths(boxRoot, {
    paths: result.written,
    message: `Add Drive ${handler.cardType}: ${file.name}`,
  });

  return result.written;
}

driveCommand
  .command("sync")
  .description("Sync all mounted Drive files")
  .action(async () => {
    const boxRoot = await requireBoxRoot();
    const connector = createGoogleDriveConnector(boxRoot);
    connector.triggeredBy = "bbx drive sync";
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
    await runDriveStatus(boxRoot);
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

driveCommand.addCommand(driveMountCommand);
driveCommand.addCommand(driveLinkCommand);
driveCommand.addCommand(driveUnmountCommand);
