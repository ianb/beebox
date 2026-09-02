/**
 * Hourly full-suite run on pinned `main`; mechanism D of
 * beebox/docs/plans/change-based-test-selection.md. It runs in a detached
 * worktree, triages red files, bisects only landings that can reach the
 * failing file through the import graph, and files issues from the main
 * checkout (red.ts). It refuses to run elsewhere, and always removes the
 * detached checkout in `finally`.
 *
 * Verdicts are load-gated (see trust.ts): the run waits a bounded time for
 * the host to go quiet before starting, and a run whose own durations show a
 * thrashed host defers its failures instead of triaging them — the false-red
 * postmortems of 2026-08-31 are the reason for both.
 */

import * as os from "node:os";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { gitCommonDir } from "../../bin/test-git.js";
import { appendLedgerRecord, readRecords } from "../../bin/test-ledger.js";
import { hashFileset, ledgerPaths } from "../../bin/test-ledger-lib.js";
import type { Batch } from "./attribution.js";
import { TIERS, batchExit, completionMarker, workstreamOf } from "./lib.js";
import { batchSlowdown, durationHistories, runIsUntrusted } from "./trust.js";
import { readBatch } from "./batch.js";
import { report } from "./reporting.js";
import { createCheckout, failingFiles, removeCheckout, runTier, type Checkout, type SuiteRun } from "./checkout.js";
import { REPO_ROOT, git, refuse } from "./repo.js";
import { readPending, writeKnownRed, writeLastAlert, writePending } from "./state.js";
import { currentDurations, deferRed, handleRed } from "./red.js";

const DRY_RUN = process.env["SCHEDULE_DRY_RUN"] === "1";

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

// ─── waiting out load ─────────────────────────────────────────────────────

/** Quiet: 1-minute load average at or under one runnable process per core. */
const QUIET_LOAD_PER_CORE = 1;
const QUIET_POLL_MS = 2 * 60 * 1000;
/** Bounded: the cadence is 1h and the suite itself is minutes, so waiting
 *  most of the hour would collide with the next tick. */
const QUIET_WAIT_BUDGET_MS = 40 * 60 * 1000;

/**
 * The tick fires on the hour whatever the host is doing; a run that starts
 * into a thrashed machine wastes the whole batch (its verdicts are withheld
 * anyway). Waiting is cheap and bounded — and if the host never goes quiet,
 * the run proceeds and the slowdown gate protects the verdicts.
 */
async function waitForQuietHost(): Promise<void> {
  const bar = os.availableParallelism() * QUIET_LOAD_PER_CORE;
  for (let waited = 0; ; waited += QUIET_POLL_MS) {
    const load = os.loadavg()[0] ?? 0;
    if (load <= bar) {
      if (waited > 0) process.stdout.write(`full-suite: host quiet after ${String(Math.round(waited / 60000))}m.\n`);
      return;
    }
    if (waited >= QUIET_WAIT_BUDGET_MS) {
      process.stdout.write(`full-suite: still loaded (load1 ${load.toFixed(1)} > ${String(bar)}) after the wait budget; running anyway.\n`);
      return;
    }
    process.stdout.write(`full-suite: load1 ${load.toFixed(1)} > ${String(bar)}; waiting for a quiet host.\n`);
    await delay(QUIET_POLL_MS);
  }
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

async function main(): Promise<void> {
  await assertMainCheckout();
  const batch = await readBatch();
  const pending = DRY_RUN ? {} : await readPending();

  // A quiet hour is a skip — unless failures are pending a trusted verdict,
  // which only a run can deliver.
  if (batch.base !== null && batch.landings.length === 0 && Object.keys(pending).length === 0) {
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

  // Duration history must predate this run's own tier records.
  const histories = durationHistories({ records: readRecords(ledgerPaths(gitCommonDir(REPO_ROOT)).ledger) });
  await waitForQuietHost();

  let checkout: Checkout | null = null;
  try {
    checkout = await createCheckout(batch.pinned);
    const base = batch.base ?? batch.pinned;
    const ordinary = await runTier({ checkout, tier: "ordinary", base });
    const careful = await runTier({ checkout, tier: "careful", base });
    const output = `${ordinary.output}\n${careful.output}`;
    const runs = [ordinary, careful];
    const failures = failingFiles(runs);
    // An untrusted run yields NO verdicts in either direction: red is
    // deferred, and green neither clears known-red/pending nor resets alert
    // suppression — a pass at 5× usual speed is as unmeasured as a failure.
    const slowdown = batchSlowdown({ current: currentDurations(runs), histories });
    if (runIsUntrusted(slowdown) && slowdown.factor !== null) {
      process.stdout.write(
        `full-suite: ran at ${slowdown.factor.toFixed(1)}× usual durations (${String(slowdown.samples)} files); withholding verdicts.\n`,
      );
      if (failures.length === 0) {
        process.stdout.write("full-suite: green under load; state untouched.\n");
        await markComplete({ batch, runs });
        await report(["done"]);
        return;
      }
      await deferRed({ batch, failures, factor: slowdown.factor, samples: slowdown.samples });
      await markComplete({ batch, runs });
      return;
    }
    if (failures.length === 0) {
      process.stdout.write("full-suite: green.\n");
      await writeKnownRed([]);
      await writePending({});
      await writeLastAlert(null);
      await markComplete({ batch, runs });
      await report(["done"]);
      return;
    }
    const knownRed = await handleRed({ batch, checkout, failures, output, pending });
    if (knownRed !== null) {
      await writeKnownRed(knownRed);
      // Every pending file got a trusted answer: confirmed files went through
      // triage/bisect, recovered ones are cleared by the pass. An environment
      // verdict (knownRed null) judged the machine, not the files — pending
      // stays.
      await writePending({});
    }
    await markComplete({ batch, runs });
  } finally {
    await removeCheckout(checkout);
  }
}

await main();
