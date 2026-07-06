/**
 * notifyBoxholder — proactively reach the boxholder across every configured
 * channel with one call.
 *
 * Fan-out happens at card-write time: it writes a durable `web-push` card
 * (always) and a `telegram-message` card (when `healthAlerts.telegramChat` is
 * set), each a single-consumer output card delivered by its own connector at
 * `cb finalize`. This keeps the telegram path untouched and makes web push its
 * mirror — no channel-agnostic card, no multi-consumer lifecycle. Prefer this
 * over hand-writing a telegram card from box code. See
 * docs/plans/web-push-notifications.md (Track D).
 *
 * With `deliver: true` the cards are also flushed immediately (used by the
 * scheduler's health alert, which fires outside a finalize pass and shouldn't
 * wait for the next one).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadBoxConfig } from "./box/config.js";
import { createWebPushTemplate, type WebPushSeverityValue } from "../schemas/web-push.js";
import { createTelegramMessageTemplate } from "../schemas/telegram-message.js";
import { stageFiles, commit } from "../lib/git.js";
import { sendOutputCards } from "../connectors/telegram-output-cards.js";
import { sendOutputPushCards } from "../connectors/push.js";
import { loadTelegramConfig } from "../connectors/telegram-helpers.js";
import { createTelegramService, type TelegramService } from "../services/telegram.js";
import type { PushService } from "../services/push.js";
import { endpointsForBox } from "./push-subscriptions.js";

/**
 * Which channels can currently reach the boxholder for this box: telegram if
 * `healthAlerts.telegramChat` is configured, push if any device is subscribed.
 * Triggers use this to decide whether a proactive alert has anywhere to go.
 */
export async function notifyChannels(boxRoot: string): Promise<{ telegram: boolean; push: boolean }> {
  const config = await loadBoxConfig(boxRoot);
  const telegram = config.healthAlerts?.telegramChat != null;
  const push = (await endpointsForBox(path.basename(boxRoot))).length > 0;
  return { telegram, push };
}

export interface NotifyInput {
  title: string;
  body: string;
  /** Root-relative deep link opened on click (e.g. `/box/health`). */
  url: string;
  severity?: WebPushSeverityValue;
  tag?: string | undefined;
  /** Filename base for the output cards (default "notify"). */
  name?: string;
  /** Flush the cards immediately instead of waiting for the next finalize. */
  deliver?: boolean;
  now?: Date;
  /** Injected services (tests / immediate delivery). */
  tg?: TelegramService | undefined;
  push?: PushService | undefined;
}

export interface NotifyResult {
  /** Relative paths of the output cards written. */
  cards: string[];
  /** Channels a card was written for. */
  channels: Array<"web-push" | "telegram">;
}

export async function notifyBoxholder(
  boxRoot: string,
  input: NotifyInput,
): Promise<NotifyResult> {
  const now = input.now ?? new Date();
  const base = `${input.name ?? "notify"}-${now.toISOString().replace(/[.:]/g, "-")}`;
  const config = await loadBoxConfig(boxRoot);
  const chatId = config.healthAlerts?.telegramChat;
  const hasSubs = (await endpointsForBox(path.basename(boxRoot))).length > 0;

  const cards: string[] = [];
  const channels: Array<"web-push" | "telegram"> = [];

  // Web push card — written only when a device is subscribed (subscribing is
  // the opt-in). Skipping it when nobody's subscribed keeps a telegram-only
  // box from accruing failed cards on every alert.
  if (hasSubs) {
    const pushRel = path.join("box/output", `${base}.web-push.card`);
    await writeCard(path.join(boxRoot, pushRel), createWebPushTemplate({
      title: input.title,
      body: input.body,
      url: input.url,
      severity: input.severity ?? "alert",
      tag: input.tag,
    }));
    cards.push(pushRel);
    channels.push("web-push");
  }

  // Telegram card — only when the box has opted in with a chat id.
  if (chatId) {
    const tgRel = path.join("box/output", `${base}.telegram-message.card`);
    const text = input.body ? `${input.title}\n${input.body}` : input.title;
    await writeCard(path.join(boxRoot, tgRel), createTelegramMessageTemplate({ chatId, text }));
    cards.push(tgRel);
    channels.push("telegram");
  }

  if (cards.length === 0) {
    // No channel can reach the boxholder; nothing to write.
    return { cards, channels };
  }

  await stageFiles(boxRoot, cards);
  await commit(boxRoot, {
    message: `Notify boxholder: ${input.title}`,
    trailers: { "Created-By": "notify-boxholder" },
  });

  if (input.deliver) {
    await deliverNow({ boxRoot, tg: input.tg, push: input.push, hasTelegram: chatId != null });
  }

  return { cards, channels };
}

async function writeCard(absPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content);
}

/**
 * Flush both output-card connectors immediately so an alert doesn't wait for
 * the next finalize. Telegram needs its bot config; push reads the server-level
 * store. Failures are left to the connectors (a failed card stays for inspection).
 */
async function deliverNow(opts: {
  boxRoot: string;
  tg: TelegramService | undefined;
  push: PushService | undefined;
  hasTelegram: boolean;
}): Promise<void> {
  const { boxRoot, push, hasTelegram } = opts;
  await sendOutputPushCards({ boxRoot, triggeredBy: "notify-boxholder", push });

  if (hasTelegram) {
    const tg = opts.tg ?? (await buildTelegram(boxRoot));
    if (tg) {
      await sendOutputCards({ boxRoot, triggeredBy: "notify-boxholder", tg });
    }
  }
}

async function buildTelegram(boxRoot: string): Promise<TelegramService | null> {
  const telegramConfig = await loadTelegramConfig(boxRoot);
  if (!telegramConfig) {
    console.warn(
      "[notify-boxholder] telegram card written but the telegram connector is not configured; card left pending",
    );
    return null;
  }
  return createTelegramService(telegramConfig.botToken);
}
