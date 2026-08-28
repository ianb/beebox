/**
 * The smoke tier: boot a real box and walk it, so a landing that typechecks,
 * lints and passes its selected tests still has to prove the app runs.
 *
 * Three escapes on 2026-08-25/26 passed every other gate because the code was
 * right and the *state* was wrong — a server that 404s page navigations, a
 * place menu killed by broken global Codex state, a chat turn that crashed on
 * an unknown SDK item. Only a real box on the real machine shows those. See
 * issues/exploration/2026-08-26-merge-time-smoke-tier.md and
 * issues/exploration/2026-08-26-post-test-economics-retro.md.
 *
 *   bin/smoke                 # walk this worktree's box through the dev router
 *   bin/smoke --box <slug>    # a box other than test1
 *   bin/smoke --no-restart    # skip the cold start (debugging the walk itself)
 *   bin/smoke --report        # what each step has caught, and what it costs
 *
 * Proving the tier can still go red means breaking something on purpose. Say so
 * when you do:
 *
 *   CB_SMOKE_FAULT_INJECTION="hub throws at import" bin/smoke
 *
 * That reason is stamped on the run, and every count in `--report` and in the
 * weekly review excludes it. Without it a manufactured red is indistinguishable
 * from one the tier caught, and the first weekly review duly read one as a real
 * intermittent worth watching.
 *
 * Every run appends to a shared log beside the test ledger, and `--report`
 * folds it into per-step counts. That exists to be acted on: a step that has
 * never caught anything is paying rent out of a two-minute budget, and the
 * report is what says so.
 *
 * It restarts the checkout's dev-server generation first, on purpose: the
 * router runs TypeScript straight off disk and nothing reloads it
 * (bin/router-lifecycle.ts), so without a restart this would test whatever
 * source was on disk whenever the generation happened to start. That restart is
 * also the floor the tier exists for — a server that cannot boot fails here.
 *
 * Deliberately model-free: no agent turns, nothing that spends tokens or waits
 * on a model. Budget is a hard wall-clock kill, not a target.
 */

import { BrowseSession } from "../callback-box/test/tours/tour-lib/browse.js";
import { VIEWPORTS } from "../callback-box/test/tours/tour-lib/types.js";
import { invariant } from "../callback-box/src/lib/invariant.js";
import {
  BrowseListEmptyError,
  CardContentMissingError,
  CardRefUnresolvedError,
  CardViewMissingError,
  ChatShellMissingError,
  LandmarkRefUnresolvedError,
  NoCardToOpenError,
  NoLandmarkToSwitchToError,
  PageErrorsRaisedError,
  SmokeFailureError,
  StaleGenerationError,
} from "./smoke-errors.js";
import {
  BUDGET_MS,
  Budget,
  faultInjection,
  generationAge,
  git,
  parseArgs,
  record,
  report,
  restartGeneration,
  routerPort,
  browseKey,
  waitForBox,
  worktreeName,
  type Options,
} from "./smoke-harness.js";
import { isFreshGeneration } from "./smoke-probe.js";
import type { SmokeStepRecord } from "./smoke-lib.js";
import {
  cardViewRendered,
  currentPlaceLabel,
  directoryRowCount,
  firstCardRow,
  hasDomId,
  placeMenuFailure,
  placeSwitchFailure,
  readPlaceMenu,
  refFor,
  switchTarget,
} from "./smoke-snapshot.js";

interface Step {
  /**
   * Stable across rewordings — the run log is keyed by this, so a renamed step
   * keeps its history instead of looking like a new one with no data.
   */
  id: string;
  name: string;
  run: () => Promise<void>;
}

