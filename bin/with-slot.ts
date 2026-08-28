/**
 * Run a command holding one of the machine-wide slots the test semaphore owns.
 *
 *   node --import tsx bin/with-slot.ts [--tier ordinary|careful] -- <cmd…>
 *
 * The semaphore (bin/test-locks.ts) was built for test runs, but the pathology
 * it fixes is not specific to tests: six concurrent whole-tree eslint runs in
 * one worktree took 29–51 minutes each against a solo minute. Anything
 * whole-tree and CPU-hungry belongs behind it — `pnpm lint` and `pnpm
 * typecheck` in callback-box are wrapped with this. Changed-file runs
 * (`lint:changed`, lint-staged) are NOT: they are seconds long, and queueing
 * them behind a whole-tree run would cost more than the contention does.
 *
 * The ledger is not involved. This is the lock and nothing else.
 *
 * See issues/closed/code-quality/2026-08-25-lint-runs-contend-like-tests.md and
 * callback-box/docs/plans/change-based-test-selection.md, mechanism A.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { signalNumber, terminateChild } from "./child-signals.js";
import { git, gitCommonDir } from "./test-git.js";
import { acquire, lockDir, type Held, type Tier } from "./test-locks.js";

export interface Args {
  tier: Tier;
  command: string[];
}

/** Nothing after `--`, or no `--` at all: there is no command to run. */
export class MissingSeparatorError extends Error {
  constructor() {
    super("with-slot: needs `-- <command…>`");
    this.name = "MissingSeparatorError";
  }
}

export class MissingCommandError extends Error {
  constructor() {
    super("with-slot: needs a command after --");
    this.name = "MissingCommandError";
  }
}

export class EmptyCommandError extends Error {
  constructor() {
    super("with-slot: empty command");
    this.name = "EmptyCommandError";
  }
}

export class InvalidTierError extends Error {
  constructor(readonly tier: string | undefined) {
    super(`with-slot: --tier must be ordinary or careful, got ${String(tier)}`);
    this.name = "InvalidTierError";
  }
}

/** `--tier` before `--`; everything after `--` is the command, verbatim. */
export function parseArgs(argv: string[]): Args {
  const separator = argv.indexOf("--");
  if (separator === -1) throw new MissingSeparatorError();
  const flags = argv.slice(0, separator);
  const command = argv.slice(separator + 1);
  if (command.length === 0) throw new MissingCommandError();
  const tierIndex = flags.indexOf("--tier");
  if (tierIndex === -1) return { tier: "ordinary", command };
  const tier = flags[tierIndex + 1];
  if (tier !== "ordinary" && tier !== "careful") {
    throw new InvalidTierError(tier);
  }
  return { tier, command };
}

/** The one lock this process holds, so a signal handler can let it go. */
let heldSlot: Held | null = null;
/** The child, so a signal handler can pass the signal on and wait for it. */
let activeChild: ChildProcess | null = null;

function releaseHeld(held: Held | null): void {
  if (held === null) return;
  heldSlot = null;
  held.release();
}

/**
 * Fail-open, exactly as the ledger does: a lock directory that cannot be used
 * is not a reason to refuse to lint.
 */
async function holdSlot(tier: Tier): Promise<Held | null> {
  try {
    const held = await acquire({
      dir: lockDir(gitCommonDir()),
      tier,
      branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
      label: "with-slot",
    });
    heldSlot = held;
    return held;
  } catch (e) {
    console.warn(`with-slot: running without a slot (${String(e)})`);
    return null;
  }
}

/**
 * The child goes FIRST on a signal. Releasing the slot while it still runs
 * would hand the semaphore to a run that then contends with the very process
 * this signal is taking down.
 */
function installSignalReleases(): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void (async () => {
        if (activeChild !== null) await terminateChild({ child: activeChild, signal });
        releaseHeld(heldSlot);
        process.kill(process.pid, signal);
      })();
    });
  }
}

/** stdio inherited throughout: this wrapper reads nothing and rewrites nothing. */
function run(command: string[]): Promise<number> {
  const [executable, ...args] = command;
  if (executable === undefined) throw new EmptyCommandError();
  return new Promise((resolve) => {
    const child = spawn(executable, args, { stdio: "inherit" });
    activeChild = child;
    child.on("error", (error) => {
      activeChild = null;
      console.error(`with-slot: could not run ${executable}: ${error.message}`);
      resolve(127);
    });
    child.on("close", (code, signal) => {
      activeChild = null;
      resolve(signal !== null ? 128 + signalNumber(signal) : (code ?? 1));
    });
  });
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  installSignalReleases();
  const held = await holdSlot(args.tier);
  try {
    return await run(args.command);
  } finally {
    releaseHeld(held);
  }
}

if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 2;
    },
  );
}
