/** Keep deployment ownership alive across activation and service replacement. */
import { Command } from "commander";
import { invariant } from "../../../shared/invariant.js";
import { holdBoxes } from "./hold.js";
import { runMaintenance } from "./controller.js";

export { runMaintenance } from "./controller.js";

const collect = (value: string, previous: string[]): string[] => [...previous, value];

export const maintenanceCommand = new Command("maintenance")
  .description("Hold box maintenance across a trusted deployment command")
  .requiredOption("--box <path>", "Box root (repeat for a fleet)", collect, [])
  .option("--verify-hub <origin>", "Verify each ready box through the hub canary before reopening")
  .option("--hub-config <path>", "The hub's config file, for the canary's slug lookup (default: this user's)")
  .argument("<command...>")
  .action(async (commandArgs: string[], options: { box: string[]; verifyHub?: string; hubConfig?: string }) => {
    const [command, ...args] = commandArgs;
    invariant(command, "Maintenance requires a command");
    process.exitCode = await runMaintenance(options.box, {
      command, args,
      ...(options.verifyHub ? { verifyHub: options.verifyHub } : {}),
      ...(options.hubConfig ? { hubConfig: options.hubConfig } : {}),
    });
  });

// The controller's holder (hold.ts): started by the controller as a box owner,
// never by hand. The roots are positional: a `--box` here would be taken by
// the parent command's option of the same name.
maintenanceCommand
  .command("hold", { hidden: true })
  .argument("<root...>", "Box roots to hold")
  .option("--reason <text>", "Why the boxes close", "deployment")
  .action(async (roots: string[], options: { reason: string }) => {
    process.exitCode = await holdBoxes(roots, { reason: options.reason, input: process.stdin, output: process.stdout });
  });