function buildSteps(input: {
  baseUrl: string;
  key: string | null;
  worktree: string;
  budget: Budget;
  session: BrowseSession;
  options: Options;
}): Step[] {
  const { baseUrl, key, worktree, budget, session, options } = input;
  const steps: Step[] = [];

  // Recorded by the restart step and read by the cold-start step, which is how
  // the second one proves the generation answering it is not the one the first
  // replaced. `undefined` means the restart step did not run.
  let replaced: { before: number | null } | undefined;

  if (options.restart) {
    steps.push({
      id: "restart",
      name: "restart the dev-server generation",
      run: async () => {
        // A browser tab left open from an earlier walk keeps issuing HTTP, and
        // every request lazy-starts the worktree again — so the browser goes
        // away before the teardown, not after it.
        await session.close();
        replaced = { before: await restartGeneration(worktree, budget) };
      },
    });
  }

  steps.push({
    id: "cold-start",
    name: "the box's backend answers after a cold start",
    run: async () => {
      await waitForBox({ url: `${baseUrl}/api/health`, key, budget });
      if (replaced === undefined) return;
      const now = await generationAge(worktree);
      if (!isFreshGeneration({ before: replaced.before, now })) {
        throw new StaleGenerationError({ before: replaced.before, now });
      }
    },
  });

  steps.push({
    id: "chat-shell",
    name: "the chat page renders its shell",
    run: async () => {
      // The first real navigation after `restart`'s session.close() launches a
      // fresh Chrome window at whatever size the browser defaults to, which is
      // narrower than this app's desktop breakpoint — every step below reads
      // the composer and app bar as they render on desktop. about:blank first,
      // same as tour-lib's own runner, so the viewport applies before anything
      // real ever paints.
      const desktopViewport = VIEWPORTS.find((v) => v.name === "desktop");
      invariant(desktopViewport !== undefined, "tour-lib dropped its desktop viewport spec");
      await session.open("about:blank", { noWait: true });
      await session.setViewport(desktopViewport.width, desktopViewport.height);

      await session.open(`${baseUrl}/chat`);
      const snapshot = await session.snapshot({ interactiveOnly: true });
      if (!hasDomId(snapshot, "cb-composer-input") || !hasDomId(snapshot, "cb-nav-place")) {
        throw new ChatShellMissingError(snapshot);
      }
    },
  });

  steps.push({
    id: "place-menu",
    name: "the place menu opens and lists landmarks",
    run: async () => {
      // The click's exit status means nothing — agent-browser dispatches a
      // mouse event at the box centre and reports success either way — so the
      // assertion is on the consequence, never on the click.
      await session.run(["click", "#cb-nav-place"]);
      // The FULL tree, not the interactive one: landmark rows are separated
      // from the nav-card rows above them only by a `StaticText "Switch to"`
      // section header, and interactive-only snapshots drop static text — so
      // there is no way to tell a landmark from a route in that view.
      const snapshot = await session.snapshot();
      const failure = placeMenuFailure(readPlaceMenu(snapshot), snapshot);
      if (failure !== null) throw failure;
    },
  });

  steps.push({
    id: "place-switch",
    name: "selecting a landmark moves you there",
    // The menu listing landmarks is the affordance; going somewhere is what the
    // affordance is FOR, and that is where the 2026-08-20 bug lived — the menu
    // listed all seven landmarks, reported no problems, and selecting one did
    // not move you. Every assertion the step above makes would have passed.
    run: async () => {
      // Re-read rather than reuse the previous step's snapshot: the menu starts
      // its landmark and recent-file queries when it opens, and a row arriving
      // late renumbers the refs. A stale `eN` clicks nothing, and the click
      // itself reports success either way — so the saving was buying a
      // mysterious red on a healthy box.
      const before = await session.snapshot();
      const current = currentPlaceLabel(before);
      const target = switchTarget({ landmarks: readPlaceMenu(before).landmarks, current });
      if (target === null) {
        throw new NoLandmarkToSwitchToError({ current, snapshot: before });
      }
      const ref = refFor(before, { role: "menuitem", name: target.rawName });
      if (ref === null) {
        throw new LandmarkRefUnresolvedError({ name: target.rawName, snapshot: before });
      }
      const urlBefore = await session.getUrl();
      await session.clickRef(ref);
      // Client-side navigation: nothing loads, so wait for the app to settle
      // rather than for a page load that will not happen. A timed-out wait is
      // not fatal on its own — the assertions below decide — but it changes
      // what a failure MEANS, so it is carried into the message.
      const settled = await session.waitForReady();
      const after = await session.snapshot();
      const failure = placeSwitchFailure({
        target: target.label,
        targetRaw: target.rawName,
        urlBefore,
        urlAfter: await session.getUrl(),
        labelAfter: currentPlaceLabel(after),
        settled,
        snapshot: after,
      });
      if (failure !== null) throw failure;
    },
  });

  steps.push({
    id: "browse-list",
    name: "browse lists the box's real content",
    run: async () => {
      await session.open(`${baseUrl}/browse`);
      const snapshot = await session.snapshot({ interactiveOnly: true });
      if (!hasDomId(snapshot, "cb-browse-crumb-root") || directoryRowCount(snapshot) === 0) {
        throw new BrowseListEmptyError(snapshot);
      }
    },
  });

  steps.push({
    id: "card-open",
    name: "a card opens and renders",
    run: async () => {
      const listing = await session.snapshot({ interactiveOnly: true });
      const row = firstCardRow(listing);
      if (row === null) {
        throw new NoCardToOpenError(listing);
      }
      const ref = refFor(listing, row);
      if (ref === null) {
        throw new CardRefUnresolvedError({ role: row.role, name: row.name, listing });
      }
      await session.clickRef(ref);
      const snapshot = await session.snapshot({ interactiveOnly: true });
      const url = await session.getUrl();
      if (!url.includes("/browse/") || !hasDomId(snapshot, "cb-browse-open-card")) {
        throw new CardViewMissingError({ name: row.name, url, snapshot });
      }
      if (!cardViewRendered(snapshot)) {
        throw new CardContentMissingError({ name: row.name, snapshot });
      }
    },
  });

  steps.push({
    id: "page-errors",
    name: "the walk raised no uncaught page errors",
    run: async () => {
      const { stdout } = await session.run(["errors"]);
      if (stdout.trim() !== "") {
        throw new PageErrorsRaisedError(stdout.trim());
      }
    },
  });

  return steps;
}

