/**
 * Telegram service — typed interface for the subset of the Telegram Bot API we use.
 *
 * Real implementation wraps grammy's Bot.api. Fake implementation maintains
 * an outbox of sent messages and a configurable inbox for polling.
 */

import { Bot } from "grammy";

import { validateResponse } from "./connector-response.js";
import { telegramUpdatesSchema, type TelegramUpdate } from "./telegram-schemas.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type { TelegramUpdate } from "./telegram-schemas.js";

export interface TelegramSentMessage {
  chatId: string | number;
  text: string;
  messageId: number;
}

export interface WebhookInfo {
  url: string;
}

export interface BotUser {
  username: string;
  first_name: string;
}

// ─── Service interface ───────────────────────────────────────────────────────

export interface TelegramService {
  getMe(): Promise<BotUser>;
  sendMessage(
    chatId: string | number,
    text: string,
  ): Promise<{ message_id: number }>;
  setWebhook(
    url: string,
    options?: {
      secret_token?: string;
      allowed_updates?: string[];
    },
  ): Promise<void>;
  deleteWebhook(options?: {
    drop_pending_updates?: boolean;
  }): Promise<void>;
  getWebhookInfo(): Promise<WebhookInfo>;
  getUpdates(
    options?: {
      offset?: number;
      limit?: number;
      timeout?: number;
    },
  ): Promise<TelegramUpdate[]>;
}

// ─── Real implementation ─────────────────────────────────────────────────────

export function createTelegramService(botToken: string): TelegramService {
  const bot = new Bot(botToken);
  return {
    async getMe() {
      const me = await bot.api.getMe();
      return { username: me.username, first_name: me.first_name };
    },
    async sendMessage(chatId, text) {
      const result = await bot.api.sendMessage(chatId, text);
      return { message_id: result.message_id };
    },
    async setWebhook(url, options) {
      await bot.api.setWebhook(url, options as Parameters<typeof bot.api.setWebhook>[1]);
    },
    async deleteWebhook(options) {
      await bot.api.deleteWebhook(options);
    },
    async getWebhookInfo() {
      const info = await bot.api.getWebhookInfo();
      return { url: info.url ?? "" };
    },
    async getUpdates(options) {
      const updates = await bot.api.getUpdates(options);
      // Validate the raw polling response at the boundary (Track 4c): a drift in
      // the update shape throws ConnectorResponseError here instead of casting
      // through to silent undefineds in the ingest pipeline. Validate-and-
      // passthrough, mirroring the Gmail service — the cast narrows grammy's
      // richer Update type to the fields we actually consume.
      validateResponse(updates, {
        schema: telegramUpdatesSchema,
        service: "telegram",
        operation: "getUpdates",
      });
      return updates as TelegramUpdate[];
    },
  };
}

// ─── Fake implementation ─────────────────────────────────────────────────────

export interface FakeTelegramOptions {
  /** Bot username — required, returned by getMe() */
  username: string;
  /** Bot first name — defaults to username */
  firstName?: string;
  /** Pre-loaded updates for getUpdates() to return */
  updates?: TelegramUpdate[];
}

export interface FakeTelegramService extends TelegramService {
  /** Messages sent via sendMessage(), in order */
  sent: TelegramSentMessage[];
  /** Current webhook URL, or null if not set */
  webhookUrl: string | null;
  /** Webhook options from last setWebhook call */
  webhookOptions: { secret_token?: string; allowed_updates?: string[] } | null;
}

export function createFakeTelegram(
  opts: FakeTelegramOptions,
): FakeTelegramService {
  const updates = [...(opts.updates ?? [])];
  let nextMessageId = 1;

  const fake: FakeTelegramService = {
    sent: [],
    webhookUrl: null,
    webhookOptions: null,

    async getMe() {
      return {
        username: opts.username,
        first_name: opts.firstName ?? opts.username,
      };
    },

    async sendMessage(chatId, text) {
      const messageId = nextMessageId++;
      fake.sent.push({ chatId, text, messageId });
      return { message_id: messageId };
    },

    async setWebhook(url, options) {
      fake.webhookUrl = url;
      fake.webhookOptions = options ?? null;
    },

    async deleteWebhook() {
      fake.webhookUrl = null;
      fake.webhookOptions = null;
    },

    async getWebhookInfo() {
      return { url: fake.webhookUrl ?? "" };
    },

    async getUpdates(options) {
      const offset = options?.offset;
      if (offset != null) {
        // Filter to updates >= offset, matching Telegram's behavior
        const idx = updates.findIndex((u) => u.update_id >= offset);
        if (idx === -1) return [];
        return updates.splice(idx);
      }
      // Return and drain all updates
      return updates.splice(0);
    },
  };

  return fake;
}
