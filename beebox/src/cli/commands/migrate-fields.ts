/**
 * bbx migrate-fields — move a box's cards off reserved field names by a map
 * (`src/core/card-fields/map.ts`), for a box-local schema that `bbx validate`
 * reports under "box-local schemas". Dry run by default; `--apply` writes.
 */

import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { requireBoxRoot } from "../../lib/paths/core.js";
import { applyFieldMap } from "../../core/card-fields/apply.js";
import { parseFieldMap } from "../../core/card-fields/map.js";
import { errorMessage } from "../../shared/error-guards.js";
import { typeFromFilename } from "../../core/card-io.js";

/** Converted cards per card type, for the summary. */
function countByType(paths: readonly string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const type = typeFromFilename(path) ?? "?";
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()].toSorted(([a], [b]) => a.localeCompare(b));
}

export const migrateFieldsCommand = new Command("migrate-fields")
  .description("Rename or replace frontmatter fields across this box's cards by a YAML map (see the box schema doc, \"Renaming a field\"). Dry run unless --apply.")
  .argument("<map>", "Path to the field map (YAML)")
  .option("--apply", "Write the changes (default: report only)")
  .option("--json", "Report as JSON")
  .action(async (mapPath: string, options: { apply?: boolean; json?: boolean }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const map = parseFieldMap(parseYaml(await readFile(mapPath, "utf8")));
      const apply = options.apply === true;
      const report = await applyFieldMap(boxRoot, { map, apply });
      if (options.json === true) {
        console.log(JSON.stringify({ apply, ...report }));
        return;
      }
      const verb = apply ? "Rewrote" : "Would rewrite";
      console.log(`${verb} ${String(report.converted.length)} card(s); ${String(report.already)} already in shape; ${String(report.refused.length)} refused.`);
      for (const [type, count] of countByType(report.converted)) console.log(`  ${type}: ${String(count)}`);
      for (const refusal of report.refused) console.log(`  refused ${refusal.path}: ${refusal.reason}`);
      if (!apply && report.converted.length > 0) console.log("\n(dry run — re-run with --apply to write)");
      if (report.refused.length > 0) process.exitCode = 2;
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`);
      process.exit(1);
    }
  });
