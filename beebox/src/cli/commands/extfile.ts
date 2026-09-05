/**
 * bbx extfile — manage extfile cards (in-box pointers to live external files).
 *
 * `bbx extfile sync [paths...]` re-stamps each card's version/size/mtime from its
 * live file. With no paths it syncs every `*.extfile.card` in the box.
 */

import { resolve, relative } from "node:path";
import { Command } from "commander";
import { glob } from "glob";
import { requireBoxRoot } from "../../lib/paths.js";
import { syncExtfile } from "../../core/extfile-sync.js";

async function findExtfileCards(boxRoot: string): Promise<string[]> {
  const matches = await glob("**/*.extfile.card", { cwd: boxRoot, absolute: true, nodir: true });
  return matches.toSorted();
}

const syncCommand = new Command("sync")
  .description("Re-stamp extfile cards' version/size/mtime from their live files")
  .argument("[paths...]", "Extfile card paths (default: all *.extfile.card in the box)")
  .action(async (paths: string[]) => {
    const boxRoot = await requireBoxRoot();
    const targets = paths.length > 0 ? paths.map((p) => resolve(p)) : await findExtfileCards(boxRoot);
    if (targets.length === 0) {
      console.log("No extfile cards found.");
      return;
    }
    const results = await syncExtfile({ boxRoot, paths: targets });
    let stamped = 0;
    let unresolved = 0;
    for (const r of results) {
      if (r.status === "stamped") stamped++;
      if (r.status === "unresolved") unresolved++;
      const detail = r.detail === undefined ? "" : `  (${r.detail})`;
      console.log(`${r.status.padEnd(10)} ${relative(boxRoot, r.path)}${detail}`);
    }
    console.log(`\n${String(stamped)} stamped, ${String(results.length - stamped - unresolved)} unchanged, ${String(unresolved)} unresolved`);
    if (unresolved > 0) process.exitCode = 1;
  });

export const extfileCommand = new Command("extfile")
  .description("Manage extfile cards (pointers to live external files)")
  .addCommand(syncCommand);
