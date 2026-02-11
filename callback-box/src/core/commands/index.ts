/**
 * Command Registry
 *
 * Import this module to register all commands with the command runner.
 */

// Import commands to register them
import "./create.js";
import "./wakeup.js";
import "./answer.js";
import "./pull.js";
import "./trash.js";
import "./move.js";
import "./fetch-news.js";
import "./fetch-all-news.js";
import "./process-news.js";
import "./process-feedback.js";
import "./triage-feedback.js";
import "./workflow.js";
import "./transcribe-captures.js";
import "./assemble-timeline.js";

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
