/**
 * finish-verify's process mechanics: each check runs in its own process group
 * so a signal can stop the whole tree under it, and each run registers itself
 * so a concurrent run on the shared dev router is named.
 */

import { spawn, type ChildProcess } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { constants } from "node:os";
import { basename, join } from "node:path";
import { gitCommonDir } from "./test-git.js";

class EmptyCommandError extends Error {
  constructor() {
    super("empty command");
    this.name = "EmptyCommandError";
  }
}

export interface RunOutput {
  status: number;
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
 */
export function run(input: {
  argv: string[];
  cwd: string;
}): Promise<RunOutput> {
  const [command, ...args] = input.argv;
  if (command === undefined) throw new EmptyCommandError();
  const child = spawn(command, args, {
    cwd: input.cwd,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  running.add(child);
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  return new Promise((resolve, reject) => {
    child.on("error", (error) => {
      running.delete(child);
      reject(error);
    });
    child.on("close", (status) => {
      running.delete(child);
      resolve({
        status: status ?? 1,
        text: `${Buffer.concat(stdout).toString()}${Buffer.concat(stderr).toString()}`,
      });
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
          if (!(e instanceof Error && "code" in e && e.code === "ESRCH"))
            throw e;
        }
      }
      onExit();
      console.error(
        `finish-verify: ${signal}; stopped ${String(running.size)} running check(s)`,
      );
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
    if (!isAlive(pid)) {
      rmSync(join(dir, entry), { force: true });
      continue;
    }
    const worktree: unknown = JSON.parse(
      readFileSync(join(dir, entry), "utf-8"),
    );
    others.push(`${String(worktree)} (pid ${String(pid)})`);
  }
  const mine = join(dir, `${String(process.pid)}.json`);
  writeFileSync(mine, JSON.stringify(basename(root)));
  return { others, release: () => rmSync(mine, { force: true }) };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the pid exists under another user, so it is alive.
    return e instanceof Error && "code" in e && e.code === "EPERM";
  }
}
