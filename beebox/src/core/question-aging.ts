/**
 * Aging sweep for pending questions: nudge once, then expire.
 *
 * Runs from the same `bbx finalize` call site as `checkPendingQuestionsAndNotify`
 * (question-alert.ts) but is a separate function with a separate concern —
 * question-alert notifies about NEW pending questions; this sweep ages EXISTING
 * ones. A question's age is computed from its durable `asked-at` field, NEVER
 * from latch state: a lost or corrupt latch file must not reset a question's
 * age or block its expiry (the latch here only dedups the one nudge
 * notification). Expiry never depends on `notifyChannels` — `notifyBoxholder`
 * already no-ops itself when no channel is configured, so expiry runs
 * regardless; only nudge *delivery* is channel-gated by that same no-op.
 *
 * See docs/implemented-plans/questions-end-to-end.md (Track D).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { boxSlug } from "../lib/box-slug.js";
import { getSystemState } from "./state.js";
import { cardFields, parseCardText } from "./card-io.js";
import { createCardSchemaMap } from "../schemas/registry.js";
import {
  QuestionSchema,
  parseIso8601DurationMs,
  type QuestionFields,
} from "../schemas/question.js";
import { renderFrontmatterBlock, splitCardContent } from "../cards/index.js";
import { withQuestionTransition, resolveContainedQuestionPath } from "./commands/question-transition.js";
import { loadQuestionLatch, saveQuestionLatch } from "./question-alert.js";
import { notifyBoxholder } from "./notify-boxholder.js";
import { getBoxTime, getBoxTimeISO } from "../lib/time.js";
import type { CommandContext } from "./command-runner.js";
import type { TelegramService } from "../services/telegram.js";
import type { PushService } from "../services/push.js";
import { createEventBus } from "./event-bus.js";

/**
 * Default pending-question expiry window, when a card carries no
 * `expires-after` override. A deliberate default from the plan
 * (docs/implemented-plans/questions-end-to-end.md Track D) — questions age out of the
 * active view on a schedule but stay answerable (demoted, not closed).
 */
export const DEFAULT_EXPIRE_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Default nudge threshold, when a card carries no `expires-after` override.
 * A deliberate default from the plan (docs/implemented-plans/questions-end-to-end.md
 * Track D). When `expires-after` IS overridden, the nudge fires at half that
 * window instead (see `nudgeThresholdMs`).
 */
export const DEFAULT_NUDGE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface QuestionAgingResult {
  /** Relative paths of questions nudged this pass. */
  nudged: string[];
  /** Relative paths of questions expired this pass. */
  expired: string[];
}

export interface QuestionAgingOptions {
  /** Flush nudge notification cards immediately instead of the next finalize. */
  deliver?: boolean;
  /** Injected services (tests / immediate delivery), forwarded to notifyBoxholder. */
  tg?: TelegramService | undefined;
  push?: PushService | undefined;
}

/** The expiry window for a question: the override if set, else the default. */
function expireAfterMs(fields: QuestionFields): number {
  const override = fields["expires-after"];
  return override !== undefined ? parseIso8601DurationMs(override) : DEFAULT_EXPIRE_AFTER_MS;
}

/**
 * The nudge threshold for a question: half the expiry window when overridden
 * (a shorter evergreen window still gets a proportionally earlier reminder),
 * else the flat default.
 */
function nudgeThresholdMs(fields: QuestionFields): number {
  const override = fields["expires-after"];
  return override !== undefined ? parseIso8601DurationMs(override) / 2 : DEFAULT_NUDGE_AFTER_MS;
}

/**
 * Flip a pending question to `expired` under the shared guarded transition.
 * Returns true if this call performed the expiry, false if it lost a race
 * with a simultaneous answer/dismiss (the question re-read as non-pending) —
 * the loser skips silently, per the plan's failure-modes table.
 */
async function expireQuestion(
  ctx: CommandContext,
  relativePath: string,
): Promise<boolean> {
  const contained = resolveContainedQuestionPath(ctx.boxRoot, relativePath);
  if (!contained.ok) {
    console.warn(`Question aging: could not resolve question path "${relativePath}": ${contained.error}`);
    return false;
  }
  const { fullPath } = contained;

  const outcome = await withQuestionTransition({
    ctx,
    fullPath,
    questionRef: relativePath,
    allowedStatuses: ["pending"],
    disallowedMessage: (status) =>
      `Question is no longer pending (status: ${status}); skipping expiry`,
    plan: ({ fields, content }) => {
      fields.status = "expired";
      fields["expired-at"] = getBoxTimeISO(ctx.boxRoot);

      const split = splitCardContent(content);
      const cardContent = renderFrontmatterBlock(fields, split.body);

      return Promise.resolve({
        ok: true,
        plan: {
          writes: [{ absPath: fullPath, content: cardContent }],
          commit: {
            message: `Expire question: ${path.basename(relativePath, ".card")}`,
            trailers: { "Expired-By": "question-aging" },
          },
        },
      });
    },
  });

  if (!outcome.ok) {
    // Either a race loser (answered/dismissed between our scan and the
    // transition — expected and silent per the plan) or an infra failure
    // (lock timeout, commit failure). Either way the sweep continues with
    // the next question; a stranded expiry is retried on the next finalize.
    console.warn(`Question aging: could not expire ${relativePath}: ${outcome.result.error}`);
    return false;
  }
  return true;
}

