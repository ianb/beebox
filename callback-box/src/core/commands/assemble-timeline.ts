/**
 * Assemble timeline — merges word-level timing data with image capture times
 * into the session card's transcript body (markdown + Markdoc tags).
 *
 * Prerequisites: all audio transcribed, all images analyzed/invalid.
 *
 * Algorithm:
 * 1. Load all .timing.json files, compute absolute word timestamps
 * 2. Load image cards for captured timestamps
 * 3. Merge all events by absolute time
 * 4. Group consecutive words into text paragraphs
 * 5. Insert `{% silence duration="Ns" /%}` for gaps > 10s
 * 6. Insert `{% image ref="..." /%}` at capture time
 * 7. Write the transcript as the session card's markdown body
 */

import { registerCommand } from "../command-runner.js";
import { getBoxDir } from "../../cli/lib/paths.js";
import { assembleSession, readInboxEntries } from "./assemble-timeline-helpers.js";

registerCommand({
  name: "assemble-timeline",
  description: "Assemble structured transcript from timing data and images",
  args: [],
  execute: async (ctx) => {
    const inboxDir = getBoxDir(ctx.boxRoot, "inbox");

    const entries = await readInboxEntries(inboxDir);
    if (!entries) {
      ctx.writeLine("No inbox directory found.");
      return { success: true, data: { assembled: 0 } };
    }

    const sessionCardNames = entries
      .filter((e) => !e.isDirectory() && e.name.endsWith(".capture-session.card"))
      .map((e) => e.name);

    let assembled = 0;
    for (const sessionCardName of sessionCardNames) {
      const didAssemble = await assembleSession({ ctx, inboxDir, sessionCardName });
      if (didAssemble) assembled++;
    }

    ctx.writeLine(`\nAssembly complete: ${assembled} sessions.`);
    return { success: true, data: { assembled } };
  },
});
