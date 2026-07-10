/**
 * Ingest a single Telegram update into a chat-thread file: ensure the thread
 * and person entries exist, then append the message. Filesystem effect plus a
 * `git add` of any new/refreshed person card (so it gets committed in the
 * caller's batch) — thread commits and job creation stay with the caller.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { stageFiles } from "../lib/git.js";
import {
  safeFilename,
  ensureThreadFile,
  appendMessageToThread,
  updatePersonEntry,
  ensureParticipant,
} from "./chat-utils.js";
import { getChatSlug, extractMessage } from "./telegram-helpers.js";
import type { TelegramState, TelegramUpdate } from "./telegram-types.js";

export interface IngestResult {
  threadRelPath: string;
  newThread: boolean;
  /** The connector metadata json (`people/<slug>/telegram.json`), or null. */
  personFile: string | null;
  /**
   * The seeded/refreshed person card (`people/<slug>.person.card`), or null
   * when the card already existed unchanged. Staged internally here, but the
   * caller's path-scoped commit must include it explicitly — a scoped commit
   * only commits the paths it names, so an omitted card would be left staged.
   */
  personCard: string | null;
  personRef: string | null;
}

/**
 * Process a single Telegram update into a thread append.
 * Returns info about what was created/updated, or null if skipped.
 */
export async function processUpdateToThread(opts: {
  boxRoot: string;
  update: TelegramUpdate;
  state: TelegramState;
}): Promise<IngestResult | null> {
  const { boxRoot, update, state } = opts;
  const extracted = extractMessage(update);
  if (!extracted) return null;
  const { msg, text, senderName, timestamp } = extracted;

  const chatSlug = getChatSlug(state, {
    chatId: msg.chat.id,
    chatTitle: msg.chat.title,
    senderName,
  });

  // Update people directory first (need the ref for participants)
  let personFile: string | null = null;
  let personCard: string | null = null;
  let personRef: string | null = null;
  if (msg.from) {
    const displayName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ");
    const personSlug = safeFilename(displayName);
    // Absolute box-root path so the ref resolves the same from any
    // chat-thread location (threads live at varying depths).
    if (personSlug) personRef = `/people/${personSlug}.person.card`;

    const person = await updatePersonEntry({
      boxRoot,
      connector: "telegram",
      connectorId: msg.from.id,
      firstName: msg.from.first_name,
      ...(msg.from.last_name != null ? { lastName: msg.from.last_name } : {}),
      ...(msg.from.username != null ? { username: msg.from.username } : {}),
    });
    personFile = person.metadataPath;
    personCard = person.cardPath;
    // Stage the seeded/refreshed person card so the caller's commit picks it
    // up; the metadata json is surfaced via personFile and staged by callers.
    if (person.cardPath) await stageFiles(boxRoot, [person.cardPath]);
  }

  // Ensure thread file exists (with description and initial participant)
  const description = msg.chat.title ?? senderName;
  const threadRelPath = await ensureThreadFile({
    boxRoot,
    connector: "telegram",
    chatSlug,
    chatId: String(msg.chat.id),
    description,
    ...(personRef ? { participants: [personRef] } : {}),
  });

  // Check if thread file is new (only has the root element, no messages)
  const absPath = path.join(boxRoot, threadRelPath);
  const content = await fs.readFile(absPath, "utf-8");
  const newThread = !content.includes("<message");

  // Ensure this sender is in the participants list
  if (personRef) {
    await ensureParticipant({
      boxRoot,
      threadRelPath,
      personRef,
    });
  }

  // Append message to thread
  await appendMessageToThread({
    boxRoot,
    threadRelPath,
    message: {
      id: String(msg.message_id),
      sender: senderName,
      ...(msg.from?.id != null ? { senderId: String(msg.from.id) } : {}),
      time: timestamp,
      text,
    },
  });

  return { threadRelPath, newThread, personFile, personCard, personRef };
}
