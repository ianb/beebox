/**
 * Stateless helpers for the Telegram connector: config/URL loading, chat-slug
 * mapping, update extraction, and duration parsing.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { safeFilename } from "./chat-utils.js";
import type {
  TelegramConfig,
  TelegramMessageObj,
  TelegramState,
  TelegramUpdate,
} from "./telegram-types.js";

export class MissingPublicUrlError extends Error {
  constructor() {
    super("publicUrl not set in config/box.json — cannot set Telegram webhook");
    this.name = "MissingPublicUrlError";
  }
}

/**
 * Load publicUrl from config/box.json. Falls back to PUBLIC_URL env var.
 */
export async function loadPublicUrl(boxRoot: string): Promise<string | null> {
  try {
    const content = await fs.readFile(path.join(boxRoot, "config/box.json"), "utf-8");
    const parsed = JSON.parse(content);
    if (parsed.publicUrl) return parsed.publicUrl;
  } catch (e) {
    // box.json missing or unparseable — fall through to the env var.
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not read publicUrl from config/box.json, falling back to PUBLIC_URL: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return process.env.PUBLIC_URL ?? null;
}

/**
 * Load telegram config from the secret file. Returns null if not configured.
 */
export async function loadTelegramConfig(boxRoot: string): Promise<TelegramConfig | null> {
  try {
    const configPath = path.join(boxRoot, "config/connectors/telegram.secret.json");
    const content = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(content);
    if (parsed.botToken && parsed.webhookSecret) return parsed;
    return null;
  } catch (_e) {
    // Secret file absent or unreadable — Telegram is simply not configured
    // for this box, which is a normal, expected state (not an error).
    return null;
  }
}

/**
 * Get the chat slug for a Telegram chat, creating a mapping if needed.
 */
export function getChatSlug(
  state: TelegramState,
  opts: { chatId: number; chatTitle: string | undefined; senderName: string }
): string {
  const mappings = state.chatMappings ?? {};
  const chatKey = String(opts.chatId);
  const existing = mappings[chatKey];
  if (existing) return existing;

  // Private chats use the sender name; groups use the chat title
  const label = opts.chatTitle ?? opts.senderName;
  const slug = safeFilename(label);
  mappings[chatKey] = slug;
  state.chatMappings = mappings;
  return slug;
}

/** Extract message fields from a Telegram update. Returns null if not processable. */
export function extractMessage(update: TelegramUpdate): {
  msg: TelegramMessageObj;
  text: string;
  senderName: string;
  timestamp: string;
} | null {
  const msg = update.message ?? update.edited_message;
  if (!msg) return null;
  const text = msg.text ?? msg.caption;
  if (!text) return null;
  const senderName =
    [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") ||
    "Unknown";
  const timestamp = new Date(msg.date * 1000).toISOString();
  return { msg, text, senderName, timestamp };
}

/**
 * Parse a human-friendly duration string like "5m", "1h", "30s" into milliseconds.
 */
export function parseDuration(dur: string): number | null {
  const match = dur.match(/^(\d+)\s*([dhms])$/);
  if (!match) return null;
  const value = parseInt(match[1]!, 10);
  const unit = match[2];
  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}
