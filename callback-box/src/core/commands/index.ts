/**
 * Command Registry
 *
 * Import this module to register all commands with the command runner.
 */

// Import commands to register them
import "./create.js";
import "./connector-sync.js";
import "./answer.js";
import "./trash.js";
import "./move.js";
import "./fetch-news.js";
import "./fetch-all-news.js";
import "./process-news.js";
import "./process-feedback.js";
import "./triage-feedback.js";
import "./procedure.js";
import "./transcribe-captures.js";
import "./assemble-timeline.js";
import "./describe-images.js";
import "./ls.js";
import "./wakeup.js";

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

export { getTemplateNames } from "../../schemas/index.js";
