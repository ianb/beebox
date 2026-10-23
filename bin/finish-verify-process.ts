/**
 * finish-verify's process mechanics: each check runs in its own process group
 * so a signal can stop the whole tree under it, and each run registers itself
 * so a concurrent run on the shared dev router is named.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { constants } from "node:os";
import { basename, join } from "node:path";
import { gitCommonDir } from "./test-git.js";
import { pidAlive } from "../beebox/src/hub/child-process-utils.js";

class EmptyCommandError extends Error {
  constructor() {
    super("empty command");
    this.name = "EmptyCommandError";
  }
}

export interface RunOutput {
  status: number;
  /** stdout alone, for a child whose stdout is data (preflight's sheet). */
  stdout: string;
  /** stdout then stderr, for parsing; the streamed log interleaves them as they arrived. */
  text: string;
}

/** Every child still running, each the leader of its own process group. */
const running = new Set<ChildProcess>();

/**
 * Run one command in its own process group, so a signal to finish-verify can
 * take down the whole tree under it (pnpm → test-ledger → tap → workers). A
 * plain child shares our group only when the signal comes from the terminal;
 * an agent harness that kills our pid alone left tap running and holding a
 * test slot.
 *
 * With `logPath`, output is appended to that file as it arrives, so a long
 * check can be followed while it runs.
 */
export function run(input: { argv: string[]; cwd: string; logPath?: string }): Promise<RunOutput> {
  const [command, ...args] = input.argv;
  if (command === undefined) throw new EmptyCommandError();
  const child = spawn(command, args, {
    cwd: input.cwd,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  running.add(child);
  let log = input.logPath === undefined ? undefined : openSync(input.logPath, "w");
  // A failed spawn emits both `error` and `close`; the second must not close again.
  const closeLog = (): void => {
    if (log !== undefined) closeSync(log);
    log = undefined;
  };
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => {
    stdout.push(chunk);
    if (log !== undefined) writeSync(log, chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr.push(chunk);
    if (log !== undefined) writeSync(log, chunk);
  });
  return new Promise((resolve, reject) => {
    child.on("error", (error) => {
      running.delete(child);
      closeLog();
      reject(error);
    });
    child.on("close", (status) => {
      running.delete(child);
      closeLog();
      const out = Buffer.concat(stdout).toString();
      resolve({ status: status ?? 1, stdout: out, text: `${out}${Buffer.concat(stderr).toString()}` });
    });
  });
}

/** On SIGINT/SIGTERM/SIGHUP, signal every running child's group, then exit 128+n. */
export function killChildrenOnSignal(onExit: () => void): void {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      for (const child of running) {
        if (child.pid === undefined) continue;
        try {
          process.kill(-child.pid, signal);
        } catch (e) {
          // ESRCH: the group exited between its last output and this signal.
          if (!(e instanceof Error && "code" in e && e.code === "ESRCH")) throw e;
        }
      }
      onExit();
      console.error(`finish-verify: ${signal}; stopped ${String(running.size)} running check(s)`);
      process.exit(128 + constants.signals[signal]);
    });
  }
}

/**
 * Other finish-verify runs on this machine's checkouts. Every worktree shares
 * one dev router, so a concurrent run's smoke walk slows this one's; a miss of
 * the smoke budget during one is load, not necessarily a regression. Runs
 * register under the git common dir, which every worktree shares.
 */
export function registerRun(root: string): {
  others: string[];
  release: () => void;
} {
  const dir = join(gitCommonDir(root), "finish-verify-runs");
  mkdirSync(dir, { recursive: true });
  const others: string[] = [];
  for (const entry of readdirSync(dir)) {
    const pid = Number(basename(entry, ".json"));
    if (!Number.isInteger(pid) || pid === process.pid) continue;
    if (!pidAlive(pid)) {
      rmSync(join(dir, entry), { force: true });
      continue;
    }
    const worktree: unknown = JSON.parse(readFileSync(join(dir, entry), "utf-8"));
    others.push(`${String(worktree)} (pid ${String(pid)})`);
  }
  const mine = join(dir, `${String(process.pid)}.json`);
  writeFileSync(mine, JSON.stringify(basename(root)));
  return { others, release: () => rmSync(mine, { force: true }) };
}
