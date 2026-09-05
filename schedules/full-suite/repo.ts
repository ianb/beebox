/**
 * The few things every part of this schedule needs: where the checkout is, how
 * to ask git a question, and how to give up.
 *
 * Its own module so `run.ts` and `checkout.ts` can share them without importing
 * each other. See run.ts for the design and the plan reference.
 */

import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** The checkout this schedule was invoked from — the main one, or it refuses. */
export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

export function refuse(message: string): never {
  process.stderr.write(`full-suite: ${message}\n`);
  process.exit(2);
}

export async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: cwd ?? REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.replace(/\n$/u, "");
}
