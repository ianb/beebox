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

export const doctorCommand = new Command("doctor")
  .description("Check and repair box configuration")
  .addCommand(annexSubcommand);
