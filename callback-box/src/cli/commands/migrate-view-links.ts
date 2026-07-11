/**
 * cb migrate-view-links - Rewrite stored markdown/card content off the retired
 * `view:` URL scheme onto plain box paths (one-time migration).
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { migrateBoxViewLinks } from "../../core/views/link-migration.js";
import { errorMessage } from "../../lib/error-guards.js";

export const migrateViewLinksCommand = new Command("migrate-view-links")
  .description("Rewrite retired view: links in box content to plain paths ([l](view:x) -> [l](x), dropping ?zoom).")
  .option("--dry-run", "Report what would change without writing")
  .action(async (options: { dryRun?: boolean }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const dryRun = options.dryRun === true;
      const report = await migrateBoxViewLinks(boxRoot, { dryRun });
      const verb = dryRun ? "Would rewrite" : "Rewrote";
      if (report.total === 0) {
        console.log("No view: links found.");
        return;
      }
      console.log(`${verb} ${String(report.total)} view: link(s) in ${String(report.changed.length)} file(s):`);
      for (const c of report.changed) {
        console.log(`  ${c.file}  (${String(c.count)})`);
      }
      if (dryRun) console.log("\n(dry run — re-run without --dry-run to apply)");
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`);
      process.exit(1);
    }
  });
