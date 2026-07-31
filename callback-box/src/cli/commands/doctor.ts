/**
 * cb doctor — check and repair box configuration.
 *
 * Currently one subcommand, `annex`, which verifies (and by default fixes)
 * the box's git-annex setup. Repair-by-default is the point: five of the seven
 * checks describe a state the box can put right, so making a human run the
 * obvious command afterwards is a wasted round trip.
 *
 * Deliberately NOT a `cb serve` startup gate — see the header of
 * src/core/annex/doctor.ts for why.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { getBoxShape } from "../../lib/box-shape.js";
import { createGitAnnexService } from "../../services/git-annex.js";
import { formatAnnexDoctor, runAnnexDoctor } from "../../core/annex/doctor.js";

const annexSubcommand = new Command("annex")
  .description("Check (and by default repair) this box's git-annex configuration")
  .option("--check", "Report problems without repairing them")
  .option("--json", "Machine-readable output")
  .option("--box <path>", "Box root path (defaults to current directory)")
  .action(async (options: { check?: boolean; json?: boolean; box?: string }) => {
    const boxRoot = options.box ?? (await requireBoxRoot());
    // The git repository is the package root for a shape-2 box, while attach
    // scopes live under the operational box root. Passing one for the other
    // gives a doctor that silently inspects the wrong tree.
    const shape = await getBoxShape(boxRoot);
    const result = await runAnnexDoctor(createGitAnnexService(), {
      repoRoot: shape.packageRoot,
      boxRoot,
      options: { check: options.check === true },
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatAnnexDoctor(result));
    }

    if (!result.healthy) process.exitCode = 1;
  });

/**
 * Scheduled integrity pass. Separate from `doctor annex` because it is
 * expensive (it rehashes content) and because it answers a different question:
 * the doctor asks "is this configured correctly", fsck asks "are the bytes
 * still what they claim to be".
 *
 * Run from a box schedule, not from wakeup housekeeping. Housekeeping holds no
 * lock and runs inside an otherwise-unlocked wakeup flow, so "hold the box
 * lock" would have excluded nothing; `git annex fsck` is read-only, which
 * makes overlap harmless by construction — a file added mid-run is fscked next
 * cycle.
 */
const annexFsckSubcommand = new Command("annex-fsck")
  .description("Verify annexed content against its keys (incremental, read-only)")
  .option("--days <n>", "Days to spread a full pass over", "30")
  .option("--box <path>", "Box root path (defaults to current directory)")
  .action(async (options: { days?: string; box?: string }) => {
    const boxRoot = options.box ?? (await requireBoxRoot());
    const shape = await getBoxShape(boxRoot);
    const days = Number(options.days ?? "30");
    if (!Number.isFinite(days) || days <= 0) {
      console.error(`--days must be a positive number, got: ${String(options.days)}`);
      process.exitCode = 1;
      return;
    }
    const report = await createGitAnnexService().fsck(shape.packageRoot, {
      incrementalScheduleDays: days,
    });
    if (report.clean) {
      // Routine success prints nothing beyond a single line — this runs on a
      // schedule, and noisy output costs agent context every cycle.
      console.log("annex fsck: no bad content");
      return;
    }
    console.error(`annex fsck: ${String(report.badPaths.length)} object(s) with bad content:`);
    for (const p of report.badPaths) console.error(`  ${p}`);
    console.error("Quarantined under .git/annex/bad/. Restore from backup.");
    process.exitCode = 1;
  });

export const doctorCommand = new Command("doctor")
  .description("Check and repair box configuration")
  .addCommand(annexSubcommand)
  .addCommand(annexFsckSubcommand);
