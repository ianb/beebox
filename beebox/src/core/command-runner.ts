/**
 * Command Runner Framework
 *
 * `runCommand`/`getCommand`/`listCommands` read `commands.ts`'s registry
 * directly (no separate mutable store to populate), and this module imports
 * that registry at its own load — so importing any lookup below is what
 * loads every command; no consumer needs a bare side-effect
 * `import "./commands.js"`. This enables both CLI and web API to share the
 * same command logic.
 */

import { errorMessage } from "../shared/error-guards.js";
import { commands } from "./commands.js";
import type { CommandContext, CommandDefinition, CommandResult } from "./command-types.js";

export type {
  ArgDefinition,
  CommandContext,
  CommandDefinition,
  CommandResult,
} from "./command-types.js";
export { CommandArgsError, parseCommandArgs } from "./command-types.js";

/**
 * Get a command by name.
 */
export function getCommand(name: string): CommandDefinition | undefined {
  return commands.get(name);
}

/**
 * List all registered commands.
 */
export function listCommands(): CommandDefinition[] {
  return Array.from(commands.list);
}

/**
 * Parameters for runCommand
 */
export interface RunCommandParams {
  name: string;
  args: Record<string, unknown>;
  ctx: CommandContext;
}

/**
 * Run a command by name with the given arguments.
 */
export async function runCommand(params: RunCommandParams): Promise<CommandResult> {
  const { name, args, ctx } = params;
  const cmd = commands.get(name);
  if (!cmd) {
    return {
      success: false,
      error: `Unknown command: ${name}`,
    };
  }

  try {
    return await cmd.execute(ctx, args);
  } catch (error) {
    return {
      success: false,
      error: errorMessage(error),
    };
  }
}

/**
 * Create a CommandContext for CLI usage.
 */
export function createCliContext(boxRoot: string): CommandContext {
  return {
    boxRoot,
    write: (text: string) => process.stdout.write(text),
    writeLine: (text: string) => console.log(text),
  };
}

/**
 * Create a CommandContext that collects output.
 */
export function createCollectorContext(
  boxRoot: string,
  onOutput?: (text: string) => void
): { ctx: CommandContext; getOutput: () => string } {
  const lines: string[] = [];

  const ctx: CommandContext = {
    boxRoot,
    write: (text: string) => {
      lines.push(text);
      onOutput?.(text);
    },
    writeLine: (text: string) => {
      lines.push(text + "\n");
      onOutput?.(text + "\n");
    },
  };

  return {
    ctx,
    getOutput: () => lines.join(""),
  };
}
