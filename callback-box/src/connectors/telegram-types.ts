/**
 * Shared types for the Telegram connector and its helper modules.
 */

export interface TelegramConfig {
  botToken: string;
  webhookSecret: string;
}

export interface TelegramState {
  lastUpdateId?: number;
  chatMappings?: Record<string, string>;
  callbacks?: Record<string, { at: string }>;
}

/** Minimal Telegram message shape we extract fields from. */
export interface TelegramMessageObj {
  message_id: number;
  date: number;
  chat: {
    id: number;
    title?: string | undefined;
    type: string;
  };
  from?: {
    id: number;
    first_name: string;
    last_name?: string | undefined;
    username?: string | undefined;
  };
  text?: string | undefined;
  caption?: string | undefined;
}

/** Shape of the update objects we accept (from webhook or getUpdates). */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessageObj;
  edited_message?: TelegramMessageObj;
}
