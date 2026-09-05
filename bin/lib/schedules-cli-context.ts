/**
 * `bin/schedules`'s process context and argument reading.
 *
 * Split out of `bin/schedules.ts` as a pure move: the checkout paths a command
 * runs against, the `RunnerDeps` built from them, and the `--flag value`
 * reader every verb shares.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execa } from "execa";

import { schedulesStoreRoot } from "./schedules.js";
import { bootTimeMs, isProcessAlive } from "./schedules-store.js";
import { osascriptNotify, type RunnerDeps } from "./schedules-alerts.js";

export interface Context {
  repoRoot: string;
  mainRoot: string;
  schedulesRoot: string;
  storeRoot: string;
}

export async function resolveContext(): Promise<Context> {
  const { stdout: top } = await execa("git", ["rev-parse", "--show-toplevel"]);
  const { stdout: common } = await execa("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const repoRoot = top.trim();
  const mainRoot = path.dirname(common.trim());
  // `BBX_SCHEDULES_DIR` points the CLI at a different set of schedule
  // directories, the way `BBX_SCHEDULES_ROOT` points it at a different
  // store — what lets a test run `lint` over a fixture tree.
  const schedulesDir = process.env["BBX_SCHEDULES_DIR"];
  return {
    repoRoot,
    mainRoot,
    schedulesRoot: schedulesDir === undefined || schedulesDir === "" ? path.join(repoRoot, "schedules") : schedulesDir,
    storeRoot: schedulesStoreRoot(mainRoot),
  };
}

export function runnerDeps(context: Context): RunnerDeps {
  return {
    storeRoot: context.storeRoot,
    schedulesRoot: context.schedulesRoot,
    repoRoot: context.repoRoot,
    mainRoot: context.mainRoot,
    now: () => new Date(),
    pid: process.pid,
    isProcessAlive,
    bootTimeMs,
    // SCHEDULE_NOTIFY=0 keeps the alert record but skips the desktop
    // notification — set by the test suite so fixtures never reach the
    // boxholder's notification center.
    notify: process.env["SCHEDULE_NOTIFY"] === "0" ? async () => {} : osascriptNotify,
  };
}

// ─── Argument reading ─────────────────────────────────────────────────────

const VALUE_FLAGS = new Set(["title", "message", "details", "body", "priority", "workstream", "run"]);

/** `--flag value`, values consumed unconditionally: a message of "-- no" is
 *  the author's words, not a flag (the bin/comments rule). */
export function flags(args: string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined || !arg.startsWith("--")) continue;
    const name = arg.slice(2);
    if (!VALUE_FLAGS.has(name)) continue;
    found.set(name, args[i + 1] ?? "");
    i += 1;
  }
  return found;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** `@file` reads the file, `-` reads stdin, anything else is the text itself.
 *  Long details are the whole point of the flag, and no shell should have to
 *  carry 40 lines of log as an argument. */
export async function readValue(raw: string): Promise<string> {
  if (raw === "-") return readStdin();
  if (raw.startsWith("@")) return fs.readFile(raw.slice(1), "utf8");
  return raw;
}

export function envOr(flagValue: string | undefined, variable: string): string | null {
  if (flagValue !== undefined && flagValue !== "") return flagValue;
  const fromEnv = process.env[variable];
  return fromEnv === undefined || fromEnv === "" ? null : fromEnv;
}

export function isDryRun(): boolean {
  return process.env["SCHEDULE_DRY_RUN"] === "1";
}
