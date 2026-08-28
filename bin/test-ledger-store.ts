/**
 * The ledger's records: reading them back, building one from a finished run,
 * and appending it.
 *
 * Split out of test-ledger.ts, which keeps the process side (the semaphore, the
 * tap child, the CLI). Both halves are the same instrument — nothing here
 * branches on a record either.
 *
 * See callback-box/docs/plans/change-based-test-selection.md, Track 5.
 */

import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { git, gitCommonDir, treeHash } from "./test-git.js";
import { buildGraph } from "./test-graph.js";
import { implicatedTests, isAccounted } from "./test-graph-query.js";
import type { Tier } from "./test-locks.js";
import {
  classifyFailure,
  hashFileset,
  ledgerPaths,
  parseTapFiles,
  type LedgerRecord,
} from "./test-ledger-lib.js";

/** A ledger operation that could not complete. Never reaches a caller's exit code. */
export class LedgerRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerRecordError";
  }
}

/**
 * The wrapped command produced no per-file TAP records — a reporter that is no
 * longer raw TAP, or a command that is not tap at all.
 */
class NoTestFilesError extends LedgerRecordError {
  constructor() {
    super("TAP output named no test files");
    this.name = "NoTestFilesError";
  }
}

function isLedgerRecord(value: unknown): value is LedgerRecord {
  if (typeof value !== "object" || value === null) return false;
  if (!("commit" in value) || typeof value.commit !== "string") return false;
  if (!("ranFiles" in value) || typeof value.ranFiles !== "string") return false;
  return "failures" in value && Array.isArray(value.failures);
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

/**
 * What the run was: everything `.taprc` includes, or a change-based selection.
 * `bin/test-select.ts --run` passes `--mode selected`; nothing else does.
 */
export type RunMode = LedgerRecord["mode"];

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

export interface GraphView {
  implicated: Set<string>;
  accounted: boolean;
}

export function recordRun(input: {
  tapOutput: string;
  changed: string[];
  exitCode: number;
  context: RunContext;
  /** Null when no slot could be taken, so the figure is unknown rather than zero. */
  concurrency: number | null;
  graph: GraphView | null;
}): void {
  const results = parseTapFiles(input.tapOutput);
  if (results.length === 0) throw new NoTestFilesError();

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
    { hash: input.record.ranFiles, files: input.ranFiles.toSorted() },
    { hash: input.record.implicated, files: input.implicatedFiles.toSorted() },
  ].map((entry) => `${JSON.stringify(entry)}\n`);
  appendFileSync(paths.filesets, filesetLines.join(""));
  appendFileSync(paths.ledger, `${JSON.stringify(input.record)}\n`);
}

/** Graph paths are repo-relative; TAP names them relative to callback-box. */
function stripPackagePrefix(path: string): string {
  return path.startsWith("callback-box/") ? path.slice("callback-box/".length) : path;
}

export async function computeGraph(changed: string[]): Promise<GraphView | null> {
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
