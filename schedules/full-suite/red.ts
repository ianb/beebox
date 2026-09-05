/**
 * What a red batch becomes: an environment alert, a deferral, or a triaged set
 * of verdicts with the blamable ones bisected, cone-checked, and filed.
 *
 * Split from run.ts for size only; run.ts decides when to call this, this
 * decides what a red run means.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync, readFileSync } from "node:fs";

import { execa } from "execa";

import { parseTapFiles } from "../../bin/test-ledger-lib.js";
import { buildGraph, cliBundleInputs } from "../../bin/test-graph.js";
import { spawnerEdges } from "../../bin/test-select-lib.js";
import type { TestGraph } from "../../bin/test-graph-query.js";
import { landingReachesFile, unbisectedFiles, type Batch } from "./attribution.js";
import {
  BISECT_MAX_FILES,
  bisect,
  environmentCluster,
  firstErrorLines,
  isEnvironmentFailure,
  issuePath,
  renderIssue,
  unstageIssueArgs,
  type Culprit,
  type Landing,
} from "./lib.js";
import { flakesAlertTitle, redAlertTitle, renderEnvironmentAlert, renderRedAlert } from "./alerts.js";
import { renderDeferredAlert } from "./trust.js";
import { landingsSince } from "./batch.js";
import { alertOnce } from "./reporting.js";
import { checkoutCommit, runFileAlone, type Checkout, type SuiteRun } from "./checkout.js";
import { REPO_ROOT, git, refuse } from "./repo.js";
import {
  newlyRedFiles,
  nextPendingAfterUntrusted,
  readKnownRed,
  readPending,
  writePending,
  type PendingEntry,
} from "./state.js";
import { groupCulprits, triage } from "./triage.js";

const DRY_RUN = process.env["SCHEDULE_DRY_RUN"] === "1";

/** This run's wall-clock per file, from both tiers' TAP output. */
export function currentDurations(runs: SuiteRun[]): Record<string, number> {
  const durations: Record<string, number> = {};
  for (const run of runs) {
    for (const result of parseTapFiles(run.output)) {
      durations[result.file] = Math.max(durations[result.file] ?? 0, result.ms);
    }
  }
  return durations;
}

/**
 * A red run the slowdown gate distrusts: no triage, no bisect, no issue. The
 * failures wait in the pending set, each remembering the base it first failed
 * after, so a later trusted run still bisects the full landing range.
 */
export async function deferRed(input: {
  batch: Batch;
  failures: string[];
  factor: number;
  samples: number;
}): Promise<void> {
  const pending = nextPendingAfterUntrusted({
    pending: await readPending(),
    failures: input.failures,
    base: input.batch.base ?? input.batch.pinned,
    now: new Date(),
  });
  await writePending(pending);
  const oldest = Object.values(pending).map((entry) => entry.firstSeen).toSorted()[0] ?? null;
  await alertOnce({
    kind: "deferred",
    files: input.failures,
    priority: "normal",
    title: `full suite: run under load (${input.factor.toFixed(1)}×); ${String(input.failures.length)} failure(s) deferred`,
    message: renderDeferredAlert({
      testedCommit: input.batch.pinned,
      factor: input.factor,
      samples: input.samples,
      failures: input.failures,
      pendingSince: oldest,
    }),
  });
}

// ─── reachability: can a landing have broken this file? ───────────────────

interface Reachability {
  graph: TestGraph;
  spawnEdges: Map<string, Set<string>>;
  cliBundleInputs: Set<string> | null;
}

/**
 * The graph is built from the main checkout's working tree, which this run
 * asserted is `main` — the pinned commit, up to a landing racing the run.
 * Built once, lazily: only a red batch with something to bisect pays for it.
 */
async function readReachability(): Promise<Reachability> {
  const graph = await buildGraph();
  const readFile = (repoRelative: string): string | null => {
    try {
      return readFileSync(path.join(REPO_ROOT, repoRelative), "utf-8");
    } catch (_e) {
      return null;
    }
  };
  let bundle: Set<string> | null = null;
  try {
    bundle = await cliBundleInputs();
  } catch (e) {
    // selectTests then fails open on the whole of `src/`.
    process.stdout.write(`full-suite: CLI bundle inputs unavailable (${String(e)}).\n`);
  }
  return { graph, spawnEdges: spawnerEdges({ graph, readFile }), cliBundleInputs: bundle };
}

// ─── bisect ───────────────────────────────────────────────────────────────

