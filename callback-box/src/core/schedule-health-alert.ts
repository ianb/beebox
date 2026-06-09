/**
 * Proactive scheduled-task health alerts, run by the scheduler daemon
 * after each box's tick (scheduler.ts).
 *
 * Explicit opt-in: a box must set `healthAlerts.telegramChat` in
 * config/box.json. The alert is a telegram-message card in box/output/
 * (the documented outbound contract), flushed immediately when the
 * telegram connector is configured — otherwise it rides out with the
 * next sync.
 *
 * One alert per unhealthy episode: alerting stamps each task's latch
 * (alertedAt/alertedFor); a successful run clears it (recordOutcome),
 * so a relapse alerts again. Tasks already latched are skipped, so a
 * task failing for days produces one message, not one per tick.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadBoxConfig } from "../webapp/box-config.js";
import {
  loadScheduleHealth,
  selectAlertableTasks,
  describeUnhealthyTask,
} from "./schedule-health-box.js";
import type { TaskHealth } from "./schedule-health.js";
import { loadScriptState, saveScriptState } from "./schedule-state.js";
import { createTelegramMessageTemplate } from "../schemas/telegram-message.js";
import { stageFiles, commit } from "../cli/lib/git.js";
import { loadTelegramConfig } from "../connectors/telegram-helpers.js";
import { createTelegramService, type TelegramService } from "../services/telegram.js";
import { sendOutputCards } from "../connectors/telegram-output-cards.js";

export interface HealthAlertResult {
  /** Names of the tasks covered by the alert. */
  alerted: string[];
  /** Whether the alert was flushed to Telegram immediately. */
  delivered: boolean;
}

function alertLine(task: TaskHealth, now: Date): string {
  const line = `- ${describeUnhealthyTask(task, now)}`;
  if (task.status === "failing" && task.lastError) {
    return `${line} — ${task.lastError.split("\n")[0]}`;
  }
  return line;
}

function latchKind(task: TaskHealth): "failing" | "overdue" | "invalid" {
  if (task.status === "overdue") return "overdue";
  if (task.status === "invalid") return "invalid";
  return "failing";
}

/**
 * Evaluate the box's schedule health and send one aggregated alert for
 * any newly-unhealthy tasks. Returns null when alerts aren't configured
 * for the box or there is nothing new to say. `tg` injects a fake
 * Telegram service in tests; the daemon omits it.
 */
export async function checkHealthAndAlert(
  boxRoot: string,
  { now, tg }: { now: Date; tg?: TelegramService },
): Promise<HealthAlertResult | null> {
  const config = await loadBoxConfig(boxRoot);
  const chatId = config.healthAlerts?.telegramChat;
  if (!chatId) return null;

  const health = await loadScheduleHealth(boxRoot, now);
  const fresh = selectAlertableTasks(health).filter((t) => t.alertedAt === null);
  if (fresh.length === 0) return null;

  const boxName = path.basename(boxRoot);
  const text = [
    `⚠️ Scheduled-task health (${boxName}):`,
    ...fresh.map((t) => alertLine(t, now)),
    "",
    "Run `cb health` in the box for details.",
  ].join("\n");

  const cardName = `health-alert-${now.toISOString().replace(/[.:]/g, "-")}.telegram-message.card`;
  const relPath = path.join("box/output", cardName);
  const absPath = path.join(boxRoot, relPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, createTelegramMessageTemplate({ chatId, text }));
  await stageFiles(boxRoot, [relPath]);
  await commit(boxRoot, {
    message: `Health alert: ${fresh.map((t) => t.name).join(", ")}`,
    trailers: { "Created-By": "schedule-health" },
  });

  // Latch each task so the same episode doesn't re-alert every tick.
  for (const task of fresh) {
    const state = await loadScriptState(boxRoot, task.name);
    state.alertedAt = now.toISOString();
    state.alertedFor = latchKind(task);
    await saveScriptState({ boxRoot, scriptName: task.name, state });
  }

  // Flush immediately when we can — alerting shouldn't wait for the
  // next wakeup. No telegram config is a misconfigured opt-in: the
  // card stays pending and the situation is itself worth a warning.
  let delivered = false;
  const telegramConfig = await loadTelegramConfig(boxRoot);
  if (telegramConfig) {
    const sent = await sendOutputCards({
      boxRoot,
      triggeredBy: "schedule-health",
      tg: tg ?? createTelegramService(telegramConfig.botToken),
    });
    delivered = sent.includes(relPath);
  } else {
    console.warn(
      `[schedule-health] ${boxName}: healthAlerts.telegramChat is set but the telegram connector is not configured; alert card left pending`,
    );
  }

  return { alerted: fresh.map((t) => t.name), delivered };
}
