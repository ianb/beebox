/**
 * The batched full-suite run — mechanism D of the 2026-08-25 revision of
 * callback-box/docs/plans/change-based-test-selection.md.
 *
 * Iteration and `/finish` run only the tests a change implicates. This is the
 * one thing that runs everything, hourly, on `main`, and the one thing that
 * tests `main` at all. It does not fix anything: it bisects a red run down to
 * the landing that caused it and files an issue naming that landing's
 * workstream, which then owns the fixup.
 *
 * ## Where this runs, and why that matters
 *
 * `bin/schedules install` registers the launchd tick FROM THE MAIN CHECKOUT
 * ONLY, and the runner executes `run` with the main checkout as its cwd. So at
 * scheduled run time this script is in the main checkout, on `main`, and may
 * commit an issue file there. That is the assumption the issue-filing step is
 * written against, and it is checked rather than assumed: run from a linked
 * worktree (a `bin/schedules run full-suite --force` typed in the wrong place)
 * the script refuses before it does anything, because a Claude Code worktree
 * session is isolated from the main checkout and could not commit there even
 * if this tried. If the main checkout is on another branch or the commit is
 * refused, the issue text rides the alert instead of being written — nothing
 * is lost, and nothing is written where it would rot.
 *
 * The tests themselves never run in the main checkout (`.claude/agents/
 * finish.md`: "never run the suite in the main checkout"). `main` is pinned
 * once with `git rev-parse main` and everything runs in a DETACHED worktree of
 * that commit, so a landing that arrives mid-run is neither tested nor marked
 * tested — it is the next hour's work. The worktree is removed in a `finally`;
 * there is no `check` script because a run-only schedule's `check` is never
 * executed (`bin/lib/schedules-workstream.ts` runs it after a SESSION, and
 * this schedule declares no workstream).
 *
 * Tests need no box clone: `test/helpers/test-server.ts` scaffolds its own
 * throwaway box per process (`scaffoldV2Box`). A fresh worktree does need one
 * workspace-wide `pnpm install`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { readFileSync, existsSync } from "node:fs";

import { execa } from "execa";

import { gitCommonDir } from "../../bin/test-git.js";
import { appendLedgerRecord, readRecords } from "../../bin/test-ledger.js";
import { flakeShare, foldFilesets, hashFileset, ledgerPaths } from "../../bin/test-ledger-lib.js";
import {
  BISECT_MAX_FILES,
  FLAKE_WINDOW,
  LANDING_FIELD_SEPARATOR,
  LANDING_RECORD_SEPARATOR,
  TIERS,
  batchExit,
  bisect,
  classifyFailure,
  completionMarker,
  environmentCluster,
  failureExcerpt,
  firstErrorLines,
  isEnvironmentFailure,
  issuePath,
  lastTestedCommit,
  parseLandings,
  renderEnvironmentAlert,
  renderIssue,
  renderRedAlert,
  workstreamOf,
  type Culprit,
  type Landing,
} from "./lib.js";
import {
  createCheckout,
  checkoutCommit,
  failingFiles,
  removeCheckout,
  runFileAlone,
  runTier,
  type Checkout,
  type SuiteRun,
} from "./checkout.js";
import { REPO_ROOT, git, refuse } from "./repo.js";

const SCHEDULES_CLI = path.join(REPO_ROOT, "bin", "schedules");
const DRY_RUN = process.env["SCHEDULE_DRY_RUN"] === "1";

/** `bin/schedules alert|done`, which handle `SCHEDULE_DRY_RUN` themselves. */
async function report(args: string[]): Promise<void> {
  await execa(SCHEDULES_CLI, args, { stdout: "inherit", stderr: "inherit", reject: false });
}

async function alert(input: { title: string; message: string; priority: string }): Promise<void> {
  await report(["alert", "--priority", input.priority, "--title", input.title, "--message", input.message]);
}

// ─── where we are ─────────────────────────────────────────────────────────

/**
 * The main checkout, resolved the way `bin/land` resolves it: a linked worktree
 * and the main checkout share one git common dir, whose parent is the main
 * working tree.
 */
async function assertMainCheckout(): Promise<void> {
  const common = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const mainRoot = path.dirname(common);
  if (path.resolve(mainRoot) === path.resolve(REPO_ROOT)) return;
  if (DRY_RUN) {
    // The same exemption `refuseRunHere` gives a dry run: it reads the same
    // evidence, writes nothing, and rehearsing from a worktree is how this
    // schedule was written in the first place.
    process.stdout.write(`[full-suite] dry run from a worktree; a real run would refuse (main checkout: ${mainRoot}).\n`);
    return;
  }
  refuse(
    `this schedule must run from the main checkout (${mainRoot}), not ${REPO_ROOT}.\n` +
      "  The launchd tick does; a `bin/schedules run full-suite` typed inside a worktree does not,\n" +
      "  and only the main checkout can commit the issues a red batch files.",
  );
}

