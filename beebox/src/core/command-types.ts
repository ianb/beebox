/**
 * Command shape — the types and args-validation helper every command
 * member and `command-runner.ts` share.
 *
 * A dependency-free leaf: no import of `commands.ts` (the registry) or
 * `command-runner.ts` (the store's lookups). Command members import this
 * module instead of `command-runner.ts`, breaking the cycle that would
 * otherwise form when `command-runner.ts` imports the registry to make a
 * lookup load every command (see `command-runner.ts`'s own comment).
 */

import type { z } from "zod";

/**
 * Thrown by {@link parseCommandArgs} when a command's args fail validation.
 * `runCommand` catches it and returns a `{ success: false }` result, so a
 * malformed programmatic call surfaces as a loud, localized failure instead of
 * flowing past an `as unknown as` cast as mis-typed data.
 */
export class CommandArgsError extends Error {
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
