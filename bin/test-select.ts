/**
 * Which tests this branch's change calls for, and optionally running them.
 *
 *   node --import tsx bin/test-select.ts            # one test path per line
 *   node --import tsx bin/test-select.ts --run      # run exactly those
 *   node --import tsx bin/test-select.ts --base <ref>
 *
 * `pnpm test:changed` in callback-box is the `--run` form, and it is the
 * agent's iteration command. `pnpm test` keeps its meaning: everything.
 *
 * This is the I/O shell — git, the esbuild graph pass, spawning tap. The rule
 * itself is pure and lives in test-select-lib.ts.
 *
 * An internal error exits non-zero, and every caller treats that as "run
 * `pnpm test`". An EMPTY selection is not an error: it exits 0 having run
 * nothing, because "no test imports the changed paths" is the honest
 * description of a change to untested code, and a full suite hides it rather
 * than fixing it. See callback-box/docs/plans/change-based-test-selection.md,
 * Track 2 and the 2026-08-25 revision (mechanism B).
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { changedPaths, git, treeHash } from "./test-git.js";
import { buildGraph, REPO_ROOT } from "./test-graph.js";
import { isAccounted } from "./test-graph-query.js";
import { hashFileset, type LedgerRecord } from "./test-ledger-lib.js";
import { appendLedgerRecord } from "./test-ledger.js";
import { alwaysRunTests, selectTests } from "./test-select-lib.js";

const PACKAGE_ROOT = join(REPO_ROOT, "callback-box");

/**
 * What a selection of nothing prints. The message is the honest statement; the
 * summary line exists because `.claude/agents/finish.md` parses one to decide a
 * merge may proceed, and green-with-a-stated-reason has to look like a result.
 */
export function emptyRunLines(): string[] {
  return ["no test imports the changed paths", "# { total: 0, pass: 0, selected: 0 }"];
}

/** Graph paths are repo-relative; tap names them relative to callback-box. */
function stripPackagePrefix(path: string): string {
  return path.startsWith("callback-box/") ? path.slice("callback-box/".length) : path;
}

function readRepoFile(repoRelative: string): string | null {
  try {
    return readFileSync(join(REPO_ROOT, repoRelative), "utf-8");
  } catch {
    return null;
  }
}

interface Args {
  base: string;
  run: boolean;
}

function parseArgs(argv: string[]): Args {
  const baseIndex = argv.indexOf("--base");
  const base = baseIndex === -1 ? "main" : argv[baseIndex + 1];
  if (base === undefined) throw new Error("--base needs a ref");
  return { base, run: argv.includes("--run") };
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
    commit: git(["rev-parse", "HEAD"]),
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
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
    [
      "--import",
      "tsx",
      join(REPO_ROOT, "bin/test-ledger.ts"),
      "run",
      "--tier",
      "ordinary",
      "--mode",
      "selected",
      "--",
      "tap",
      ...files,
    ],
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
  const graph = await buildGraph();
  const selection = selectTests({
    graph,
    changed,
    alwaysRun: alwaysRunTests({ graph, readFile: readRepoFile }),
  });
  const files = selection.selected.map(stripPackagePrefix);

  if (files.length === 0) {
    const [message, summary] = emptyRunLines();
    console.log(message);
    if (!args.run) return 0;
    try {
      recordEmptyRun({
        changed,
        implicated: selection.implicated.map(stripPackagePrefix),
        accounted: isAccounted({ graph, changed }),
      });
    } catch (e) {
      // The ledger gates nothing, here least of all.
      console.warn(`test-select: not recorded (${String(e)})`);
    }
    console.log(summary);
    return 0;
  }

  if (!args.run) {
    for (const file of files) console.log(file);
    return 0;
  }
  return runSelected(files);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    console.error(`test-select: ${String(e)}`);
    process.exitCode = 1;
  }
}
