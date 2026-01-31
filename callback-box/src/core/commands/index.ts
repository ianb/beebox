/**
 * Command Registry
 *
 * Import this module to register all commands with the command runner.
 */

// Import commands to register them
import "./create.js";
import "./wakeup.js";
import "./answer.js";

// Re-export for convenience
export {
  registerCommand,
  getCommand,
  listCommands,
  runCommand,
  createCliContext,
  createCollectorContext,
  type CommandContext,
  type CommandDefinition,
  type CommandResult,
  type ArgDefinition,
} from "../command-runner.js";

export { getTemplateNames } from "./create.js";
