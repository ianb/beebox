/**
 * cb location — read the boxholder's last-known location.
 *
 * Location is captured (with consent) from the web UI and cached in the
 * gitignored `.callback-box/location.json`; this is the agent's on-demand
 * read interface. Prints `unknown` when nothing has been shared, and flags
 * `[stale]` fixes. Web-only: other channels never populate it.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { loadLocation } from "../../core/location-store.js";
import { formatLocationLine, locationAge } from "../../core/location-format.js";

export const locationCommand = new Command("location")
  .description("Read the boxholder's last-known location (web-shared, on-demand)")
  .action(async () => {
    // Default action: behave as `get`.
    await locationCommand.commands.find((c) => c.name() === "get")?.parseAsync([], { from: "user" });
  });

locationCommand
  .command("get")
  .description("Print last-known location, or 'unknown' if none has been shared")
  .option("--json", "Machine-readable output")
  .option("--box <path>", "Box root path (defaults to current directory)")
  .action(async (options: { json?: boolean; box?: string }) => {
    const boxRoot = options.box ?? (await requireBoxRoot());
    const location = await loadLocation(boxRoot);
    const now = new Date();

    if (!location) {
      console.log(options.json ? JSON.stringify({ status: "unknown" }, null, 2) : "unknown");
      return;
    }

    if (options.json) {
      const { ageMs, stale } = locationAge(location, now);
      console.log(JSON.stringify({ ...location, ageMs, stale }, null, 2));
    } else {
      console.log(formatLocationLine(location, now));
    }
  });
