/**
 * Stateless helpers for the Telegram connector: config/URL loading, chat-slug
 * mapping, update extraction, and duration parsing.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { parseJsonSecret } from "../core/secrets/json-secret.js";
import { refusalAllowsLegacyFallback } from "../core/secrets/legacy-fallback.js";
import { resolveSecret } from "../core/secrets/resolve.js";
import { boxSlug } from "../lib/box-slug.js";
import { errnoCode } from "../lib/error-guards.js";
import { safeFilename } from "./chat-utils.js";
import {
  parseDuration as parseScheduledDuration,
  InvalidDurationError,
  UnknownDurationUnitError,
} from "../schemas/scheduled-script-duration.js";
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
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`Could not read publicUrl from config/box.json, falling back to PUBLIC_URL: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return process.env.PUBLIC_URL ?? null;
}

/** The store name a box's Telegram bot credentials live under. */
export function telegramSecretName(slug: string): string {
  return `telegram-bot/${slug}`;
}

/** The legacy in-tree secret file's path — still deleted on disconnect. */
export function telegramLegacySecretPath(boxRoot: string): string {
  return path.join(boxRoot, "config/connectors/telegram.secret.json");
}

/** Both the store's JSON-string value and the legacy file share this shape. */
const telegramSecretSchema = z.object({
  botToken: z.string().min(1),
  webhookSecret: z.string().min(1),
});

let warnedAboutLegacyFile = false;

/** Reset the once-per-process deprecation latch (tests only). */
export function resetTelegramLegacyWarning(): void {
  warnedAboutLegacyFile = false;
}

/**
 * Load a box's Telegram credentials: the machine store's `telegram-bot/<slug>`
 * entry (a JSON string `{botToken, webhookSecret}`) at `server` access, then
 * the deprecated in-tree `config/connectors/telegram.secret.json`
 * (`docs/plans/secret-custody.md`, Track 3). `null` when neither exists —
 * Telegram is simply not configured for this box, a normal state.
 *
 * The entry is single-box by construction (`owningBox` + `shareable: false`):
 * a bot token binds to ONE webhook URL, so a second box holding it would break
 * routing, not merely be unwise. Telegram also has no scoping primitive at all
 * (no derived or TTL'd credentials — revoke-only via BotFather), which is why
 * the token must stay server-side and the admin status response no longer
 * returns it.
 */
export async function loadTelegramConfig(boxRoot: string): Promise<TelegramConfig | null> {
  const slug = await boxSlug(boxRoot);
  const name = telegramSecretName(slug);
  const resolved = await resolveSecret({ boxRoot, name, purpose: "telegram", access: "server" });
  if (resolved.ok) {
    return parseJsonSecret({ name, value: resolved.value.value, schema: telegramSecretSchema });
  }

  // Only "no such secret on this machine" degrades to the legacy file; every
  // other refusal is "not configured" (`core/secrets/legacy-fallback.ts`).
  if (!refusalAllowsLegacyFallback({ reader: "telegram", refusal: resolved.error })) return null;

  let content: string;
  const legacyPath = telegramLegacySecretPath(boxRoot);
  try {
    content = await fs.readFile(legacyPath, "utf-8");
  } catch (_e) {
    // No stray file: the common case now. Silent by design.
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (e) {
    console.warn(`[telegram] ignoring unreadable legacy secret file ${legacyPath}:`, e);
    return null;
  }
  const parsed = telegramSecretSchema.safeParse(json);
  if (!parsed.success) return null;
  if (!warnedAboutLegacyFile) {
    warnedAboutLegacyFile = true;
    console.warn(
      `[telegram] using the deprecated in-tree secret file ${legacyPath}. ` +
        "Reconnect Telegram from the admin page to move it into the machine store, then delete the file.",
    );
  }
  return parsed.data;
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
 * Parse a human-friendly duration string like "5m", "1h", "30s" into
 * milliseconds, or null when it doesn't parse.
 *
 * Delegates to the canonical scheduled-script duration parser (the superset:
 * it also accepts weeks `w` and fractional values like `1.5h`, which this
 * connector's old integer-only `[dhms]` regex rejected), translating its
 * typed throws back into telegram's null sentinel at the boundary.
 */
export function parseDuration(dur: string): number | null {
  try {
    return parseScheduledDuration(dur);
  } catch (e) {
    if (e instanceof InvalidDurationError || e instanceof UnknownDurationUnitError) return null;
    throw e;
  }
}
