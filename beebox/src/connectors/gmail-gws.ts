/** Authenticated, read-only passthrough to the pinned Google Workspace CLI. */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import type { GoogleAuthService } from "../services/google-auth.js";

const READ_OPERATIONS = new Set(["get", "list", "getProfile"]);
const READ_HELPERS = new Set(["+read", "+triage"]);

export class UnsafeGwsCommandError extends Error {
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

/** What one `gws` run produced. `exitCode` is the child's, never invented. */
export interface GwsRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * How a caller runs gws. The tRPC procedure takes one from `ctx.services` so a
 * test can answer without a real child, the way `wakeupRunner` does.
 */
export type GwsRunner = (opts: { args: string[]; auth: GoogleAuthService }) => Promise<GwsRunResult>;

/**
 * As much of a stream as is worth holding in memory. The server runs this child
 * on behalf of a delegating caller, so an upstream command that prints a
 * mailbox's worth of output must not become the box server's memory problem;
 * past this point the bytes are counted and dropped rather than retained.
 */
const MAX_CAPTURE_CHARS = 1_000_000;

/** A bounded string accumulator that says how much it threw away. */
function boundedCapture() {
  let kept = "";
  let dropped = 0;
  return {
    add(chunk: string): void {
      const room = MAX_CAPTURE_CHARS - kept.length;
      if (room > 0) kept += chunk.slice(0, room);
      dropped += chunk.length - Math.max(room, 0);
    },
    text(): string {
      if (dropped === 0) return kept;
      return `${kept}\n…(${String(dropped)} further characters dropped)`;
    },
  };
}

/**
 * Run gws with a short-lived token only in the child env, and capture what it
 * said.
 *
 * Captured rather than streamed to this process's stdio: the same call has to
 * answer a person at a terminal and an agent that asked its box's server to run
 * it, and a server-side child has no terminal to stream to
 * (`docs/plans/agent-capability-delegation.md`). The CLI writes the captured
 * streams straight back out, so a person sees what they always saw, at the end
 * rather than as it arrives.
 */
export async function runReadOnlyGws(opts: {
  args: string[];
  auth: GoogleAuthService;
}): Promise<GwsRunResult> {
  assertReadOnlyGwsArgs(opts.args);
  const token = await opts.auth.getAccessToken();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [gwsRunnerPath(), ...opts.args], {
      // TODO(env-migration) -- gws needs the caller's ambient CLI environment plus its token.
      env: { ...process.env, GOOGLE_WORKSPACE_CLI_TOKEN: token },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = boundedCapture();
    const stderr = boundedCapture();
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => { stdout.add(chunk); });
    child.stderr.on("data", (chunk: string) => { stderr.add(chunk); });
    child.once("error", reject);
    // `close`, not `exit`: the streams must be drained before the capture is
    // read, or a fast-exiting child's last output is lost.
    child.once("close", (code, signal) => {
      if (signal !== null) {
        reject(new GwsSignalExitError(signal));
        return;
      }
      resolve({ exitCode: code ?? 1, stdout: stdout.text(), stderr: stderr.text() });
    });
  });
}
