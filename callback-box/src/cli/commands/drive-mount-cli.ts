/**
 * `cb drive mount` / `link` / `unmount` — the three subcommands that write and
 * remove Drive mount cards.
 *
 * Thin wrappers: every decision lives in `connectors/drive-mounts.ts`, which
 * the settings page and chat reach through tRPC. All this layer does is turn a
 * refusal into a non-zero exit and print what changed.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { errorMessage } from "../../lib/error-guards.js";
import { DriveMountError } from "../../connectors/drive-mount-errors.js";
import {
  linkDriveItem,
  mountDriveFolder,
  unmountDriveFolder,
} from "../../connectors/drive-mounts.js";
import { requireDriveService } from "./drive-service.js";

/** A refusal is the user's to fix; anything else is a real failure. */
function reportAndExit(error: unknown): never {
  if (error instanceof DriveMountError) console.error(error.message);
  else console.error(`Drive command failed: ${errorMessage(error)}`);
  process.exit(1);
}

export const driveMountCommand = new Command("mount")
  .description("Mirror a Drive folder into a directory (the directory is the mount)")
  .argument("<url-or-id>", "Drive folder URL or ID")
  .argument("<dir>", "Directory to mirror it into — required, never guessed")
  .action(async (input: string, dir: string) => {
    const boxRoot = await requireBoxRoot();
    const service = await requireDriveService(boxRoot);
    try {
      const result = await mountDriveFolder({ boxRoot, service, input, dir });
      console.log(`Mounted "${result.name}" at ${result.cardPath}`);
      if (result.created.length > 0) {
        console.log(`  Mirrored ${String(result.created.length)} child card(s)`);
      }
      for (const note of result.notes) console.log(`  Note: ${note}`);
      // The mount exists either way — a child that could not be mirrored is
      // reported, not rolled back, and the next sync tries it again.
      for (const failure of result.failures) console.error(`  ${failure}`);
      if (result.failures.length > 0) process.exit(1);
    } catch (error) {
      reportAndExit(error);
    }
  });

export const driveLinkCommand = new Command("link")
  .description("Keep a pointer to a Drive item without copying it")
  .argument("<url-or-id>", "Drive URL or ID — any type, folders included")
  .argument("<path>", "Where to write the pointer (.glink.card is added if missing)")
  .action(async (input: string, target: string) => {
    const boxRoot = await requireBoxRoot();
    const service = await requireDriveService(boxRoot);
    try {
      const result = await linkDriveItem({ boxRoot, service, input, target });
      console.log(`Created ${result.cardPath}`);
      console.log(`  "${result.name}" (${result.mimeType})`);
      console.log("  Write what it is for in the card's body — the connector never touches it.");
    } catch (error) {
      reportAndExit(error);
    }
  });

export const driveUnmountCommand = new Command("unmount")
  .description("Stop mirroring a folder — children stay exactly where they are")
  .argument("<dir-or-card>", "The mount directory, or the .gfolder.card itself")
  .action(async (target: string) => {
    const boxRoot = await requireBoxRoot();
    try {
      const result = await unmountDriveFolder({ boxRoot, target });
      console.log(`Unmounted ${result.cardPath} → ${result.trashedTo}`);
      console.log("  Children kept: synced cards keep syncing, pointers keep pointing.");
    } catch (error) {
      reportAndExit(error);
    }
  });