export async function main(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  if (options.report) return report();
  const worktree = worktreeName();
  const baseUrl = `http://localhost:${routerPort()}/${worktree}/${options.box}`;
  const key = browseKey();
  const budget = new Budget(BUDGET_MS);
  const session = new BrowseSession("smoke");
  const startedAt = Date.now();

  // Last resort. `race` above fails the step, but a spawned `bin/browse` that
  // never exits keeps the event loop alive and this process with it — so the
  // deadline is also enforced by leaving. `unref` so a normal run is not held
  // open by the timer itself.
  const killer = setTimeout(() => {
    process.stdout.write(
      `\nFAIL smoke exceeded its ${String(BUDGET_MS / 1000)}s budget and was killed\n\nSMOKE: red\n`,
    );
    process.exit(1);
  }, BUDGET_MS + 5_000);
  killer.unref();

  process.stdout.write(`smoke: ${baseUrl}\n`);
  if (faultInjection() !== null) {
    // Loud, because the whole point is that this run must not be mistaken for a
    // real one — by a reader now or by the weekly review later.
    process.stdout.write(
      `smoke: FAULT INJECTION DECLARED — "${faultInjection() ?? ""}".` +
        " This run is excluded from every count in --report.\n",
    );
  }
  // Page errors accumulate per session; clear first so the last step reports
  // this walk's errors rather than whatever an earlier browse left behind.
  await session.run(["errors", "--clear"]).catch(() => {
    // No live session yet — there is nothing to clear, and `open` starts one.
  });

  const steps = buildSteps({ baseUrl, key, worktree, budget, session, options });
  // Seeded with every step as `not-run`, so a walk that stops early still
  // records what it never reached rather than leaving those rows absent.
  const outcomes = new Map<string, SmokeStepRecord>(
    steps.map((step) => [step.id, { id: step.id, outcome: "not-run", ms: 0 }]),
  );
  const injected = faultInjection();
  const finish = (verdict: "green" | "red", failure?: { step: string; message: string }): void => {
    record({
      ts: new Date().toISOString(),
      commit: git(["rev-parse", "HEAD"]),
      branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
      worktree,
      box: options.box,
      verdict,
      ms: Date.now() - startedAt,
      ...(failure === undefined
        ? {}
        : { failedStep: failure.step, failure: failure.message.split("\n")[0] ?? "" }),
      ...(injected === null ? {} : { faultInjected: injected }),
      steps: [...outcomes.values()],
    });
  };

  for (const step of steps) {
    budget.check(step.name);
    const at = Date.now();
    try {
      await budget.race(step.name, step.run());
    } catch (e) {
      outcomes.set(step.id, { id: step.id, outcome: "fail", ms: Date.now() - at });
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      process.stdout.write(`FAIL ${step.name} (${elapsed}s)\n`);
      const failure =
        e instanceof SmokeFailureError
          ? e
          : new SmokeFailureError(e instanceof Error ? e.message : String(e));
      process.stdout.write(`\n  ${failure.message}\n`);
      if (failure.detail !== "") {
        process.stdout.write(`\n${indent(failure.detail)}\n`);
      }
      finish("red", { step: step.id, message: failure.message });
      process.stdout.write("\nSMOKE: red\n");
      return 1;
    }
    outcomes.set(step.id, { id: step.id, outcome: "ok", ms: Date.now() - at });
    process.stdout.write(
      `ok   ${step.name} (${((Date.now() - at) / 1000).toFixed(1)}s)\n`,
    );
  }
  finish("green");
  process.stdout.write(`\nSMOKE: green (${((Date.now() - startedAt) / 1000).toFixed(1)}s)\n`);
  return 0;
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

if (process.argv[1] === import.meta.filename) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((e: unknown) => {
      process.stderr.write(`smoke: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exitCode = 1;
    });
}