/**
 * The landing at which `file` starts failing, over first-parent landings only.
 *
 * A file that does not exist at a candidate commit counts as passing: the
 * search then converges on the landing that introduced it, which is the true
 * answer for a test that has never passed.
 */
async function blameLanding(input: {
  checkout: Checkout;
  file: string;
  landings: Landing[];
}): Promise<Landing> {
  const index = await bisect({
    count: input.landings.length,
    passesAt: async (at) => {
      const landing = input.landings[at];
      if (landing === undefined) return true;
      process.stdout.write(`\n--- bisect: ${input.file} at ${landing.commit.slice(0, 8)} ---\n`);
      await checkoutCommit({ checkout: input.checkout, commit: landing.commit });
      if (!existsSync(path.join(input.checkout.dir, "beebox", input.file))) return true;
      const result = await runFileAlone({ checkout: input.checkout, file: input.file });
      return result.exitCode === 0;
    },
  });
  const landing = input.landings[index];
  if (landing === undefined) refuse("bisect returned an index outside the landing list");
  return landing;
}

// ─── filing ───────────────────────────────────────────────────────────────

/** Whether the main checkout is in a state where an issue file can be committed. */
async function canCommitIssues(): Promise<string | null> {
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== "main") return `the main checkout is on '${branch}', not main`;
  return null;
}

async function fileIssues(input: { culprits: Culprit[]; batch: Batch }): Promise<{ written: string[]; blocked: string | null }> {
  // Nothing to blame, nothing to write. Guarded here as well as at the call
  // site because the commit below ends in `-- <paths>`, and a `git commit`
  // whose pathspec list is empty commits the INDEX — which in the main
  // checkout may be somebody's staged work.
  if (input.culprits.length === 0) return { written: [], blocked: null };
  const date = new Date().toISOString().slice(0, 10);
  const blocked = await canCommitIssues();
  const rendered = input.culprits.map((culprit) => ({
    path: issuePath({ date, landing: culprit.landing }),
    text: renderIssue({
      date,
      landing: culprit.landing,
      files: culprit.files,
      excerpt: culprit.excerpt,
      testedCommit: input.batch.pinned,
      baseCommit: input.batch.base ?? input.batch.pinned,
    }),
  }));
  if (blocked !== null || DRY_RUN) {
    for (const issue of rendered) process.stdout.write(`\n[full-suite] would write ${issue.path}:\n${issue.text}\n`);
    return { written: [], blocked: blocked ?? "dry run" };
  }
  for (const issue of rendered) await fs.writeFile(path.join(REPO_ROOT, issue.path), issue.text, "utf8");
  const paths = rendered.map((issue) => issue.path);
  const subject =
    input.culprits.length === 1
      ? `chore(issues): full-suite red after ${input.culprits[0]?.landing.commit.slice(0, 8) ?? ""}`
      : `chore(issues): full-suite red across ${String(input.culprits.length)} landings`;
  // `git add` first: these files are new, and a pathspec-scoped `git commit`
  // refuses a path git has never heard of. Path-scoped throughout (bin/
  // CLAUDE.md) so a commit here cannot sweep up somebody's staged work.
  const staged = await execa("git", ["-C", REPO_ROOT, "add", "--", ...paths], {
    reject: false,
    all: true,
  });
  if (staged.exitCode !== 0) {
    return { written: paths, blocked: `git add failed: ${(staged.all ?? "").slice(-500)}` };
  }
  const commit = await execa(
    "git",
    ["-C", REPO_ROOT, "commit", "-m", subject, "-m", "Filed by schedules/full-suite; the named workstream owns the fixup.", "--", ...paths],
    { reject: false, all: true },
  );
  if (commit.exitCode !== 0) {
    const unstaged = await execa("git", ["-C", REPO_ROOT, ...unstageIssueArgs(paths)], { reject: false, all: true });
    const removed = await Promise.allSettled(paths.map((reportPath) => fs.rm(path.join(REPO_ROOT, reportPath))));
    const cleanupFailure = unstaged.exitCode === 0 ? "" : `; unstage failed: ${(unstaged.all ?? "").slice(-500)}`;
    const removeFailure = removed.some((result) => result.status === "rejected") ? "; generated issue cleanup failed" : "";
    return { written: paths, blocked: `git commit failed: ${(commit.all ?? "").slice(-500)}${cleanupFailure}${removeFailure}` };
  }
  return { written: paths, blocked: null };
}

// ─── the trusted red path ─────────────────────────────────────────────────

