/**
 * `bbx drive status` — the live Drive-card working set, read from disk.
 *
 * The one Drive verb that stays in-process under every spawn profile: it opens
 * cards in the box and never contacts Google, so there is nothing to delegate
 * and nothing for a missing credential to break.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { folderProblemCounts } from "../../connectors/drive-mount-list.js";
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

/** The same working set as data, for `--json`. */
async function driveStatusValue(boxRoot: string): Promise<unknown> {
  const { liveCards, duplicates, unreadable } = await findDriveCardTracking(boxRoot);
  return {
    cards: liveCards.map((card) => {
      const summary = driveCardSummary(card.content);
      return {
        relPath: card.relPath,
        kind: card.kind,
        driveId: card.driveId,
        title: summary.title,
        modified: summary.modified,
        status: summary.status,
        tabs: summary.tabs,
        lossy: summary.lossy,
        problems: card.kind === "folder" ? folderProblemCounts(card.content) : null,
      };
    }),
    duplicates: duplicates.map((duplicate) => ({
      driveId: duplicate.driveId,
      relPaths: duplicate.relPaths,
    })),
    unreadable,
  };
}

export const driveStatusCommand = new Command("status")
  .description("Show status of mounted Drive files")
  .option("--json", "Print the working set as one JSON object")
  .action(async (options: { json?: boolean }) => {
    const boxRoot = await requireBoxRoot();
    if (options.json === true) {
      console.log(JSON.stringify(await driveStatusValue(boxRoot)));
      return;
    }
    await runDriveStatus(boxRoot);
  });
