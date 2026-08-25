/**
 * Proactive scheduled-task health alerts, run by the scheduler daemon
 * after each box's tick (scheduler.ts).
 *
 * Explicit opt-in: a box must have a reachable channel — `healthAlerts.telegramChat`
 * in config/box.json and/or a subscribed Web Push device. The alert fans out via
 * notifyBoxholder to durable per-channel cards in box/output/ (the documented
 * outbound contract), flushed immediately so it doesn't wait for the next finalize.
 *
 * One alert per unhealthy episode: alerting stamps each task's latch
 * (alertedAt/alertedFor); a successful run clears it (recordOutcome),
 * so a relapse alerts again. Tasks already latched are skipped, so a
 * task failing for days produces one message, not one per tick. A delivery
 * failure leaves a `failed` card (inspectable), so latching is safe.
 */

import { boxSlug } from "../../lib/box-slug.js";
import {
  loadScheduleHealth,
  selectAlertableTasks,
  describeUnhealthyTask,
  describeParkedUpdates,
} from "./health-box.js";
import { conciseScheduleError, type TaskHealth } from "./health.js";
import { loadScriptState, saveScriptState } from "./state.js";
import type { TelegramService } from "../../services/telegram.js";
import type { PushService } from "../../services/push.js";
import { notifyBoxholder, notifyChannels } from "../notify-boxholder.js";

export interface HealthAlertResult {
  /** Names of the tasks covered by the alert. */
  alerted: string[];
  /** Whether the alert was dispatched to at least one channel. */
  delivered: boolean;
}

function alertLine(task: TaskHealth, now: Date): string {
  let line = `- ${describeUnhealthyTask(task, now)}`;
  if (task.status === "failing" && task.lastError) {
    line = `${line} — ${conciseScheduleError(task.lastError)}`;
  }
  // Last, after the error: the boxholder reads the symptom, then learns the fix
  // is already parked on disk and only needs accepting.
  const parked = describeParkedUpdates(task);
  return parked === null ? line : `${line} — ${parked}`;
}

function latchKind(task: TaskHealth): "failing" | "overdue" | "invalid" {
  if (task.status === "overdue") return "overdue";
  if (task.status === "invalid") return "invalid";
  return "failing";
}

/**
 * Evaluate the box's schedule health and send one aggregated alert for
 * any newly-unhealthy tasks, fanning out to every channel that can reach the
 * boxholder (web push + Telegram) via notifyBoxholder. Returns null when no
 * channel is configured for the box or there is nothing new to say. `tg`/`push`
 * inject fake services in tests; the daemon omits them.
 */
export async function checkHealthAndAlert(
  boxRoot: string,
  { now, tg, push }: { now: Date; tg?: TelegramService; push?: PushService },
): Promise<HealthAlertResult | null> {
  const channels = await notifyChannels(boxRoot);
  if (!channels.telegram && !channels.push) return null;

  const health = await loadScheduleHealth(boxRoot, now);
  const fresh = selectAlertableTasks(health).filter((t) => t.alertedAt === null);
  if (fresh.length === 0) return null;

  const boxName = await boxSlug(boxRoot);
  const title = `⚠️ Scheduled-task health (${boxName})`;
  const body = [
    ...fresh.map((t) => alertLine(t, now)),
    "",
    "Run `cb health` in the box for details.",
  ].join("\n");

  // Fan out to durable per-channel cards and flush immediately — a scheduler
  // tick fires outside a finalize pass, so the alert shouldn't wait for one.
  // A delivery failure leaves a `failed` card (inspectable, never silent), so
  // latching the episode below can't silently drop it.
  const result = await notifyBoxholder(boxRoot, {
    title,
    body,
    url: `/${boxName}/`,
    severity: "alert",
    name: "health-alert",
    deliver: true,
    now,
    tg,
    push,
  });

  // Latch each task so the same episode doesn't re-alert every tick.
  for (const task of fresh) {
    const state = await loadScriptState(boxRoot, task.name);
    state.alertedAt = now.toISOString();
    state.alertedFor = latchKind(task);
    await saveScriptState({ boxRoot, scriptName: task.name, state });
  }

  return { alerted: fresh.map((t) => t.name), delivered: result.channels.length > 0 };
}
