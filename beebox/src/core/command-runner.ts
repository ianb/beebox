/**
 * Command Runner Framework
 *
 * A registry of commands that can be executed programmatically with streaming output.
 * This enables both CLI and web API to share the same command logic.
 */

import type { z } from "zod";
import { errorMessage } from "../lib/error-guards.js";

/**
 * Thrown by {@link parseCommandArgs} when a command's args fail validation.
 * `runCommand` catches it and returns a `{ success: false }` result, so a
 * malformed programmatic call surfaces as a loud, localized failure instead of
 * flowing past an `as unknown as` cast as mis-typed data.
 */
class CommandArgsError extends Error {
  readonly issues: string;
  constructor(issues: string) {
    super(`invalid command arguments: ${issues}`);
    this.name = "CommandArgsError";
    this.issues = issues;
  }
}

/**
 * Validate a command's untyped `args` bag against its colocated Zod schema,
 * returning typed args. This is the command dispatch boundary (args arrive as
 * `Record<string, unknown>` from the CLI wrapper, tRPC, and tests), so per
 * rule 3 it validates exactly once here — replacing the per-command
 * `args as unknown as XArgs` casts. Schemas mark a field optional wherever the
 * command tolerates its absence and does its own presence-check, so validation
 * catches wrong-typed fields without pre-empting a command's own error text.
 */
export function parseCommandArgs<T>(args: Record<string, unknown>, schema: z.ZodType<T>): T {
  const result = schema.safeParse(args);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new CommandArgsError(issues);
  }
  return result.data;
}

/**
 * Context provided to command execution.
 */
export interface CommandContext {
  /** Root directory of the Bee Box */
  boxRoot: string;
  /** Write text to the output stream (no newline) */
  write: (text: string) => void;
  /** Write a line to the output stream (with newline) */
  writeLine: (text: string) => void;
}

/**
 * Argument definition for a command.
 */
export interface ArgDefinition {
  /** Argument name */
  name: string;
  /** Description for help text */
  description: string;
  /** Whether this argument is required */
  required: boolean;
  /** Default value if not provided */
  default?: unknown;
  /** Type of the argument */
  type: "string" | "boolean" | "number" | "string[]";
}

/**
 * Command definition.
 */
export interface CommandDefinition {
  /** Command name (e.g., "create", "wakeup") */
  name: string;
  /** Description for help text */
  description: string;
  /** Argument definitions */
  args: ArgDefinition[];
  /** Execute the command */
  execute: (
    ctx: CommandContext,
    args: Record<string, unknown>
  ) => Promise<CommandResult>;
}

/**
 * Result of command execution.
 */
export interface CommandResult {
  /** Whether the command succeeded */
  success: boolean;
  /** Structured result data for API consumers */
  data?: unknown;
  /** Error message if failed */
  error?: string;
}

class CommandAlreadyRegisteredError extends Error {
  constructor(name: string) {
    super(`Command '${name}' is already registered`);
    this.name = "CommandAlreadyRegisteredError";
  }
}

// Command registry
const registry = new Map<string, CommandDefinition>();

/**
 * Register a command in the registry.
 */
export function registerCommand(cmd: CommandDefinition): void {
  if (registry.has(cmd.name)) {
    throw new CommandAlreadyRegisteredError(cmd.name);
  }
  registry.set(cmd.name, cmd);
}

/**
 * Get a command by name.
 */
export function getCommand(name: string): CommandDefinition | undefined {
  return registry.get(name);
}

/**
 * List all registered commands.
 */
export function listCommands(): CommandDefinition[] {
  return Array.from(registry.values());
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
  const cmd = registry.get(name);
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
