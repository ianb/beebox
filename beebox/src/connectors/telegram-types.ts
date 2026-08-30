/**
 * Shared types for the Telegram connector and its helper modules.
 *
 * The wire-shape types (`TelegramUpdate`/`TelegramMessageObj`) are derived from
 * the canonical zod schema in `services/telegram-schemas.ts` and re-exported
 * here so the connector layer keeps a single import site. `TelegramConfig`/
 * `TelegramState` are connector-domain types and stay local.
 */

export type {
  TelegramUpdate,
  TelegramMessageObj,
} from "../services/telegram-schemas.js";

export interface TelegramConfig {
  botToken: string;
  webhookSecret: string;
}

export interface TelegramState {
  lastUpdateId?: number;
  chatMappings?: Record<string, string>;
  callbacks?: Record<string, { at: string }>;
}
