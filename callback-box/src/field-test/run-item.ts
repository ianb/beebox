/**
 * One checklist item, start to finish (`docs/plans/agent-field-tests.md`,
 * Track 2 — the activity loop).
 *
 * The order is the whole design, and each step exists because of a specific
 * way a run goes wrong without it:
 *
 *   1. quiesce      before touching anything, so a `pre` action cannot land
 *                   while the previous item's reactor cycle is still writing
 *   2. pre actions  inject mail / advance the day
 *   3. brief        the persona-voiced activity, plus this item's screenshot
 *                   subdirectory (created first — the operator is told to save
 *                   there, and a missing directory reads to it as a bug)
 *   4. debrief      the questionnaire, AFTER the work so it cannot prime it —
 *                   skipped when the activity itself errored, because nine
 *                   questions into a dead session collect the same error nine
 *                   times and cost a real Opus turn each
 *   5. quiesce      again, so the checks see the box the activity produced
 *   6. checks       the hard asserts the operator never sees
 *   7. cleanup      the item's policy + its checkpoint tag
 *
 * The activity's turn status and the debrief's outcome are recorded
 * SEPARATELY and never collapsed: a `turn-capped` activity can still debrief
 * `friction`, and that disagreement is a finding rather than a contradiction to
 * resolve here.
 */

import * as path from "node:path";
import { mkdir } from "node:fs/promises";
import { writeFileAtomic } from "../lib/atomic-write.js";
import { errorMessage } from "../lib/error-guards.js";
import { assertNever } from "../lib/invariant.js";
import { debriefQuestions, type DebriefResult } from "./questionnaire.js";
import { boxQuiescenceProbes, waitForQuiescence } from "./quiescence.js";
import { applyCleanup, checkpointTag } from "./checkpoints.js";
import { injectEmail } from "./pre-actions.js";
import { runCheck } from "./checks.js";
import type { FieldChecklistItem } from "./scenario.js";
import type { FieldRunContext } from "./run-context.js";
import type { OperatorTurnStatus } from "./operator-turns.js";
import type { ActivityResult, CheckResult, CleanupResult, ItemResult, PreActionResult } from "./results.js";

/** Statuses where the operator session is still alive and worth debriefing.
 *  `error` is not: the stream is broken or the SDK gave up. `timed-out` and
 *  `turn-capped` are — the operator is alive and has plenty to say about the
 *  activity it just failed to finish. */
function debriefable(status: OperatorTurnStatus): boolean {
  return status !== "error";
}

/** The message wrapped around the scenario's brief. The screenshot
 *  subdirectory is named HERE because the prompt's mechanics layer promises
 *  every brief will name one. */
function activityMessage(opts: {
  brief: string;
  index: number;
  total: number;
  screenshotsDir: string;
}): string {
  return [
    `# Activity ${String(opts.index + 1)} of ${String(opts.total)}`,
    "",
    opts.brief.trim(),
    "",
    `Save this activity's screenshots in ${opts.screenshotsDir} — the directory already exists.`,
    "Number them in the order you take them, and remember which shows what; you will be asked.",
    "",
    "Work on this until you are done or you have run out of patience, then say in your",
    "own words how it went.",
  ].join("\n");
}

async function runQuiesce(ctx: FieldRunContext): ReturnType<typeof waitForQuiescence> {
  const server = ctx.server();
  return waitForQuiescence({
    probes: boxQuiescenceProbes({
      boxRoot: ctx.box.boxRoot,
      baseUrl: server.baseUrl,
      diagKey: server.diagKey,
    }),
    ...ctx.quiescence,
  });
}

/** Run the item's `pre` actions in order, recording each. A failed action does
 *  not stop the item — the activity still runs, and the report says the world
 *  was not what the brief assumes. */
async function runPreActions(ctx: FieldRunContext, item: FieldChecklistItem): Promise<PreActionResult[]> {
  const results: PreActionResult[] = [];
  for (const action of item.pre) {
    switch (action.type) {
      case "inject-email":
        try {
          const id = await injectEmail({
            emailsDir: ctx.scenario.emailsDir,
            fixture: action.fixture,
            statePath: ctx.fakeGmailStatePath,
            packageRoot: ctx.box.packageRoot,
            env: ctx.childEnv(),
            now: ctx.boxTime(),
          });
          results.push({ type: "inject-email", detail: `${action.fixture} (message ${id})`, ok: true, error: null });
        } catch (e) {
          results.push({ type: "inject-email", detail: action.fixture, ok: false, error: errorMessage(e) });
        }
        break;
      case "advance-days":
        try {
          const to = await ctx.advanceDays(action.days);
          results.push({
            type: "advance-days",
            detail: `${String(action.days)} day(s) → ${to.toISOString()}`,
            ok: true,
            error: null,
          });
        } catch (e) {
          results.push({
            type: "advance-days",
            detail: `${String(action.days)} day(s)`,
            ok: false,
            error: errorMessage(e),
          });
        }
        break;
      default:
        assertNever(action);
    }
  }
  return results;
}

async function writeArtifacts(opts: {
  runDir: string;
  itemId: string;
  note: string;
  debrief: DebriefResult | null;
}): Promise<void> {
  const activitiesDir = path.join(opts.runDir, "activities");
  await mkdir(activitiesDir, { recursive: true });
  await writeFileAtomic(path.join(activitiesDir, `${opts.itemId}.md`), {
    content: `# ${opts.itemId}\n\n${opts.note.trim()}\n`,
  });
  if (opts.debrief === null) return;
  const questionnairesDir = path.join(opts.runDir, "questionnaires");
  await mkdir(questionnairesDir, { recursive: true });
  const body = opts.debrief.answers
    .map((a) => `## ${a.question}${a.reAsked ? "\n\n_(re-asked once)_" : ""}\n\n${a.answer}\n`)
    .join("\n");
  await writeFileAtomic(path.join(questionnairesDir, `${opts.itemId}.md`), {
    content: `# ${opts.itemId}\n\n${body}`,
  });
}

