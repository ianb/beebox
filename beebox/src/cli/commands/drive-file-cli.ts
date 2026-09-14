/**
 * `bbx drive inspect` and `bbx drive add` — the two verbs that need Drive to
 * answer a question about one file.
 *
 * Both go through `drive-dispatch.ts`: in-process under the tooling profile,
 * through this box's own server otherwise. The human output is unchanged; what
 * is new is that it now appears in an agent's shell, where the credential does
 * not.
 */

import { Command } from "commander";
import { isRecord } from "../../lib/is-record.js";
import { requireBoxRoot } from "../../lib/paths.js";
import { addDriveFile, type AddDriveFileResult } from "../../connectors/drive-add-file.js";
import { inspectDriveItem, type DriveInspectResult } from "../../connectors/drive-inspect.js";
import { dispatchDrive, jsonFlag, localDriveService, runDriveVerb } from "./drive-dispatch.js";

/** The handler-specific half of an inspect: sheet tabs, lossy counts, comments. */
function printInspectDetails(details: Record<string, unknown>): void {
  const tabs = details["tabs"];
  if (Array.isArray(tabs)) {
    console.log(`\nSheet tabs (${String(tabs.length)}):`);
    for (const tab of tabs) {
      if (isRecord(tab)) console.log(`  - ${String(tab["title"])} (gid: ${String(tab["gid"])})`);
    }
  }

  const lossy = details["lossy"];
  if (isRecord(lossy)) {
    const present = Object.entries(lossy).filter(([, n]) => typeof n === "number" && n > 0);
    if (present.length > 0) {
      console.log("\nLossy content (will not survive markdown push):");
      for (const [type, count] of present) {
        console.log(`  - ${type}: ${String(count)}`);
      }
    }
  }

  const comments = details["comments"];
  if (typeof comments === "number" && comments > 0) {
    console.log(`\nComments: ${String(comments)} (captured to a read-only sidecar on sync)`);
  }

  const revisionId = details["revisionId"];
  if (typeof revisionId === "string") console.log(`\nRevision: ${revisionId}`);
}

function printInspect(file: DriveInspectResult): void {
  console.log(`Title:    ${file.name}`);
  console.log(`Type:     ${file.mimeType}`);
  console.log(`ID:       ${file.id}`);
  console.log(`Modified: ${file.modifiedTime}`);
  console.log(`Owner:    ${file.owner ?? "unknown"}`);
  if (file.webViewLink !== null) console.log(`Link:     ${file.webViewLink}`);
  if (file.claimedBy.length > 0) {
    console.log(`Mounted:  already claimed by ${file.claimedBy.join(", ")}`);
  }

  if (file.details !== null) printInspectDetails(file.details);
  if (file.cardType === null) console.log("\nNo handler registered for this file type.");
  else console.log(`\nCard type: ${file.cardType}`);
}

export const driveInspectCommand = new Command("inspect")
  .description("Preview file metadata without syncing")
  .argument("<url-or-id>", "Drive URL or ID")
  .option("--json", "Print the result as one JSON object")
  .action(async (input: string, options: { json?: boolean }) => {
    const boxRoot = await requireBoxRoot();
    await runDriveVerb({
      json: options.json,
      run: () =>
        dispatchDrive<DriveInspectResult>({
          local: async () =>
            inspectDriveItem({ boxRoot, service: await localDriveService(boxRoot), input }),
          remote: (client) => client.drive.inspect.query({ url: input }),
        }),
      print: printInspect,
    });
  });

export const driveAddCommand = new Command("add")
  .description("Mount a Drive file at a local path")
  .argument("<url-or-id>", "Drive URL or ID of a Doc or Sheet")
  .argument("<path>", "Where to write the card (the .<type>.card suffix is added if missing)")
  .option("--json", "Print the result as one JSON object")
  .action(async (input: string, target: string) => {
    const boxRoot = await requireBoxRoot();
    await runDriveVerb({
      json: jsonFlag(driveAddCommand),
      run: () =>
        dispatchDrive<AddDriveFileResult>({
          local: async () =>
            addDriveFile({ boxRoot, service: await localDriveService(boxRoot), input, target }),
          remote: (client) => client.drive.add.mutate({ url: input, path: target }),
        }),
      print: (result) => {
        console.log(`Created ${result.cardPath}`);
        console.log(`  "${result.name}" (${result.cardType})`);
        for (const item of result.written) {
          if (item !== result.cardPath) console.log(`  → ${item}`);
        }
      },
    });
  });
