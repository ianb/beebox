/**
 * cb boxes - Manage the box manifest at ~/.config/cb/boxes.json.
 *
 * Both `cb serve` (when invoked without explicit box arguments) and
 * `cb scheduler start` read from this manifest, so adding a box here
 * makes it visible to both the webapp and the schedule runner without
 * having to touch the systemd unit or run separate commands.
 */

import * as path from "node:path";
import { Command } from "commander";
import {
  loadBoxesConfig,
  addBoxToManifest,
  removeBoxFromManifest,
} from "../../core/boxes-config.js";
import { isBox } from "../../core/scheduler.js";

export const boxesCommand = new Command("boxes")
  .description("Manage the box manifest used by serve and scheduler");

boxesCommand
  .command("add")
  .description("Add a box to the manifest")
  .argument("<path>", "Path to the box")
  .action(async (boxPath: string) => {
    const resolved = path.resolve(boxPath);
    if (!(await isBox(resolved))) {
      console.error(`Not a valid box (missing .cb-box): ${resolved}`);
      process.exit(1);
    }
    const added = await addBoxToManifest(resolved);
    if (added) {
      console.log(`Added: ${resolved}`);
    } else {
      console.log(`Already in manifest: ${resolved}`);
    }
  });

boxesCommand
  .command("remove")
  .description("Remove a box from the manifest")
  .argument("<path>", "Path to the box")
  .action(async (boxPath: string) => {
    const resolved = path.resolve(boxPath);
    const removed = await removeBoxFromManifest(resolved);
    if (removed) {
      console.log(`Removed: ${resolved}`);
    } else {
      console.error(`Not in manifest: ${resolved}`);
      process.exit(1);
    }
  });

boxesCommand
  .command("list")
  .description("List all boxes in the manifest")
  .action(async () => {
    const config = await loadBoxesConfig();
    if (config.boxes.length === 0) {
      console.log("No boxes configured. Use `cb boxes add <path>` to add one.");
      return;
    }
    for (const box of config.boxes) {
      const valid = await isBox(box);
      console.log(`${valid ? "  " : "! "}${box}${valid ? "" : " (missing .cb-box)"}`);
    }
  });
