/**
 * cb scenario - Run scenario tests against boxes.
 */

import { Command } from "commander";
import chalk from "chalk";
import { listScenarios, getScenariosDir } from "../../scenario/loader.js";
import { runScenario } from "../../scenario/runner.js";

const listCommand = new Command("list")
  .description("List available scenarios")
  .action(async () => {
    const scenarios = await listScenarios();
    if (scenarios.length === 0) {
      console.log(`No scenarios found in ${getScenariosDir()} (override with CB_SCENARIOS_DIR).`);
      return;
    }
    for (const name of scenarios) {
      console.log(name);
    }
  });

const runCommand = new Command("run")
  .description("Run a scenario")
  .argument("<name>", "Scenario name")
  .option("--dry-run", "Show steps without executing")
  .action(async (name: string, options: { dryRun?: boolean }) => {
    try {
      const result = await runScenario({
        name,
        dryRun: options.dryRun,
        onLog: (text) => console.log(text),
      });

      if (!result.passed) {
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

export const scenarioCommand = new Command("scenario")
  .description("Scenario testing for boxes")
  .addCommand(listCommand)
  .addCommand(runCommand);
