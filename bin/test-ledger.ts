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

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph } from "./test-graph.js";
import { implicatedTests, isAccounted } from "./test-graph-query.js";
import {
  classifyFailure,
  hashFileset,
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

/** Changed paths versus `main`, plus anything uncommitted. */
function changedPaths(): string[] {
  const committed = git(["diff", "--name-only", "main...HEAD"]).split("\n");
  const dirty = parsePorcelainPaths(git(["status", "--porcelain"]));
  return [...new Set([...committed, ...dirty].filter((p) => p !== ""))].sort();
}

/** Identifies the exact working state, so a re-run with no edits is detectable. */
function treeHash(): string {
  return hashFileset([git(["rev-parse", "HEAD^{tree}"]), git(["status", "--porcelain"])]);
}

function readFilesets(path: string): Record<string, string[]> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, string[]>;
  } catch (e) {
    console.warn(`test-ledger: fileset manifest unreadable, starting fresh (${String(e)})`);
    return {};
  }
}

export function readRecords(path: string): LedgerRecord[] {
  if (!existsSync(path)) return [];
  const records: LedgerRecord[] = [];
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      records.push(JSON.parse(line) as LedgerRecord);
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

  const tmp = mkdtempSync(join(tmpdir(), "test-ledger-"));
  const tapOut = join(tmp, "tap.txt");
  // --output-file writes raw TAP to a file while the configured reporter still
  // prints to stdout, so .taprc's deliberate `reporter: tap` choice is intact.
  const child = spawnSync(executable, [...args, `--output-file=${tapOut}`], {
    stdio: "inherit",
  });
  const exitCode = child.status ?? 1;

  try {
    const changed = changedPaths();
    record({ tapOut, changed, graph: await computeGraph(changed) });
  } catch (e) {
    // The ledger gates nothing. A failure to record must never change the
    // outcome of the test run that was actually asked for.
    console.warn(`test-ledger: not recorded (${String(e)})`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return exitCode;
}

interface GraphView {
  implicated: Set<string>;
  accounted: boolean;
}

function record(input: { tapOut: string; changed: string[]; graph: GraphView | null }): void {
  if (!existsSync(input.tapOut)) throw new Error("no TAP output was captured");
  const results = parseTapFiles(readFileSync(input.tapOut, "utf-8"));
  if (results.length === 0) throw new Error("TAP output named no test files");

  const paths = ledgerPaths(gitCommonDir());
  const filesets = readFilesets(paths.filesets);
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
    accounted,
    changed,
    ranFiles: hashFileset(ranFiles),
    implicated: hashFileset(implicatedFiles),
    durations: Object.fromEntries(results.map((r) => [r.file, r.ms])),
    failures: results
      .filter((r) => !r.ok)
      .map((r) => ({ file: r.file, class: classifyFailure({ file: r.file, implicated: implicatedForClass }) })),
  };

  filesets[record.ranFiles] = [...ranFiles].sort();
  filesets[record.implicated] = [...implicatedFiles].sort();
  writeFileSync(paths.filesets, `${JSON.stringify(filesets, null, 0)}\n`);
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

function report(): void {
  const paths = ledgerPaths(gitCommonDir());
  const records = readRecords(paths.ledger);
  if (records.length === 0) {
    console.log("test-ledger: no runs recorded yet");
    return;
  }
  const filesets = readFilesets(paths.filesets);
  const stats = summarize({ records, filesets });

  const failing = [...stats.entries()].filter(([, s]) => s.failures > 0);
  failing.sort((a, b) => b[1].failures - a[1].failures);

  console.log(`runs recorded:   ${records.length}`);
  console.log(`files seen:      ${stats.size}`);
  console.log(`files ever failed: ${failing.length}`);
  console.log("");

  if (failing.length > 0) {
    console.log("file                                                  runs  fail  flake  unimplicated");
    for (const [file, s] of failing.slice(0, 40)) {
      console.log(
        `${file.padEnd(52).slice(0, 52)}  ${String(s.runs).padStart(4)}  ${String(s.failures).padStart(4)}  ` +
          `${String(s.flakes).padStart(5)}  ${String(s.unimplicatedFailures).padStart(12)}`,
      );
    }
    console.log("");
  }

  const unimplicated = failing.reduce((sum, [, s]) => sum + s.unimplicatedFailures, 0);
  console.log(`unimplicated failures: ${unimplicated}`);
  console.log(
    unimplicated === 0
      ? "  (no failure yet occurred in a test the graph did not point at)"
      : "  (failures the import graph did not point at — the number that decides selection)",
  );
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
    report();
    return;
  }
  console.error("usage: test-ledger run -- <command…> | test-ledger report");
  process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
