/** Authenticated, read-only passthrough to the pinned Google Workspace CLI. */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import type { GoogleAuthService } from "../services/google-auth.js";

const READ_OPERATIONS = new Set(["get", "list", "getProfile"]);
const READ_HELPERS = new Set(["+read", "+triage"]);

class UnsafeGwsCommandError extends Error {
  constructor(args: string[]) {
    super(`Rejected non-read-only gws command: ${args.join(" ")}`);
    this.name = "UnsafeGwsCommandError";
  }
}

class GwsSignalExitError extends Error {
  readonly signal: NodeJS.Signals;

  constructor(signal: NodeJS.Signals) {
    super("gws exited from a signal");
    this.name = "GwsSignalExitError";
    this.signal = signal;
  }
}

function commandWords(args: string[]): string[] {
  const flagIndex = args.findIndex((arg) => arg.startsWith("-"));
  return flagIndex === -1 ? args : args.slice(0, flagIndex);
}

/** Validate the upstream argument vocabulary before minting a token. */
export function assertReadOnlyGwsArgs(args: string[]): void {
  if (args.length === 1 && ["help", "--help", "-h"].includes(args[0] ?? "")) return;
  if (args[0] === "schema" && args[1]?.startsWith("gmail.")) return;
  if (args[0] !== "gmail") throw new UnsafeGwsCommandError(args);
  const words = commandWords(args);
  if (words.length === 1 && args.some((arg) => arg === "--help" || arg === "-h")) return;
  const operation = words.at(-1);
  if (operation !== undefined && (READ_OPERATIONS.has(operation) || READ_HELPERS.has(operation))) {
    return;
  }
  throw new UnsafeGwsCommandError(args);
}

function gwsRunnerPath(): string {
  return createRequire(import.meta.url).resolve("@googleworkspace/cli/run.js");
}

/** Run gws with inherited stdio and a short-lived token only in child env. */
export async function runReadOnlyGws(opts: {
  args: string[];
  auth: GoogleAuthService;
}): Promise<number> {
  assertReadOnlyGwsArgs(opts.args);
  const token = await opts.auth.getAccessToken();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [gwsRunnerPath(), ...opts.args], {
      // TODO(env-migration) -- gws needs the caller's ambient CLI environment plus its token.
      env: { ...process.env, GOOGLE_WORKSPACE_CLI_TOKEN: token },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null) {
        reject(new GwsSignalExitError(signal));
        return;
      }
      resolve(code ?? 1);
    });
  });
}
