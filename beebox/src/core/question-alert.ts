/**
 * Proactive "a question needs an answer" notifications, run at `bbx finalize`.
 *
 * The cheap hook the boxholder asked for: instead of instrumenting every
 * producer that writes a question card, a finalize-time sweep diffs the box's
 * currently-pending questions against a per-box latch and notifies the
 * boxholder (via notifyBoxholder) about the newly-pending ones: a `dot` (a
 * badge), or `quiet` when one of them carries `urgency: time-bound`. Each question is notified once while it stays pending;
 * when it's answered it leaves the pending set and the latch, so a later
 * question can notify again. See docs/implemented-plans/web-push-notifications.md (Track D).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { generateContext } from "../webapp/context.js";
import { describeDeliveries, inProcessSender, notificationSent, type NotifySender } from "./notify-boxholder.js";
import { parseTarget, type Target } from "./notification/target.js";
import type { PushService } from "../services/push.js";
import { errnoCode, errorMessage } from "../shared/error-guards.js";
import { z } from "zod";

const LATCH_PATH = ".beebox/notified-questions.json";

/**
 * Shared per-box latch, one file for both dedup jobs that ride the `bbx
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

/**
 * Notify about the newly-pending questions through `sender` (default this
 * process, with `push`). The latch is saved after the send: a send that did
 * not go out (`notificationSent`) is logged and its questions stay out of the
 * latch, so the next finalize announces them again until they leave pending.
 * A send with nobody to reach (every delivery skipped `no-audience`) counts
 * as sent, so a box with no paired device is not re-announced every finalize.
 */
export async function checkPendingQuestionsAndNotify(
  boxRoot: string,
  opts: { now: Date; push?: PushService; sender?: NotifySender },
): Promise<QuestionAlertResult | null> {
  const sender = opts.sender ?? inProcessSender(boxRoot, { push: opts.push });

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
  const save = (paths: string[]): Promise<void> => saveQuestionLatch(boxRoot, { paths, nudged: prunedNudged });

  if (fresh.length === 0) {
    await save(pendingPaths);
    return null;
  }

  const title = fresh.length === 1
    ? "❓ A question needs an answer"
    : `❓ ${fresh.length} questions need answers`;
  const body = fresh.map((q) => `- ${q.prompt}`).join("\n");
  // One question → its card; several → the dashboard's questions list.
  const target: Target = fresh.length === 1 && fresh[0]
    ? parseTarget(`question:${fresh[0].path}`)
    : { kind: "dashboard" };

  // A dot badges the phone; a question that blocks something with a date
  // also sends a muted notification.
  const loudness = fresh.some((q) => q.urgency === "time-bound") ? "quiet" : "dot";
  const notSent = await notSentDetail(() =>
    sender.send({ intent: { title, body, target, loudness, source: "question-alert" }, now: opts.now }),
  );
  if (notSent !== null) {
    const freshPaths = new Set(fresh.map((q) => q.path));
    await save(pendingPaths.filter((p) => !freshPaths.has(p)));
    console.warn(`Question alert for ${fresh.length} question(s) not sent: ${notSent}`);
    return null;
  }
  await save(pendingPaths);
  return { notified: fresh.map((q) => q.path) };
}

/** Null when the send went out; else what happened, for the log line. */
export async function notSentDetail(send: () => ReturnType<NotifySender["send"]>): Promise<string | null> {
  try {
    const result = await send();
    return notificationSent(result) ? null : describeDeliveries(result);
  } catch (e) {
    return errorMessage(e);
  }
}
