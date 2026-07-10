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
import { generateContext } from "../webapp/context.js";
import { notifyBoxholder, notifyChannels } from "./notify-boxholder.js";
import type { TelegramService } from "../services/telegram.js";
import type { PushService } from "../services/push.js";
import { errnoCode } from "../lib/error-guards.js";

const LATCH_PATH = ".callback-box/notified-questions.json";

interface QuestionLatch {
  paths: string[];
}

async function loadLatch(boxRoot: string): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(path.join(boxRoot, LATCH_PATH), "utf-8");
    const data = JSON.parse(raw) as QuestionLatch;
    return new Set(data.paths);
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn("Could not read notified-questions latch, treating as empty:", e);
    }
    return new Set();
  }
}

async function saveLatch(boxRoot: string, paths: string[]): Promise<void> {
  const absPath = path.join(boxRoot, LATCH_PATH);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, `${JSON.stringify({ paths }, null, 2)}\n`);
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
  const latched = await loadLatch(boxRoot);
  const fresh = pendingQuestions.filter((q) => !latched.has(q.path));

  // Rewrite the latch to exactly the currently-pending set, so answered
  // questions drop out (and may re-notify if they ever reappear).
  await saveLatch(boxRoot, pendingPaths);

  if (fresh.length === 0) return null;

  const boxName = path.basename(boxRoot);
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