export async function handleRed(input: {
  batch: Batch;
  checkout: Checkout;
  failures: string[];
  output: string;
  pending: Record<string, PendingEntry>;
}): Promise<string[] | null> {
  const { batch, failures, pending } = input;
  const firstErrors = firstErrorLines({ raw: input.output, files: failures });
  const cluster = environmentCluster({ failures, firstErrors });
  if (isEnvironmentFailure({ failures, firstErrors })) {
    await alertOnce({
      kind: "environment",
      files: failures,
      priority: "important",
      title: `full suite: ${String(failures.length)} files failed (environment)`,
      message: renderEnvironmentAlert({ testedCommit: batch.pinned, failures, cluster }),
    });
    return null;
  }

  const triaged = await triage({ checkout: input.checkout, failures });
  const known = await readKnownRed();
  const newReal = newlyRedFiles({ known, current: triaged.real });
  if (triaged.real.length === 0) {
    await alertOnce({
      kind: "flakes",
      files: triaged.flakes,
      priority: "normal",
      title: flakesAlertTitle(triaged.flakes),
      message: renderRedAlert({
        testedCommit: batch.pinned,
        baseCommit: batch.base,
        landings: batch.landings,
        culprits: [],
        flakes: triaged.flakes,
        unattributed: [],
      }),
    });
    return failures;
  }

  const bisectable = newReal.slice(0, BISECT_MAX_FILES);
  const knownAtBaseline = triaged.real.filter((file) => !newReal.includes(file));
  const overBudget = newReal.slice(BISECT_MAX_FILES);
  const unattributed = unbisectedFiles({ real: triaged.real, bisectable });
  const blamed: Array<{ file: string; landing: Landing }> = [];
  const outsideCone: string[] = [];
  const noRange: string[] = [];
  let reachability: Reachability | null = null;
  const changedByCommit = new Map<string, string[]>();
  const landingsByBase = new Map<string, Landing[]>([[batch.base ?? "", batch.landings]]);
  for (const file of bisectable) {
    // A file that first failed on an earlier, untrusted run bisects from the
    // base it failed after — the completion markers moved on in the meantime.
    const base = pending[file]?.base ?? batch.base ?? "";
    let landings = landingsByBase.get(base);
    if (landings === undefined) {
      landings = await landingsSince(base, batch.pinned);
      landingsByBase.set(base, landings);
    }
    if (landings.length === 0) {
      noRange.push(file);
      continue;
    }
    const landing = await blameLanding({ checkout: input.checkout, file, landings });
    let changed = changedByCommit.get(landing.commit);
    if (changed === undefined) {
      changed = (await git(["diff", "--name-only", `${landing.commit}^1`, landing.commit])).split("\n").filter(Boolean);
      changedByCommit.set(landing.commit, changed);
    }
    reachability ??= await readReachability();
    if (landingReachesFile({ ...reachability, changed, file })) blamed.push({ file, landing });
    else outsideCone.push(file);
  }
  const culprits = groupCulprits({ blamed, output: input.output });
  const filed = await fileIssues({ culprits, batch });
  // No landing range means no baseline to bisect against — the first run this
  // schedule ever makes, or one after the ledger was cleared. Red is still
  // reported; it just cannot be attributed to a landing.
  const inherited = newReal.length === 0;
  const attribution = culprits.length === 0
    ? inherited || outsideCone.length > 0
      ? "Red inherited from baseline; no attributable landing, nothing filed."
      : "No landing range to bisect: nothing attributed, nothing filed."
    : null;
  const unattributedReason = [
    ...(knownAtBaseline.length > 0 ? ["already red at baseline"] : []),
    ...(outsideCone.length > 0 ? ["the bisected landing cannot reach the file through the import graph"] : []),
    ...(overBudget.length > 0 ? [`over the ${String(BISECT_MAX_FILES)}-file budget`] : []),
    ...(noRange.length > 0 ? ["no landing range to search"] : []),
  ].join("; ");

  const message = [
    renderRedAlert({
      testedCommit: batch.pinned,
      baseCommit: batch.base,
      landings: batch.landings,
      culprits,
      flakes: triaged.flakes,
      unattributed: [...unattributed, ...outsideCone],
      ...(unattributedReason === "" ? {} : { unattributedReason }),
    }),
    attribution ??
      (filed.blocked === null
        ? `Filed: ${filed.written.join(", ")}`
        : `NOT filed (${filed.blocked}) — the issue text is in the run log.`),
  ].join("\n");
  await alertOnce({
    kind: culprits.length === 0 ? "red-unattributed" : "red-blamed",
    files: triaged.real,
    priority: "important",
    title: redAlertTitle({ real: triaged.real, culprits }),
    message,
  });
  return failures;
}
