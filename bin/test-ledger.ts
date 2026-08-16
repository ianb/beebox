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

import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph } from "./test-graph.js";
import { implicatedTests, isAccounted } from "./test-graph-query.js";
import { renderReport } from "./test-ledger-report.js";
import {
  classifyFailure,
  foldFilesets,
  hashFileset,
  isCompletedRun,
  ledgerPaths,
  parsePorcelainPaths,
  parseTapFiles,
  summarize,
  type LedgerRecord,
} from "./test-ledger-lib.js";

/**
 * Strips only the trailing newline, never leading whitespace: `git status
 * --porcelain` encodes status in the first two columns, and one of them is
 * routinely a space.
 */
const git = (args: string[]): string =>
  execFileSync("git", args, { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 }).replace(/\n$/, "");

function gitCommonDir(): string {
  return execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf-8",
  }).trim();
}

/**
 * `--untracked-files=all` is load-bearing in both callers below.
 *
 * Plain `git status --porcelain` collapses a wholly-untracked directory into a
 * single `?? dir/` entry. That breaks two different things: a new test
 * directory reads as one unaccounted path (so every test in it is invisible to
 * `implicated`, and the whole change reads as unaccounted), and — worse —
 * adding another file inside that directory does not change the status output,
 * so `treeHash` would call two genuinely different working states identical
 * and the flake derivation would compare across them.
 */
const porcelain = (): string => git(["status", "--porcelain", "-z", "--untracked-files=all"]);

/** Changed paths versus `main`, plus anything uncommitted. */
function changedPaths(): string[] {
  const committed = git(["diff", "--name-only", "main...HEAD"]).split("\n");
  const dirty = parsePorcelainPaths(porcelain());
  return [...new Set([...committed, ...dirty].filter((p) => p !== ""))].sort();
}

/** Identifies the exact working state, so a re-run with no edits is detectable. */
function treeHash(): string {
  return hashFileset([git(["rev-parse", "HEAD^{tree}"]), porcelain()]);
}

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

async function runWrapped(command: string[]): Promise<number> {
  const [executable, ...args] = command;
  if (executable === undefined) {
    console.error("test-ledger run: needs a command after --");
    return 2;
  }

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
      const changed = changedPaths();
      record({ tapOutput: output, changed, exitCode, graph: await computeGraph(changed) });
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
    mode: "full",
    exitCode: input.exitCode,
    accounted,
    changed,
    ranFiles: hashFileset(ranFiles),
    implicated: hashFileset(implicatedFiles),
    durations: Object.fromEntries(results.map((r) => [r.file, r.ms])),
    failures: results
      .filter((r) => !r.ok)
      .map((r) => ({ file: r.file, class: classifyFailure({ file: r.file, implicated: implicatedForClass }) })),
  };

  // Append both, never rewrite: this directory is shared by every worktree on
  // the machine and concurrent suite runs are routine. Duplicate hashes are
  // harmless — the reader folds them into a map.
  const filesetLines = [
    { hash: record.ranFiles, files: [...ranFiles].sort() },
    { hash: record.implicated, files: [...implicatedFiles].sort() },
  ].map((entry) => `${JSON.stringify(entry)}\n`);
  appendFileSync(paths.filesets, filesetLines.join(""));
  appendFileSync(paths.ledger, `${JSON.stringify(record)}\n`);
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

export async function main(argv: string[]): Promise<void> {
  const [subcommand, ...rest] = argv;
  if (subcommand === "run") {
    const sepIndex = rest.indexOf("--");
    const command = sepIndex === -1 ? rest : rest.slice(sepIndex + 1);
    process.exitCode = await runWrapped(command);
    return;
  }
  if (subcommand === "report") {
    renderReport();
    return;
  }
  console.error("usage: test-ledger run -- <command…> | test-ledger report");
  process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
