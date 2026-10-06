/**
 * Spawn an external command and resolve with how it ended, never rejecting.
 *
 * Shared by the two places that shell out (`disposition.ts` for the Trash,
 * `notify.ts` for the desktop banner) because both need the same
 * three-way answer: it ran and exited N, or it could not be spawned at all
 * (`error.code === "ENOENT"` — the command isn't installed), which those
 * callers treat differently from a nonzero exit.
 */

import { spawn } from "node:child_process";

export interface CommandOutcome {
  readonly code: number | null;
  readonly error?: NodeJS.ErrnoException;
}

export function runCommand(command: string, args: readonly string[]): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", (error) => {
      resolve({ code: null, error });
    });
    child.on("close", (code) => {
      resolve({ code });
    });
  });
}

/** Escapes a value for interpolation into a double-quoted AppleScript string
 * literal, for the `osascript -e` calls that stand in for absent CLI tools. */
export function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
