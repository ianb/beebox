/**
 * Which tests this branch's change calls for, and optionally running them.
 *
 *   node --import tsx bin/test-select.ts            # one test path per line
 *   node --import tsx bin/test-select.ts --run      # run exactly those
 *   node --import tsx bin/test-select.ts --why      # grouped by reason, with counts
 *   node --import tsx bin/test-select.ts --json     # { files, reasons }
 *   node --import tsx bin/test-select.ts --base <ref>
 *   node --import tsx bin/test-select.ts --no-cache  # rebuild the graph
 *
 * A reason is the changed path that reached a test (it imports the path, or
 * spawns a child that runs it), or a category: the test itself changed, or the
 * graph cannot resolve it. The list form prints the largest groups on stderr.
 *
 * `pnpm test:changed` in beebox is the `--run` form, and it is the
 * agent's iteration command. `pnpm test` keeps its meaning: everything.
 *
 * This is the I/O shell — git, the esbuild graph pass, spawning tap. The rule
 * itself is pure and lives in test-select-lib.ts.
 *
 * An internal error exits non-zero, and every caller treats that as "run
 * `pnpm test`". An EMPTY selection is not an error: it exits 0 having run
 * nothing, because "no test imports the changed paths" is the honest
 * description of a change to untested code, and a full suite hides it rather
 * than fixing it. See beebox/docs/plans/change-based-test-selection.md,
 * Track 2 and the 2026-08-25 revision (mechanism B).
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { estimateLines, estimateSeconds } from "./test-estimate.js";
import { binTsArgs } from "./lib/bin-ts.js";
import { git, gitBranch, gitCommonDir } from "./lib/git.js";
import { changedPaths, treeHash } from "./test-git.js";
import { buildGraph, cliBundleInputs, REPO_ROOT } from "./test-graph.js";
import { isAccounted } from "./test-graph-query.js";
import { hashFileset, ledgerPaths, packageRelative, type LedgerRecord } from "./test-ledger-lib.js";
import { appendLedgerRecord, readRecords } from "./test-ledger.js";
import { reasonSummary, selectTests, spawnerEdges } from "./test-select-lib.js";
import { carefulExclusions, taprcJobs } from "./test-tiers.js";

const PACKAGE_ROOT = join(REPO_ROOT, "beebox");

/**
 * What a selection of nothing prints. The message is the honest statement; the
 * summary line exists because `.claude/agents/finish.md` parses one to decide a
 * merge may proceed, and green-with-a-stated-reason has to look like a result.
 */
export function emptyRunLines(): string[] {
  return ["no test imports the changed paths", "# { total: 0, pass: 0, selected: 0 }"];
}

function readRepoFile(repoRelative: string): string | null {
  try {
    return readFileSync(join(REPO_ROOT, repoRelative), "utf-8");
  } catch (_e) {
    // A graph path can name a file that is gone from the working tree (deleted
    // in the branch, or listed by a cache built before the delete). Absent
    // content is the answer the caller wants, not a failure.
    return null;
  }
}

/** Null on failure: `selectTests` then fails open on the whole of `src/`. */
async function readCliBundleInputs(): Promise<Set<string> | null> {
  try {
    return await cliBundleInputs();
  } catch (e) {
    console.warn(`test-select: CLI bundle inputs unavailable (${String(e)})`);
    return null;
  }
}

interface Args {
  base: string;
  /** How a selection is reported: one path per line, by reason, JSON, or run. */
  mode: "list" | "why" | "json" | "run";
  cache: boolean;
}

/** `--base` was given as the last argument, with no ref after it. */
class MissingBaseRefError extends Error {
  constructor() {
    super("--base needs a ref");
    this.name = "MissingBaseRefError";
  }
}

/** More than one of `--run`, `--why`, `--json`. */
class ConflictingModesError extends Error {
  constructor(modes: string[]) {
    super(`pick one of ${modes.join(", ")}`);
    this.name = "ConflictingModesError";
  }
}

function parseArgs(argv: string[]): Args {
  const baseIndex = argv.indexOf("--base");
  const base = baseIndex === -1 ? "main" : argv[baseIndex + 1];
  if (base === undefined) throw new MissingBaseRefError();
  const modes = (["run", "why", "json"] as const).filter((mode) => argv.includes(`--${mode}`));
  if (modes.length > 1) throw new ConflictingModesError(modes.map((mode) => `--${mode}`));
  return { base, mode: modes[0] ?? "list", cache: !argv.includes("--no-cache") };
}

/** `--why`: each reason with its count, then its tests. */
export function whyLines(reasons: { reason: string; tests: string[] }[]): string[] {
  return reasons.flatMap((group) => [
    `${String(group.tests.length).padStart(5)}  ${group.reason}`,
    ...group.tests.map((test) => `         ${packageRelative(test)}`),
  ]);
}

