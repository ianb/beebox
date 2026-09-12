/**
 * A record of every test run, so that "which tests have ever failed in a way
 * that mattered" becomes answerable. Nothing branches on it — it is an
 * instrument, not a gate.
 *
 *   node --import tsx bin/test-ledger.ts run -- pnpm exec tap run …
 *   node --import tsx bin/test-ledger.ts report
 *
 * The ledger lives INSIDE `.git/` (via `git rev-parse --git-common-dir`):
 * never committed, in no diff, and the one directory every worktree on this
 * machine shares. Green runs are recorded too — they are the denominator that
 * turns failure counts into failure rates, and a denominator is free to
 * collect now and impossible to reconstruct later.
 *
 * This is the process shell — the semaphore, the tap child, the CLI. Building
 * and appending a record lives in test-ledger-store.ts; the parsing,
 * classification and aggregation both call are pure and live in
 * test-ledger-lib.ts.
 *
 * See beebox/docs/plans/change-based-test-selection.md, Track 5.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { signalNumber, terminateChild } from "./child-signals.js";
import { pressureDecision, readMemoryPressure } from "./host-pressure.js";
import { changedPaths, git, gitCommonDir } from "./test-git.js";
import { renderReport } from "./test-ledger-report.js";
import {
  computeGraph,
  recordRun,
  type RunContext,
  type RunMode,
} from "./test-ledger-store.js";
import { acquire, lockDir, type Held, type Tier } from "./test-locks.js";
import {
  PACKAGE_ROOT,
  readCarefulList,
  taprcTestFiles,
  tierCommand,
  TierListError,
} from "./test-tiers.js";

// `bin/test-select.ts`, `bin/test-ledger-report.ts`, and
// `schedules/full-suite/run.ts` reach the store through this module, which is
// the ledger's public name.
export { appendLedgerRecord, readRecords } from "./test-ledger-store.js";

class LedgerTimeoutError extends Error {
  constructor(ms: number) {
    super(`ledger bookkeeping exceeded ${ms}ms`);
    this.name = "LedgerTimeoutError";
  }
}

async function runWrapped(command: string[], context: RunContext): Promise<number> {
  const [executable, ...args] = command;
  if (executable === undefined) {
    console.error("test-ledger run: needs a command after --");
    return 2;
  }

  // The semaphore (plan revision 2026-08-25, mechanism A): concurrent suites
  // measurably slow each other down and turn each other red. Fail-open — a
  // lock directory that cannot be used is not a reason to refuse to test.
  const held = await holdSlot(context.tier);
  try {
    return await runUnderSlot({ executable, args, context, concurrency: held?.concurrency ?? null });
  } finally {
    releaseHeld(held);
  }
}

/** The one lock this process holds, so a signal handler can let it go. */
let heldSlot: Held | null = null;

function releaseHeld(held: Held | null): void {
  if (held === null) return;
  heldSlot = null;
  held.release();
}

async function holdSlot(tier: Tier): Promise<Held | null> {
  try {
    const held = await acquire({
      dir: lockDir(gitCommonDir()),
      tier,
      branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    });
    heldSlot = held;
    return held;
  } catch (e) {
    console.warn(`test-ledger: running without a slot (${String(e)})`);
    return null;
  }
}

/** The tap child, so a signal handler can pass the signal on and wait for it. */
let activeChild: ChildProcess | null = null;

/**
 * A killed run must still give its slot back; the stale rules bound the damage
 * when it cannot (SIGKILL), but they take two hours to do it.
 *
 * The child goes FIRST. Releasing the slot while tap is still running would
 * hand the semaphore to another suite that then contends with the very run
 * this signal is taking down — the slot is only free once the tests stop.
 * SIGINT from a terminal reaches the whole foreground group anyway; a SIGTERM
 * aimed at this wrapper alone reaches the child only because of this.
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

async function runUnderSlot(input: {
  executable: string;
  args: string[];
  context: RunContext;
  concurrency: number | null;
}): Promise<number> {
  const { executable, args } = input;

  // Tee stdout rather than using tap's `--output-file`.
  //
  // `--output-file` is the obvious seam and it is wrong here: with `.taprc`'s
  // `reporter: tap`, it makes tap print its summary TWICE on stdout —
  // including the `# { total: N, pass: N }` line that
  // `.claude/agents/finish.md` parses to decide whether a merge may proceed.
  // Measured: 2 occurrences on stdout against 1 in the file. An observational
  // instrument does not get to change what `pnpm test` prints.
  //
  // Streaming (not `spawnSync`) matters just as much: the suite takes minutes,
  // and buffering its output until exit would leave an agent watching a blank
  // terminal and then dump everything at once. Each chunk goes straight to
  // stdout as it arrives and is also accumulated for the parse.
  //
  // The parse relies on the reporter being raw TAP, which `.taprc:31-36` pins
  // with its own rationale — if that changes, the parse finds no file records,
  // the record is skipped with a warning, and the run is unaffected.
  const { code, signal, output, spawnError } = await streamCommand(executable, args);
  if (spawnError !== null) {
    // The command never started — say so plainly. Reporting this as "no TAP
    // output was captured" (which is what you get if you only check the exit
    // code) blames the ledger for the caller's PATH.
    console.error(`test-ledger: could not run ${executable}: ${spawnError.message}`);
    return 127;
  }
  // 128+signum is the shell convention for a signal death. Collapsing it to a
  // bare 1 would make a SIGALRM-killed suite indistinguishable from ordinary
  // test failures, and `.claude/agents/finish.md:198-202` requires the real
  // status to survive wrapping.
  const exitCode = signal !== null ? 128 + signalNumber(signal) : (code ?? 1);

  try {
    await withTimeout(LEDGER_BUDGET_MS, async () => {
      const base = input.context.base;
      const changed = changedPaths(base === null ? {} : { base });
      recordRun({
        tapOutput: output,
        changed,
        exitCode,
        context: input.context,
        concurrency: input.concurrency,
        graph: await computeGraph(changed),
      });
    });
  } catch (e) {
    // The ledger gates nothing, and that has to include liveness: the graph
    // build and the git calls run AFTER the suite has already finished, so a
    // hang here would stall a merge over bookkeeping. Budgeted and swallowed.
    console.warn(`test-ledger: not recorded (${String(e)})`);
  }
  return exitCode;
}

/** Ledger bookkeeping runs after the suite; it may never become the long pole. */
const LEDGER_BUDGET_MS = 60_000;