/** Emit `question-expired` for UI consumers, best-effort (never blocks the sweep). */
function emitQuestionExpired(boxRoot: string, relativePath: string): void {
  const bus = createEventBus(boxRoot);
  try {
    bus.emit("question-expired", { path: relativePath, timestamp: getBoxTimeISO(boxRoot) });
  } finally {
    bus.close();
  }
}

/**
 * Age every pending question: nudge once at the halfway/default threshold,
 * expire past the full window. Never synthesizes an answer — expiry only
 * demotes visibility (the card stays in `box/questions/`, still answerable).
 * Time comes from `getBoxTime` (BBX_TIME-honoring), never `new Date()`
 * directly, so this is doctestable with frozen time.
 */
export async function ageQuestions(
  boxRoot: string,
  opts?: QuestionAgingOptions,
): Promise<QuestionAgingResult> {
  const options = opts ?? {};
  const ctx: CommandContext = { boxRoot, write: () => {}, writeLine: () => {} };
  const now = getBoxTime(boxRoot);

  const state = await getSystemState(boxRoot);
  const pending = state.questions.filter((q) => q.status === "pending");
  const schemas = await createCardSchemaMap(boxRoot);

  const latch = await loadQuestionLatch(boxRoot);
  const nudged: string[] = [];
  const expired: string[] = [];
  const stillPending = new Set<string>();

  for (const q of pending) {
    let fields: QuestionFields;
    try {
      const content = await fs.readFile(q.path, "utf-8");
      const card = parseCardText(content, { source: q.path, schemas });
      fields = cardFields(card, QuestionSchema);
    } catch (e) {
      console.warn(`Question aging: could not load ${q.relativePath}, skipping:`, e);
      continue;
    }

    const askedAt = fields["asked-at"];
    if (askedAt === undefined) {
      // Shouldn't exist post-migration (every question gets asked-at at
      // creation, and the migration backfilled pre-existing ones) — a hard
      // failure here would take down the whole sweep for one bad card, so
      // this degrades to a loud skip instead (principle 4: visible, not silent).
      console.warn(`Question aging: pending question missing asked-at, skipping: ${q.relativePath}`);
      continue;
    }

    const ageMs = now.getTime() - Date.parse(askedAt);

    if (ageMs >= expireAfterMs(fields)) {
      const didExpire = await expireQuestion(ctx, q.relativePath);
      if (didExpire) {
        expired.push(q.relativePath);
        delete latch.nudged[q.relativePath];
        emitQuestionExpired(boxRoot, q.relativePath);
      } else {
        // Race loser: some other process already moved it off pending.
        // Leave it out of stillPending too — it's no longer pending either way.
        delete latch.nudged[q.relativePath];
      }
      continue;
    }

    stillPending.add(q.relativePath);

    if (ageMs >= nudgeThresholdMs(fields) && latch.nudged[q.relativePath] === undefined) {
      await notifyBoxholder(boxRoot, {
        title: "⏰ Reminder: a question is waiting",
        body: fields.prompt,
        url: `/${await boxSlug(boxRoot)}/browse/${q.relativePath}`,
        severity: "info",
        name: "question-nudge",
        deliver: options.deliver ?? false,
        now,
        tg: options.tg,
        push: options.push,
      });
      latch.nudged[q.relativePath] = now.toISOString();
      nudged.push(q.relativePath);
    }
  }

  // Prune nudge entries for anything that dropped out of pending without
  // going through this pass's own expiry (e.g. answered/dismissed elsewhere
  // between the scan above and now) — a stale entry would just be dead
  // weight, but pruning keeps the latch's invariant ("nudged keys are a
  // subset of currently-pending paths") true for the next pass.
  for (const key of Object.keys(latch.nudged)) {
    if (!stillPending.has(key)) delete latch.nudged[key];
  }

  await saveQuestionLatch(boxRoot, latch);

  return { nudged, expired };
}
