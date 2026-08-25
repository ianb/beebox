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
 * This is the I/O shell; the parsing, classification and aggregation it calls
 * are pure and live in test-ledger-lib.ts.
 *
 * See callback-box/docs/plans/change-based-test-selection.md, Track 5.
 */

import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { changedPaths, git, gitCommonDir, treeHash } from "./test-git.js";
import { buildGraph } from "./test-graph.js";
import { implicatedTests, isAccounted } from "./test-graph-query.js";
import { renderReport } from "./test-ledger-report.js";
import { acquire, lockDir, type Held, type Tier } from "./test-locks.js";
import {
  PACKAGE_ROOT,
  readCarefulList,
  taprcTestFiles,
  tierCommand,
  TierListError,
} from "./test-tiers.js";
import {
  classifyFailure,
  foldFilesets,
  hashFileset,
  isCompletedRun,
  ledgerPaths,
  parseTapFiles,
  summarize,
  type LedgerRecord,
} from "./test-ledger-lib.js";

/** A ledger operation that could not complete. Never reaches a caller's exit code. */
class LedgerRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerRecordError";
  }
}

class LedgerTimeoutError extends Error {
  constructor(ms: number) {
    super(`ledger bookkeeping exceeded ${ms}ms`);
    this.name = "LedgerTimeoutError";
  }
}

function readFilesets(path: string): Record<string, string[]> {
  if (!existsSync(path)) return {};
  try {
    return foldFilesets(readFileSync(path, "utf-8").split("\n"));
  } catch (e) {
    console.warn(`test-ledger: fileset log unreadable, starting fresh (${String(e)})`);
    return {};
  }
}

function isLedgerRecord(value: unknown): value is LedgerRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { commit?: unknown; ranFiles?: unknown; failures?: unknown };
  return (
    typeof record.commit === "string" &&
    typeof record.ranFiles === "string" &&
    Array.isArray(record.failures)
  );
}

export function readRecords(path: string): LedgerRecord[] {
  if (!existsSync(path)) return [];
  const records: LedgerRecord[] = [];
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed: unknown = JSON.parse(line);
      // Validated rather than cast: an interleaved append from a concurrent
      // worktree can leave a half-written line, and a bad shape would surface
      // far away as a wrong statistic.
      if (isLedgerRecord(parsed)) records.push(parsed);
    } catch (e) {
      // One malformed line must not blind the whole instrument.
      console.warn(`test-ledger: skipping malformed record (${String(e)})`);
    }
  }
  return records;
}

/** What the run is, beyond its argv: how to record it and what "changed" means. */
export interface RunContext {
  tier: Tier;
  mode: RunMode;
  /**
   * The ref `changed` is computed against, in place of `main`. The batched
   * full-suite schedule passes the commit it last tested, so `changed` is the
   * landed range — on `main`, `main...HEAD` is empty and `implicated` would
   * otherwise be nothing (plan revision 2026-08-25, mechanism D).
   */
  base: string | null;
  /** Recorded as {@link LedgerRecord.source}; null for an ordinary run. */
  source: string | null;
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

/**
 * A killed run must still give its slot back; the stale rules bound the damage
 * when it cannot (SIGKILL), but they take two hours to do it.
 */
function installSignalReleases(): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      releaseHeld(heldSlot);
      process.kill(process.pid, signal);
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
      record({
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

function signalNumber(signal: NodeJS.Signals): number {
  const known: Partial<Record<NodeJS.Signals, number>> = {
    SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGABRT: 6, SIGKILL: 9,
    SIGALRM: 14, SIGTERM: 15,
  };
  return known[signal] ?? 0;
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
    let output = "";
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.on("error", (error) => {
      resolve({ code: null, signal: null, output, spawnError: error });
    });
    child.on("close", (code, signal) => {
      resolve({ code, signal, output, spawnError: null });
    });
  });
}

interface GraphView {
  implicated: Set<string>;
  accounted: boolean;
}

function record(input: {
  tapOutput: string;
  changed: string[];
  exitCode: number;
  context: RunContext;
  /** Null when no slot could be taken, so the figure is unknown rather than zero. */
  concurrency: number | null;
  graph: GraphView | null;
}): void {
  const results = parseTapFiles(input.tapOutput);
  if (results.length === 0) throw new LedgerRecordError("TAP output named no test files");

  const paths = ledgerPaths(gitCommonDir());
  const changed = input.changed;
  const implicated = input.graph === null ? null : input.graph.implicated;
  const accounted = input.graph === null ? null : input.graph.accounted;

  const ranFiles = results.map((r) => r.file);
  const implicatedFiles = implicated === null ? [] : [...implicated].map(stripPackagePrefix);
  const implicatedForClass = implicated === null ? null : new Set(implicatedFiles);

  const record: LedgerRecord = {
    ts: new Date().toISOString(),
    commit: git(["rev-parse", "HEAD"]),
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    treeHash: treeHash(),
    mode: input.context.mode,
    ...(input.context.source === null ? {} : { source: input.context.source }),
    exitCode: input.exitCode,
    tier: input.context.tier,
    ...(input.concurrency === null ? {} : { concurrency: input.concurrency }),
    accounted,
    changed,
    ranFiles: hashFileset(ranFiles),
    implicated: hashFileset(implicatedFiles),
    durations: Object.fromEntries(results.map((r) => [r.file, r.ms])),
    failures: results
      .filter((r) => !r.ok)
      .map((r) => ({ file: r.file, class: classifyFailure({ file: r.file, implicated: implicatedForClass }) })),
  };

  appendLedgerRecord({ record, ranFiles, implicatedFiles, paths });
}

/**
 * Append one record plus the filesets it names.
 *
 * Exported because `bin/test-select.ts` writes its own record when the
 * selection is empty: there is no tap invocation to wrap, and a run that
 * tested nothing still has to be counted or the gap hides (plan revision
 * 2026-08-25, mechanism B).
 *
 * Append both, never rewrite: this directory is shared by every worktree on
 * the machine and concurrent suite runs are routine. Duplicate hashes are
 * harmless — the reader folds them into a map.
 */
export function appendLedgerRecord(input: {
  record: LedgerRecord;
  ranFiles: string[];
  implicatedFiles: string[];
  paths?: { ledger: string; filesets: string };
}): void {
  const paths = input.paths ?? ledgerPaths(gitCommonDir());
  const filesetLines = [
    { hash: input.record.ranFiles, files: [...input.ranFiles].sort() },
    { hash: input.record.implicated, files: [...input.implicatedFiles].sort() },
  ].map((entry) => `${JSON.stringify(entry)}\n`);
  appendFileSync(paths.filesets, filesetLines.join(""));
  appendFileSync(paths.ledger, `${JSON.stringify(input.record)}\n`);
}

/** Graph paths are repo-relative; TAP names them relative to callback-box. */
function stripPackagePrefix(path: string): string {
  return path.startsWith("callback-box/") ? path.slice("callback-box/".length) : path;
}

async function computeGraph(changed: string[]): Promise<GraphView | null> {
  try {
    const graph = await buildGraph();
    return {
      implicated: implicatedTests({ graph, changed }),
      accounted: isAccounted({ graph, changed }),
    };
  } catch (e) {
    console.warn(`test-ledger: graph unavailable, failures recorded as unknown (${String(e)})`);
    return null;
  }
}

/**
 * What the run was: everything `.taprc` includes, or a change-based selection.
 * `bin/test-select.ts --run` passes `--mode selected`; nothing else does.
 */
export type RunMode = LedgerRecord["mode"];

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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