async function withTimeout(ms: number, fn: () => Promise<void>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new LedgerTimeoutError(ms)), ms);
    timer.unref();
  });
  try {
    await Promise.race([fn(), expiry]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

interface StreamResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
  spawnError: Error | null;
}

/** Run a command, passing its stdout through byte-for-byte while capturing it. */
function streamCommand(executable: string, args: string[]): Promise<StreamResult> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { stdio: ["inherit", "pipe", "inherit"] });
    activeChild = child;
    let output = "";
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.on("error", (error) => {
      activeChild = null;
      resolve({ code: null, signal: null, output, spawnError: error });
    });
    child.on("close", (code, signal) => {
      activeChild = null;
      resolve({ code, signal, output, spawnError: null });
    });
  });
}

/** Reads `--mode` from the wrapper's own flags; null on an unknown value. */
function parseMode(flags: string[]): RunMode | null {
  const index = flags.indexOf("--mode");
  if (index === -1) return "full";
  const value = flags[index + 1];
  return value === "full" || value === "selected" ? value : null;
}

/** Reads a `--flag value` pair from the wrapper's own flags; null when absent. */
function parseValue(flags: string[], name: string): string | null {
  const index = flags.indexOf(name);
  if (index === -1) return null;
  return flags[index + 1] ?? null;
}

/** Reads `--tier` from the wrapper's own flags; null on an unknown value. */
function parseTier(flags: string[]): Tier | null {
  const index = flags.indexOf("--tier");
  if (index === -1) return "ordinary";
  const value = flags[index + 1];
  return value === "ordinary" || value === "careful" ? value : null;
}

export async function main(argv: string[]): Promise<void> {
  const [subcommand, ...rest] = argv;
  if (subcommand === "run") {
    const sepIndex = rest.indexOf("--");
    const given = sepIndex === -1 ? rest : rest.slice(sepIndex + 1);
    const flags = sepIndex === -1 ? [] : rest.slice(0, sepIndex);
    const tier = parseTier(flags);
    if (tier === null) {
      console.error("test-ledger run: --tier takes ordinary or careful");
      process.exitCode = 2;
      return;
    }
    const mode = parseMode(flags);
    if (mode === null) {
      console.error("test-ledger run: --mode takes full or selected");
      process.exitCode = 2;
      return;
    }
    // The tier's file list is argv, not shell expansion (mechanism C): a list
    // that expands to nothing would leave a bare `tap` running everything.
    let command: string[];
    try {
      command = tierCommand({
        command: given,
        tier,
        taprcFiles: taprcTestFiles(PACKAGE_ROOT),
        careful: readCarefulList(),
      });
    } catch (e) {
      if (!(e instanceof TierListError)) throw e;
      console.error(`test-ledger: ${e.message}`);
      process.exitCode = 2;
      return;
    }
    // `--base` takes a ref rather than validating it here: an unresolvable ref
    // fails inside `git diff`, which names it, and the ledger's own failure is
    // a warning rather than a broken run.
    const base = parseValue(flags, "--base");
    if (flags.includes("--base") && (base === null || base === "")) {
      console.error("test-ledger run: --base takes a ref");
      process.exitCode = 2;
      return;
    }
    const source = parseValue(flags, "--source");
    if (flags.includes("--source") && (source === null || source === "")) {
      console.error("test-ledger run: --source takes a name");
      process.exitCode = 2;
      return;
    }
    // Before spawning tap at all: a full run under critical memory pressure
    // is a predetermined 300s-per-file timeout that teaches nothing (the
    // 2026-09-11 incident). Checked here rather than inside runWrapped so a
    // refusal acquires no slot and writes no ledger record.
    const pressure = readMemoryPressure();
    const decision = pressureDecision({ mode, level: pressure.level, ignoreLoad: process.env["BBX_TEST_IGNORE_LOAD"] === "1" });
    if (decision === "refuse") {
      console.error(
        "test-ledger: host is under critical memory pressure; a full run would time out at tap's 300s budget" +
          " and tell you nothing. Wait, close sessions, or set BBX_TEST_IGNORE_LOAD=1.",
      );
      process.exitCode = 1;
      return;
    }
    if (decision === "warn") {
      console.error(`test-ledger: host is under memory pressure (level ${String(pressure.level)}); timeouts in this run may be load, not code.`);
    }
    installSignalReleases();
    process.exitCode = await runWrapped(command, { tier, mode, base, source });
    return;
  }
  if (subcommand === "report") {
    renderReport();
    return;
  }
  console.error(
    "usage: test-ledger run [--tier ordinary|careful] [--mode full|selected]" +
      " [--base <ref>] [--source <name>] -- <command…> | test-ledger report",
  );
  process.exitCode = 2;
}

if (process.argv[1] === import.meta.filename) {
  await main(process.argv.slice(2));
}