export interface RunChecklistItemOptions {
  ctx: FieldRunContext;
  item: FieldChecklistItem;
  index: number;
  total: number;
  /** The previous item's checkpoint tag (or the baseline) — `reset`'s target. */
  previousTag: string;
}

/**
 * Run one checklist item and return everything that happened. Does not throw
 * for anything the item itself can do wrong — a failed pre action, a stuck box,
 * a failing check and a broken cleanup are all recorded outcomes. It DOES
 * propagate an operator-session failure, which ends the run: with the operator
 * gone there is no persona left to run the remaining items.
 */
export async function runChecklistItem(options: RunChecklistItemOptions): Promise<ItemResult> {
  const { ctx, item, index, total, previousTag } = options;
  const events: string[] = [];
  const screenshotsDir = path.join(ctx.screenshotsRoot, item.id);
  await mkdir(screenshotsDir, { recursive: true });

  const before = await runQuiesce(ctx);
  if (!before.quiescent) {
    events.push(`box was not quiescent before the item: ${before.stuck.map((s) => s.name).join(", ")}`);
  }

  const pre = await runPreActions(ctx, item);
  // A failed `pre` action means the world is not what the brief assumes: mail
  // that never arrived, or a day that never turned. Running the activity anyway
  // spends a real operator on a question the harness already broke, and the
  // report would read as a product failure. Skip to cleanup and say so.
  const brokenSetup = pre.filter((p) => !p.ok);
  const setupFailed = brokenSetup.length > 0
    ? `setup failed: ${brokenSetup.map((p) => `${p.type} ${p.detail}`).join("; ")}`
    : null;
  if (setupFailed !== null) events.push(setupFailed);

  // The pre actions drive the box's reactor (inject-email processes the mail,
  // advance-days runs the day's work). Wait for that to settle before the
  // operator looks, so the activity never opens on a box mid-thought. The pre
  // actions drain jobs themselves, but `cb reactor` exits 0 even when a job
  // chain outlives its cycle budget; without this a partial drain would open
  // the activity on a churning box and only the NEXT item's start check would
  // notice. Here it surfaces as an event on THIS item instead.
  if (item.pre.length > 0 && setupFailed === null) {
    const settled = await runQuiesce(ctx);
    if (!settled.quiescent) {
      events.push(`box not quiescent after pre actions: ${settled.stuck.map((s) => s.name).join(", ")}`);
    }
  }

  const turn = setupFailed === null
    ? await ctx.operator.sendActivity(activityMessage({ brief: item.brief, index, total, screenshotsDir }))
    : null;
  const activity: ActivityResult = turn === null
    ? { status: "harness-skipped", turns: 0, note: "", error: setupFailed }
    : { status: turn.status, turns: turn.turns, note: turn.note, error: turn.error };

  let debrief: DebriefResult | null = null;
  let debriefSkipped: string | null = setupFailed;
  if (turn !== null) {
    if (debriefable(turn.status)) {
      debrief = await ctx.operator.runDebrief(debriefQuestions(item.questions));
    } else {
      debriefSkipped = `activity ended with status "${turn.status}" (${turn.error ?? "no detail"})`;
      events.push(debriefSkipped);
    }
  }

  const quiescence = await runQuiesce(ctx);
  if (!quiescence.quiescent) {
    events.push(`quiescence timed out; still busy: ${quiescence.stuck.map((s) => s.name).join(", ")}`);
  }

  // Checks assert what the activity produced; with no activity they would
  // report a failure the operator never had a chance to cause.
  const checks: CheckResult[] = [];
  for (const script of setupFailed === null ? item.checks : []) {
    checks.push(
      await runCheck({
        checksDir: ctx.scenario.checksDir,
        script,
        boxRoot: ctx.box.boxRoot,
        env: ctx.childEnv(),
      }),
    );
  }

  const tag = checkpointTag({ index, itemId: item.id });
  let cleanup: CleanupResult;
  try {
    const outcome = await applyCleanup({
      packageRoot: ctx.box.packageRoot,
      boxRoot: ctx.box.boxRoot,
      policy: item.cleanup,
      tag,
      previousTag,
      itemId: item.id,
    });
    let serverRestarted = false;
    if (item.cleanup === "reset") {
      await ctx.restartServer();
      serverRestarted = true;
      events.push(`box reset to ${previousTag}; server restarted`);
    }
    cleanup = { policy: item.cleanup, ...outcome, serverRestarted, error: null };
  } catch (e) {
    cleanup = {
      policy: item.cleanup,
      tag,
      head: "",
      resetTo: null,
      serverRestarted: false,
      error: errorMessage(e),
    };
    events.push(`cleanup failed: ${cleanup.error}`);
  }

  await writeArtifacts({
    runDir: ctx.runDir,
    itemId: item.id,
    note: activity.note === "" ? (activity.error ?? "(no note)") : activity.note,
    debrief,
  });

  return {
    id: item.id,
    brief: item.brief,
    screenshotsDir: path.relative(ctx.runDir, screenshotsDir),
    pre,
    activity,
    debrief,
    debriefSkipped,
    quiescence,
    checks,
    cleanup,
    events,
  };
}