/**
 * The file count and estimated time, printed before a non-empty selection is
 * listed or run. The ledger gates nothing: if it cannot be read, the line
 * gives the count alone.
 */
function selectionEstimate(files: string[]): string[] {
  const jobs = taprcJobs(PACKAGE_ROOT) ?? availableParallelism();
  let seconds: number | null = null;
  try {
    const records = readRecords(ledgerPaths(gitCommonDir()).ledger);
    seconds = estimateSeconds({ files, records, jobs, now: new Date() });
  } catch (e) {
    console.warn(`test-select: no estimate (${String(e)})`);
  }
  return estimateLines({ count: files.length, seconds, jobs });
}

/**
 * The record for a run that invoked no tap at all.
 *
 * Written here rather than by the wrapper because there is no TAP output to
 * parse — `bin/test-ledger.ts` would (correctly) refuse it. Counting the gap
 * is the point: a selected run that ran nothing is exactly the observation the
 * ledger exists to accumulate.
 */
function recordEmptyRun(input: {
  changed: string[];
  implicated: string[];
  accounted: boolean | null;
}): void {
  const record: LedgerRecord = {
    ts: new Date().toISOString(),
    commit: git(["rev-parse", "HEAD"], { onError: "throw" }),
    branch: gitBranch(),
    treeHash: treeHash(),
    mode: "selected",
    exitCode: 0,
    tier: "ordinary",
    accounted: input.accounted,
    changed: input.changed,
    ranFiles: hashFileset([]),
    implicated: hashFileset(input.implicated),
    durations: {},
    failures: [],
  };
  appendLedgerRecord({ record, ranFiles: [], implicatedFiles: input.implicated });
}

/**
 * Hand the files to the ordinary wrapper, so a selected run takes a semaphore
 * slot and lands in the ledger exactly like a full one — only its `mode` says
 * otherwise.
 */
function runSelected(files: string[]): number {
  const binDir = join(REPO_ROOT, "node_modules/.bin");
  const result = spawnSync(
    process.execPath,
    binTsArgs("bin/test-ledger.ts", ["run", "--tier", "ordinary", "--mode", "selected", "--", "tap", ...files]),
    {
      cwd: PACKAGE_ROOT,
      stdio: "inherit",
      // `tap` comes from the workspace bin dir. A pnpm script would put it on
      // PATH already; a direct `node bin/test-select.ts --run` would not.
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
    },
  );
  if (result.error !== undefined) throw result.error;
  return result.status ?? 1;
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  // Before the graph: a bad base ref should cost a git call, not an esbuild
  // pass over every entrypoint.
  const changed = changedPaths({ base: args.base });
  const graph = await buildGraph({ cache: args.cache });
  const selection = selectTests({
    graph,
    changed,
    spawnEdges: spawnerEdges({ graph, readFile: readRepoFile }),
    cliBundleInputs: await readCliBundleInputs(),
    // The careful tier runs alone in the batched run (mechanism C). A changed
    // careful test still runs — selectTests keeps what the branch touched.
    exclude: carefulExclusions(),
  });
  const files = selection.selected.map(packageRelative);

  if (args.mode === "json") {
    const reasons = selection.reasons.map((group) => ({ ...group, tests: group.tests.map(packageRelative) }));
    console.log(JSON.stringify({ files, reasons }, null, 2));
    return 0;
  }
  if (files.length === 0) {
    const [message, summary] = emptyRunLines();
    console.log(message);
    if (args.mode !== "run") return 0;
    try {
      recordEmptyRun({
        changed,
        implicated: selection.implicated.map(packageRelative),
        accounted: isAccounted({ graph, changed }),
      });
    } catch (e) {
      // The ledger gates nothing, here least of all.
      console.warn(`test-select: not recorded (${String(e)})`);
    }
    console.log(summary);
    return 0;
  }

  const estimate = [...selectionEstimate(files), `test-select: by reason: ${reasonSummary(selection.reasons, 3)}`];
  if (args.mode === "why") {
    for (const line of estimate) console.error(line);
    for (const line of whyLines(selection.reasons)) console.log(line);
    return 0;
  }
  if (args.mode === "list") {
    // stderr: stdout stays one path per line for scripts that read it.
    for (const line of estimate) console.error(line);
    for (const file of files) console.log(file);
    return 0;
  }
  for (const line of estimate) console.log(line);
  return runSelected(files);
}

if (process.argv[1] === import.meta.filename) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    console.error(`test-select: ${String(e)}`);
    process.exitCode = 1;
  }
}
