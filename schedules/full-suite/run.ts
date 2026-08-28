/**
 * Hourly full-suite run on pinned `main`; mechanism D of
 * callback-box/docs/plans/change-based-test-selection.md. It runs in a detached
 * worktree, triages red files, bisects only attributable landings, and files
 * issues from the main checkout. It refuses to run elsewhere, and always
 * removes the detached checkout in `finally`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";

import { execa } from "execa";
import { gitCommonDir } from "../../bin/test-git.js";
import { appendLedgerRecord, readRecords } from "../../bin/test-ledger.js";
import { hashFileset, ledgerPaths } from "../../bin/test-ledger-lib.js";
import { touchesDeployedPath } from "../../bin/deployed-paths.js";
import { attributableLanding, unbisectedFiles, type Batch } from "./attribution.js";
import {
  BISECT_MAX_FILES,
  LANDING_FIELD_SEPARATOR,
  LANDING_RECORD_SEPARATOR,
  TIERS,
  batchExit,
  bisect,
  completionMarker,
  environmentCluster,
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
import { newlyRedFiles, readKnownRed, writeKnownRed } from "./state.js";
import { groupCulprits, triage } from "./triage.js";

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

async function readBatch(): Promise<Batch> {
  const pinned = await git(["rev-parse", "main"]);
  const base = lastTestedCommit(readRecords(ledgerPaths(gitCommonDir(REPO_ROOT)).ledger));
  if (base === null) return { pinned, base: null, landings: [], attributableLandings: [] };
  const format = `%H${LANDING_FIELD_SEPARATOR}%s${LANDING_RECORD_SEPARATOR}`;
  const raw = await git(["log", "--first-parent", "--reverse", `--format=${format}`, `${base}..${pinned}`]);
  const landings = parseLandings(raw);
  const attributableLandings: Landing[] = [];
  for (const landing of landings) {
    const changed = (await git(["diff", "--name-only", `${landing.commit}^1`, landing.commit])).split("\n").filter(Boolean);
    if (touchesDeployedPath(changed)) attributableLandings.push(landing);
  }
  return { pinned, base, landings, attributableLandings };
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
  attributable: ReadonlySet<string>;
}): Promise<Landing | null> {
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
  return attributableLanding({ found: landing, attributableCommits: input.attributable });
}

// ─── the red path ─────────────────────────────────────────────────────────

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

async function handleRed(input: {
  batch: Batch;
  checkout: Checkout;
  failures: string[];
  output: string;
}): Promise<string[] | null> {
  const { batch, failures } = input;
  const firstErrors = firstErrorLines({ raw: input.output, files: failures });
  const cluster = environmentCluster({ failures, firstErrors });
  if (isEnvironmentFailure({ failures, firstErrors })) {
    await alert({
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
    return failures;
  }

  const bisectable = batch.landings.length > 0 ? newReal.slice(0, BISECT_MAX_FILES) : [];
  const knownAtBaseline = triaged.real.filter((file) => !newReal.includes(file));
  const overBudget = newReal.slice(BISECT_MAX_FILES);
  const unattributed = unbisectedFiles({ real: triaged.real, bisectable });
  const blamed: Array<{ file: string; landing: Landing }> = [];
  const noDeployedCulprit: string[] = [];
  const attributable = new Set(batch.attributableLandings.map((landing) => landing.commit));
  for (const file of bisectable) {
    const landing = await blameLanding({ checkout: input.checkout, file, landings: batch.landings, attributable });
    if (landing === null) noDeployedCulprit.push(file);
    else blamed.push({ file, landing });
  }
  const culprits = groupCulprits({ blamed, output: input.output });
  const filed = await fileIssues({ culprits, batch });
  // No landing range means no baseline to bisect against — the first run this
  // schedule ever makes, or one after the ledger was cleared. Red is still
  // reported; it just cannot be attributed to a landing.
  const inherited = newReal.length === 0;
  const attribution = culprits.length === 0
    ? inherited || noDeployedCulprit.length > 0
      ? "Red inherited from baseline; no attributable landing, nothing filed."
      : "No landing range to bisect: nothing attributed, nothing filed."
    : null;
  const unattributedReason = [
    ...(knownAtBaseline.length > 0 ? ["already red at baseline"] : []),
    ...(noDeployedCulprit.length > 0 ? ["bisect found a non-deployed-path landing"] : []),
    ...(overBudget.length > 0 ? [`over the ${String(BISECT_MAX_FILES)}-file budget`] : []),
    ...(batch.landings.length === 0 && newReal.length > 0 ? ["no landing range to search"] : []),
  ].join("; ");

  const message = [
    renderRedAlert({
      testedCommit: batch.pinned,
      baseCommit: batch.base,
      landings: batch.landings,
      culprits,
      flakes: triaged.flakes,
      unattributed: [...unattributed, ...noDeployedCulprit],
      ...(unattributedReason === "" ? {} : { unattributedReason }),
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
        ? `full suite red: ${String(triaged.real.length)} file(s), no attributable landing`
        : `full suite red: ${String(culprits.length)} landing(s) blamed`,
    message,
  });
  return failures;
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
      await writeKnownRed([]);
      await markComplete({ batch, runs });
      await report(["done"]);
      return;
    }
    const knownRed = await handleRed({ batch, checkout, failures, output });
    if (knownRed !== null) await writeKnownRed(knownRed);
    await markComplete({ batch, runs });
  } finally {
    await removeCheckout(checkout);
  }
}

await main();