/** Whether the main checkout is in a state where an issue file can be committed. */
async function canCommitIssues(): Promise<string | null> {
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== "main") return `the main checkout is on '${branch}', not main`;
  return null;
}

// ─── the batch ────────────────────────────────────────────────────────────

interface Batch {
  pinned: string;
  base: string | null;
  landings: Landing[];
}

async function readBatch(): Promise<Batch> {
  const pinned = await git(["rev-parse", "main"]);
  const base = lastTestedCommit(readRecords(ledgerPaths(gitCommonDir(REPO_ROOT)).ledger));
  if (base === null) return { pinned, base: null, landings: [] };
  const format = `%H${LANDING_FIELD_SEPARATOR}%s${LANDING_RECORD_SEPARATOR}`;
  const raw = await git(["log", "--first-parent", "--reverse", `--format=${format}`, `${base}..${pinned}`]);
  return { pinned, base, landings: parseLandings(raw) };
}

// ─── bisect ───────────────────────────────────────────────────────────────

/**
 * The landing at which `file` starts failing, over first-parent landings only.
 *
 * A file that does not exist at a candidate commit counts as passing: the
 * search then converges on the landing that introduced it, which is the true
 * answer for a test that has never passed.
 */
async function blameLanding(input: { checkout: Checkout; file: string; landings: Landing[] }): Promise<Landing> {
  const index = await bisect({
    count: input.landings.length,
    passesAt: async (at) => {
      const landing = input.landings[at];
      if (landing === undefined) return true;
      process.stdout.write(`\n--- bisect: ${input.file} at ${landing.commit.slice(0, 8)} ---\n`);
      await checkoutCommit({ checkout: input.checkout, commit: landing.commit });
      if (!existsSync(path.join(input.checkout.dir, "callback-box", input.file))) return true;
      const result = await runFileAlone({ checkout: input.checkout, file: input.file });
      return result.exitCode === 0;
    },
  });
  const landing = input.landings[index];
  if (landing === undefined) refuse("bisect returned an index outside the landing list");
  return landing;
}

// ─── the red path ─────────────────────────────────────────────────────────

interface Triage {
  flakes: string[];
  real: string[];
}

/** Isolated re-run plus the ledger's own flake history, per the plan's order. */
async function triage(input: { checkout: Checkout; failures: string[] }): Promise<Triage> {
  const paths = ledgerPaths(gitCommonDir(REPO_ROOT));
  const records = readRecords(paths.ledger);
  const filesets = existsSync(paths.filesets)
    ? foldFilesets(readFileSync(paths.filesets, "utf-8").split("\n"))
    : {};
  const triaged: Triage = { flakes: [], real: [] };
  for (const file of input.failures) {
    process.stdout.write(`\n--- isolated re-run: ${file} ---\n`);
    const rerun = await runFileAlone({ checkout: input.checkout, file });
    process.stdout.write(rerun.output);
    const share = flakeShare({ records, filesets, file, window: FLAKE_WINDOW }).share;
    const verdict = classifyFailure({ isolatedPass: rerun.exitCode === 0, flakeShare: share });
    (verdict === "flake" ? triaged.flakes : triaged.real).push(file);
  }
  return triaged;
}

/** One issue per blamed landing, with every file that landing broke. */
function groupCulprits(input: { blamed: Array<{ file: string; landing: Landing }>; output: string }): Culprit[] {
  const byCommit = new Map<string, Culprit>();
  for (const { file, landing } of input.blamed) {
    const existing = byCommit.get(landing.commit);
    if (existing === undefined) {
      byCommit.set(landing.commit, {
        landing,
        files: [file],
        excerpt: failureExcerpt({ raw: input.output, file }),
      });
      continue;
    }
    existing.files.push(file);
    existing.excerpt = `${existing.excerpt}\n\n${failureExcerpt({ raw: input.output, file })}`;
  }
  return [...byCommit.values()];
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
    // The files are written but uncommitted in the main checkout. Say so — an
    // uncommitted issue in a tree the boxholder is working in is worse than a
    // loud alert about it.
    return { written: paths, blocked: `git commit failed: ${(commit.all ?? "").slice(-500)}` };
  }
  return { written: paths, blocked: null };
}

// ─── the completion marker ────────────────────────────────────────────────

/**
 * Record that this commit has been through EVERY tier — written last, after
 * the batch has been reported on, so a run that dies mid-bisect leaves its
 * range untested rather than tested-and-unfiled.
 */
async function markComplete(input: { batch: Batch; runs: SuiteRun[] }): Promise<void> {
  appendLedgerRecord({
    record: completionMarker({
      commit: input.batch.pinned,
      branch: "HEAD",
      treeHash: await git(["rev-parse", `${input.batch.pinned}^{tree}`]),
      exitCode: batchExit(input.runs.map((run) => run.exitCode)),
      tiers: [...TIERS],
      changed: [],
      emptyFileset: hashFileset([]),
    }),
    ranFiles: [],
    implicatedFiles: [],
    paths: ledgerPaths(gitCommonDir(REPO_ROOT)),
  });
}

