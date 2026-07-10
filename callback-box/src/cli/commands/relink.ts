/**
 * cb relink - Repair broken internal markdown links by locating the moved target.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { repairBoxLinks, type RepairReport } from "../../core/link-repair.js";
import { errorMessage } from "../../lib/error-guards.js";

function printReport(report: RepairReport, { dryRun }: { dryRun: boolean }): void {
  const verb = dryRun ? "Would fix" : "Fixed";
  if (report.fixed.length > 0) {
    console.log(`${verb} ${String(report.fixed.length)} link(s):`);
    for (const r of report.fixed) {
      console.log(`  ${r.file}:${String(r.lineNumber)}  ${r.oldUrl}  ->  ${r.newUrl ?? ""}`);
    }
  }
  if (report.ambiguous.length > 0) {
    console.log(`\n${String(report.ambiguous.length)} ambiguous link(s) — multiple targets match, choose one:`);
    for (const r of report.ambiguous) {
      console.log(`  ${r.file}:${String(r.lineNumber)}  ${r.oldUrl}`);
      for (const c of r.candidates) console.log(`      candidate: ${c}`);
    }
  }
  if (report.unresolvable.length > 0) {
    console.log(`\n${String(report.unresolvable.length)} unresolvable link(s) — no matching file in the box:`);
    for (const r of report.unresolvable) {
      console.log(`  ${r.file}:${String(r.lineNumber)}  ${r.oldUrl}`);
    }
  }
  const total = report.fixed.length + report.ambiguous.length + report.unresolvable.length;
  if (total === 0) {
    console.log("No broken internal links found.");
  } else if (dryRun && report.fixed.length > 0) {
    console.log("\n(dry run — re-run without --dry-run to apply the fixes)");
  }
}

export const relinkCommand = new Command("relink")
  .description("Repair broken internal markdown links by finding the target elsewhere in the box. Unambiguous matches are rewritten; ambiguous ones are reported for you to resolve.")
  .option("--dry-run", "Report what would change without writing")
  .option("--json", "Output the repair report as JSON")
  .action(async (options: { dryRun?: boolean; json?: boolean }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const dryRun = options.dryRun === true;
      const report = await repairBoxLinks(boxRoot, { dryRun });
      if (options.json === true) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printReport(report, { dryRun });
      }
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`);
      process.exit(1);
    }
  });
