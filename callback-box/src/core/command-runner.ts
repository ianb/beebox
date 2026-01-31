/**
 * Command Runner Framework
 *
 * A registry of commands that can be executed programmatically with streaming output.
 * This enables both CLI and web API to share the same command logic.
 */

/**
 * Context provided to command execution.
 */
export interface CommandContext {
  /** Root directory of the callback box */
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

// Command registry
const registry = new Map<string, CommandDefinition>();

/**
 * Register a command in the registry.
 */
export function registerCommand(cmd: CommandDefinition): void {
  if (registry.has(cmd.name)) {
    throw new Error(`Command '${cmd.name}' is already registered`);
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
 * Run a command by name with the given arguments.
 */
export async function runCommand(
  name: string,
  args: Record<string, unknown>,
  ctx: CommandContext
): Promise<CommandResult> {
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
      error: (error as Error).message,
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