// ─── the run ──────────────────────────────────────────────────────────────

async function handleRed(input: { batch: Batch; checkout: Checkout; failures: string[]; output: string }): Promise<void> {
  const { batch, failures } = input;
  const firstErrors = firstErrorLines({ raw: input.output, files: failures });
  const cluster = environmentCluster({ failures, firstErrors });
  if (isEnvironmentFailure({ failures, firstErrors })) {
    await alert({
      priority: "important",
      title: `full suite: ${String(failures.length)} files failed (environment)`,
      message: renderEnvironmentAlert({ testedCommit: batch.pinned, failures, cluster }),
    });
    return;
  }

  const triaged = await triage({ checkout: input.checkout, failures });
  if (triaged.real.length === 0) {
    await alert({
      priority: "normal",
      title: `full suite: ${String(triaged.flakes.length)} flake(s), nothing filed`,
      message: renderRedAlert({
        testedCommit: batch.pinned,
        baseCommit: batch.base,
        landings: batch.landings,
        culprits: [],
        flakes: triaged.flakes,
        unattributed: [],
      }),
    });
    return;
  }

  const bisectable = batch.landings.length > 0 ? triaged.real.slice(0, BISECT_MAX_FILES) : [];
  const unattributed = triaged.real.filter((file) => !bisectable.includes(file));
  const blamed: Array<{ file: string; landing: Landing }> = [];
  for (const file of bisectable) {
    blamed.push({ file, landing: await blameLanding({ checkout: input.checkout, file, landings: batch.landings }) });
  }
  const culprits = groupCulprits({ blamed, output: input.output });
  const filed = await fileIssues({ culprits, batch });
  // No landing range means no baseline to bisect against — the first run this
  // schedule ever makes, or one after the ledger was cleared. Red is still
  // reported; it just cannot be attributed to a landing.
  const attribution = culprits.length === 0 ? "No landing range to bisect: nothing attributed, nothing filed." : null;

  const message = [
    renderRedAlert({
      testedCommit: batch.pinned,
      baseCommit: batch.base,
      landings: batch.landings,
      culprits,
      flakes: triaged.flakes,
      unattributed,
      ...(attribution === null ? {} : { unattributedReason: "no landing range to search" }),
    }),
    attribution ??
      (filed.blocked === null
        ? `Filed: ${filed.written.join(", ")}`
        : `NOT filed (${filed.blocked}) — the issue text is in the run log.`),
  ].join("\n");
  await alert({
    priority: "important",
    title:
      culprits.length === 0
        ? `full suite red: ${String(triaged.real.length)} file(s), no landing range`
        : `full suite red: ${String(culprits.length)} landing(s) blamed`,
    message,
  });
}

async function main(): Promise<void> {
  await assertMainCheckout();
  const batch = await readBatch();

  if (batch.base !== null && batch.landings.length === 0) {
    process.stdout.write(`full-suite: nothing has landed since ${batch.base.slice(0, 8)}; skipping.\n`);
    await report(["done"]);
    return;
  }

  const summary =
    batch.base === null
      ? `full-suite: no previous run recorded; establishing a baseline at ${batch.pinned.slice(0, 8)}.`
      : `full-suite: ${String(batch.landings.length)} landing(s) since ${batch.base.slice(0, 8)}; testing ${batch.pinned.slice(0, 8)}.`;
  process.stdout.write(`${summary}\n`);
  for (const landing of batch.landings) {
    process.stdout.write(`  ${landing.commit.slice(0, 8)} ${landing.subject} [${workstreamOf(landing.subject) ?? "-"}]\n`);
  }

  if (DRY_RUN) {
    // A dry run rehearses the decision, never the suite: it creates no
    // worktree, writes no issue, and runs nothing that takes minutes.
    process.stdout.write("[full-suite] dry run: would create a detached worktree and run both tiers here.\n");
    await report(["done"]);
    return;
  }

  let checkout: Checkout | null = null;
  try {
    checkout = await createCheckout(batch.pinned);
    const base = batch.base ?? batch.pinned;
    const ordinary = await runTier({ checkout, tier: "ordinary", base });
    const careful = await runTier({ checkout, tier: "careful", base });
    const output = `${ordinary.output}\n${careful.output}`;
    const runs = [ordinary, careful];
    const failures = failingFiles(runs);
    if (failures.length === 0) {
      process.stdout.write("full-suite: green.\n");
      await markComplete({ batch, runs });
      await report(["done"]);
      return;
    }
    await handleRed({ batch, checkout, failures, output });
    await markComplete({ batch, runs });
  } finally {
    await removeCheckout(checkout);
  }
}

await main();
