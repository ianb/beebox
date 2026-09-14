/**
 * `bbx drive mount` / `link` / `unmount` — the three subcommands that write and
 * remove Drive mount cards.
 *
 * Thin wrappers: every decision lives in `connectors/drive-mounts.ts`, which
 * the settings page and chat reach through tRPC. All this layer does is decide
 * WHERE the operation runs (`drive-dispatch.ts`: in-process only under the
 * tooling profile, otherwise through this box's own server), turn a refusal
 * into a non-zero exit, and print what changed.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import {
  linkDriveItem,
  mountDriveFolder,
  unmountDriveFolder,
  type LinkResult,
  type MountFolderResult,
  type UnmountResult,
} from "../../connectors/drive-mounts.js";
import { dispatchDrive, jsonFlag, localDriveService, runDriveVerb } from "./drive-dispatch.js";

export const driveMountCommand = new Command("mount")
  .description("Mirror a Drive folder into a directory (the directory is the mount)")
  .argument("<url-or-id>", "Drive folder URL or ID")
  .argument("<dir>", "Directory to mirror it into — required, never guessed")
  .option("--json", "Print the result as one JSON object")
  .action(async (input: string, dir: string) => {
    const boxRoot = await requireBoxRoot();
    await runDriveVerb({
      json: jsonFlag(driveMountCommand),
      run: () =>
        dispatchDrive<MountFolderResult>({
          local: async () =>
            mountDriveFolder({ boxRoot, service: await localDriveService(boxRoot), input, dir }),
          remote: (client) => client.drive.mount.mutate({ url: input, dir }),
        }),
      print: (result) => {
        console.log(`Mounted "${result.name}" at ${result.cardPath}`);
        if (result.created.length > 0) {
          console.log(`  Mirrored ${String(result.created.length)} child card(s)`);
        }
        for (const note of result.notes) console.log(`  Note: ${note}`);
        // The mount exists either way — a child that could not be mirrored is
        // reported, not rolled back, and the next sync tries it again.
        for (const failure of result.failures) console.error(`  ${failure}`);
      },
      failed: (result) => result.failures.length > 0,
    });
  });

export const driveLinkCommand = new Command("link")
  .description("Keep a pointer to a Drive item without copying it")
  .argument("<url-or-id>", "Drive URL or ID — any type, folders included")
  .argument("<path>", "Where to write the pointer (.glink.card is added if missing)")
  .option("--json", "Print the result as one JSON object")
  .action(async (input: string, target: string) => {
    const boxRoot = await requireBoxRoot();
    await runDriveVerb({
      json: jsonFlag(driveLinkCommand),
      run: () =>
        dispatchDrive<LinkResult>({
          local: async () =>
            linkDriveItem({ boxRoot, service: await localDriveService(boxRoot), input, target }),
          remote: (client) => client.drive.link.mutate({ url: input, path: target }),
        }),
      print: (result) => {
        console.log(`Created ${result.cardPath}`);
        console.log(`  "${result.name}" (${result.mimeType})`);
        console.log("  Write what it is for in the card's body — the connector never touches it.");
      },
    });
  });

export const driveUnmountCommand = new Command("unmount")
  .description("Stop mirroring a folder — children stay exactly where they are")
  .argument("<dir-or-card>", "The mount directory, or the .gfolder.card itself")
  .option("--json", "Print the result as one JSON object")
  .action(async (target: string, options: { json?: boolean }) => {
    const boxRoot = await requireBoxRoot();
    await runDriveVerb({
      json: options.json,
      // Unmounting needs no Drive service — but it still delegates outside the
      // tooling profile, so one rule covers the family and the commit lands
      // with the same attribution as every other mount write.
      run: () =>
        dispatchDrive<UnmountResult>({
          local: () => unmountDriveFolder({ boxRoot, target }),
          remote: (client) => client.drive.unmount.mutate({ cardPath: target }),
        }),
      print: (result) => {
        console.log(`Unmounted ${result.cardPath} → ${result.trashedTo}`);
        console.log("  Children kept: synced cards keep syncing, pointers keep pointing.");
      },
    });
  });
