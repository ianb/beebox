/**
 * cb location — read the boxholder's last-known location.
 *
 * Location is captured (with consent) from the web UI and cached in the
 * gitignored `.callback-box/location.json`; this is the agent's on-demand
 * read interface. Prints `unknown` when nothing has been shared, and flags
 * `[stale]` fixes. Web-only: other channels never populate it.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { loadLocation } from "../../core/location-store.js";
import { formatLocationLine, locationAge } from "../../core/location-format.js";
import { loadPlaces } from "../../core/place-cards.js";
import { matchPlace } from "../../core/geo.js";
import { markPlace } from "../../core/place-mark.js";

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

    const matched = matchPlace(location, await loadPlaces(boxRoot));

    if (options.json) {
      const { ageMs, stale } = locationAge(location, now);
      console.log(JSON.stringify({ ...location, place: matched?.name ?? null, ageMs, stale }, null, 2));
    } else {
      console.log(formatLocationLine(location, { now, ...(matched ? { place: matched.name } : {}) }));
    }
  });

locationCommand
  .command("mark <card-path>")
  .description("Stamp the current location into an existing place card")
  .option("--expand", "Grow the place's radius to include a fix that falls outside it")
  .option("--box <path>", "Box root path (defaults to current directory)")
  .action(async (cardPath: string, options: { expand?: boolean; box?: string }) => {
    const boxRoot = options.box ?? (await requireBoxRoot());
    const result = await markPlace({ boxRoot, cardPath, expand: options.expand === true, now: new Date() });
    if (!result.ok) {
      console.error(result.error);
      process.exitCode = 1;
      return;
    }
    console.log(result.message);
  });
