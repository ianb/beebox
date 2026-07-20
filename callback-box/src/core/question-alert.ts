/**
 * Proactive "a question needs an answer" notifications, run at `cb finalize`.
 *
 * The cheap hook the boxholder asked for: instead of instrumenting every
 * producer that writes a question card, a finalize-time sweep diffs the box's
 * currently-pending questions against a per-box latch and notifies the
 * boxholder (via notifyBoxholder, fanning out to push + Telegram) about the
 * newly-pending ones. Each question is notified once while it stays pending;
 * when it's answered it leaves the pending set and the latch, so a later
 * question can notify again. See docs/plans/web-push-notifications.md (Track D).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { boxSlug } from "../lib/box-slug.js";
import { generateContext } from "../webapp/context.js";
import { notifyBoxholder, notifyChannels } from "./notify-boxholder.js";
import type { TelegramService } from "../services/telegram.js";
import type { PushService } from "../services/push.js";
import { errnoCode } from "../lib/error-guards.js";
import { z } from "zod";

const LATCH_PATH = ".callback-box/notified-questions.json";

/**
 * Shared per-box latch, one file for both dedup jobs that ride the `cb
 * finalize` sweep: `paths` is this module's "already notified about the
 * newly-pending set" record (rewritten to exactly the current pending set
 * each pass); `nudged` is the aging sweep's (`question-aging.ts`) "already
 * sent the one reminder" record, keyed by question path to its nudge
 * timestamp. One file, one load/save pair, so the two sweeps (which run
 * sequentially from the same finalize call site, never concurrently) don't
 * clobber each other's half.
 */
export interface QuestionLatch {
  paths: string[];
  nudged: Record<string, string>;
}

const questionLatchSchema = z.object({
  paths: z.array(z.string()).optional(),
  nudged: z.record(z.string(), z.string()).optional(),
});

export async function loadQuestionLatch(boxRoot: string): Promise<QuestionLatch> {
  try {
    const raw = await fs.readFile(path.join(boxRoot, LATCH_PATH), "utf-8");
    const data = questionLatchSchema.parse(JSON.parse(raw));
    return { paths: data.paths ?? [], nudged: data.nudged ?? {} };
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn("Could not read notified-questions latch, treating as empty:", e);
    }
    return { paths: [], nudged: {} };
  }
}

export async function saveQuestionLatch(boxRoot: string, latch: QuestionLatch): Promise<void> {
  const absPath = path.join(boxRoot, LATCH_PATH);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, `${JSON.stringify(latch, null, 2)}\n`);
}

export interface QuestionAlertResult {
  /** Relative paths of the questions newly notified this pass. */
  notified: string[];
}

export async function checkPendingQuestionsAndNotify(
  boxRoot: string,
  opts: { now: Date; deliver?: boolean; tg?: TelegramService; push?: PushService },
): Promise<QuestionAlertResult | null> {
  const channels = await notifyChannels(boxRoot);
  if (!channels.telegram && !channels.push) return null;

  const { pendingQuestions } = await generateContext(boxRoot);
  const pendingPaths = pendingQuestions.map((q) => q.path);
  const latch = await loadQuestionLatch(boxRoot);
  const latchedPaths = new Set(latch.paths);
  const fresh = pendingQuestions.filter((q) => !latchedPaths.has(q.path));

  // Rewrite `paths` to exactly the currently-pending set, so answered
  // questions drop out (and may re-notify if they ever reappear). Prune
  // `nudged` the same way — it's the aging sweep's dedup record, but a
  // question that's left the pending set (answered/dismissed/expired
  // elsewhere) has nothing left to nudge, so its entry is stale here too.
  const prunedNudged = Object.fromEntries(
    Object.entries(latch.nudged).filter(([p]) => pendingPaths.includes(p)),
  );
  await saveQuestionLatch(boxRoot, { paths: pendingPaths, nudged: prunedNudged });

  if (fresh.length === 0) return null;

  const boxName = await boxSlug(boxRoot);
  const title = fresh.length === 1
    ? "❓ A question needs an answer"
    : `❓ ${fresh.length} questions need answers`;
  const body = fresh.map((q) => `- ${q.prompt}`).join("\n");
  // One question → deep-link to its card; several → the questions list.
  const url = fresh.length === 1 && fresh[0]
    ? `/${boxName}/browse/${fresh[0].path}`
    : `/${boxName}/`;

  await notifyBoxholder(boxRoot, {
    title,
    body,
    url,
    severity: "alert",
    name: "question-alert",
    deliver: opts.deliver ?? false,
    now: opts.now,
    tg: opts.tg,
    push: opts.push,
  });

  return { notified: fresh.map((q) => q.path) };
}
