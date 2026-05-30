/**
 * Telegram Connector — receives messages via webhook, catches up via polling on wakeup,
 * sends outbound messages from chat thread files.
 *
 * Configuration: config/connectors/telegram.secret.json
 * {
 *   "botToken": "123456:ABC-DEF...",
 *   "webhookSecret": "random-secret-string"
 * }
 *
 * Transient state: config/connectors/telegram.state.json (gitignored)
 * {
 *   "lastUpdateId": 12345,
 *   "chatMappings": { "8239678071": "Ian_Bicking" },
 *   "callbacks": { "store/chat/telegram/Family_Group/thread.chat-thread.card": { "at": "..." } }
 * }
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import type { ChatThreadFields } from "../schemas/chat-thread.js";
import {
  registerConnector,
  type Connector,
  type SyncResult,
} from "./index.js";
import { stageFiles, commit } from "../cli/lib/git.js";
import { loadTransientState, saveTransientState } from "./transient-state.js";
import {
  safeFilename,
  ensureThreadFile,
  appendMessageToThread,
  findUnsentAgentMessages,
  stampSentMessage,
  createChatJob,
  updatePersonEntry,
  ensureParticipant,
} from "./chat-utils.js";
import { getBoxTimeISO } from "../cli/lib/time.js";
import type { TelegramService } from "../services/telegram.js";
import { createTelegramService } from "../services/telegram.js";

export interface TelegramConfig {
  botToken: string;
  webhookSecret: string;
}

interface TelegramState {
  lastUpdateId?: number;
  chatMappings?: Record<string, string>;
  callbacks?: Record<string, { at: string }>;
}

/** Shape of the update objects we accept (from webhook or getUpdates). */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessageObj;
  edited_message?: TelegramMessageObj;
}

/** Minimal Telegram message shape we extract fields from. */
interface TelegramMessageObj {
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

/**
 * Load publicUrl from config/box.json. Falls back to PUBLIC_URL env var.
 */
async function loadPublicUrl(boxRoot: string): Promise<string | null> {
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
function getChatSlug(
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

class TelegramConnector implements Connector {
  name = "telegram";
  produces = ["chat-thread"];
  inboxPaths: string[] = [];
  triggeredBy?: string;

  private boxRoot: string;
  private telegramService: TelegramService | undefined;

  constructor(boxRoot: string, telegramService?: TelegramService) {
    this.boxRoot = boxRoot;
    this.telegramService = telegramService;
  }

  /** Get the Telegram service, using injected service or creating from token. */
  private getTelegram(botToken: string): TelegramService {
    return this.telegramService ?? createTelegramService(botToken);
  }

  async sync(): Promise<SyncResult> {
    const config = await loadTelegramConfig(this.boxRoot);
    if (!config) {
      return { success: true, created: [], updated: [] };
    }

    const created: string[] = [];
    const updated: string[] = [];
    const errors: string[] = [];
    const jobs: string[] = [];
    const pushed: string[] = [];

    // Phase 1: Catch up on missed messages via getUpdates
    try {
      const result = await this.catchUpPolling(config);
      created.push(...result.created);
      updated.push(...result.updated);
      jobs.push(...result.jobs);
    } catch (err) {
      errors.push(`Polling catch-up failed: ${(err as Error).message}`);
    }

    // Phase 2: Set webhook for real-time updates
    try {
      await this.setupWebhook(config);
    } catch (err) {
      errors.push(`Webhook setup failed: ${(err as Error).message}`);
    }

    // Phase 3: Check callback timers
    try {
      const callbackJobs = await this.checkCallbackTimers();
      jobs.push(...callbackJobs);
    } catch (err) {
      errors.push(`Callback timer check failed: ${(err as Error).message}`);
    }

    // Phase 4: Send outbound messages from thread files
    try {
      const sentThreads = await this.sendOutbound(config);
      pushed.push(...sentThreads);
    } catch (err) {
      errors.push(`Outbound send failed: ${(err as Error).message}`);
    }

    const result: SyncResult = {
      success: errors.length === 0,
      created,
      updated,
    };
    if (pushed.length > 0) result.pushed = pushed;
    if (jobs.length > 0) result.jobs = jobs;
    if (errors.length > 0) result.error = errors.join("; ");
    return result;
  }

  /**
   * Poll for updates missed while the server was down.
   * Deletes webhook first (getUpdates and webhook are mutually exclusive),
   * drains updates, then re-sets webhook in the next phase.
   */
  private async catchUpPolling(config: TelegramConfig): Promise<{
    created: string[];
    updated: string[];
    jobs: string[];
  }> {
    const tg = this.getTelegram(config.botToken);
    const state = await loadTransientState<TelegramState>({
      boxRoot: this.boxRoot,
      connectorName: "telegram",
      defaultValue: {},
    });

    // Must delete webhook before calling getUpdates
    await tg.deleteWebhook({ drop_pending_updates: false });

    const allThreads = new Set<string>();
    const allPeopleFiles: string[] = [];
    const created: string[] = [];
    let offset = state.lastUpdateId ? state.lastUpdateId + 1 : undefined;

    // Drain all pending updates
    while (true) {
      const updates = await tg.getUpdates(
        offset != null
          ? { offset, limit: 100, timeout: 0 }
          : { limit: 100, timeout: 0 }
      );

      if (updates.length === 0) break;

      for (const update of updates) {
        const result = await this.processUpdateToThread(
          update as TelegramUpdate,
          state
        );
        if (result) {
          allThreads.add(result.threadRelPath);
          if (result.newThread) created.push(result.threadRelPath);
          if (result.personFile) allPeopleFiles.push(result.personFile);
        }
        offset = update.update_id + 1;
      }

      // Save offset after each batch
      state.lastUpdateId = updates[updates.length - 1]!.update_id;
      await saveTransientState({
        boxRoot: this.boxRoot,
        connectorName: "telegram",
        data: state,
      });
    }

    // Commit all thread changes and people files in one commit
    const filesToStage = [...allThreads, ...allPeopleFiles];
    const jobs: string[] = [];

    if (filesToStage.length > 0) {
      await stageFiles(this.boxRoot, filesToStage);
      const msgCount = allThreads.size;
      await commit(this.boxRoot, {
        message: `Pull messages from Telegram (${msgCount} thread${msgCount === 1 ? "" : "s"})`,
        trailers: {
          "Pulled-By": "telegram-connector",
          ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}),
        },
      });

      // Create chat jobs for each thread with new messages
      for (const threadRef of allThreads) {
        const slug = path.basename(path.dirname(threadRef));
        const jobPath = await createChatJob({
          boxRoot: this.boxRoot,
          threadRef,
          description: `New messages in ${slug}`,
          source: "telegram",
        });
        jobs.push(jobPath);
      }

      if (jobs.length > 0) {
        await stageFiles(this.boxRoot, jobs);
        await commit(this.boxRoot, {
          message: `Create chat job${jobs.length === 1 ? "" : "s"} for Telegram`,
          trailers: {
            "Created-By": "telegram-connector",
            ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}),
          },
        });
      }
    }

    return {
      created,
      updated: [...allThreads].filter((t) => !created.includes(t)),
      jobs,
    };
  }

  /**
   * Process a single Telegram update into a thread append.
   * Returns info about what was created/updated, or null if skipped.
   */
  async processUpdateToThread(
    update: TelegramUpdate,
    state: TelegramState
  ): Promise<{
    threadRelPath: string;
    newThread: boolean;
    personFile: string | null;
    personRef: string | null;
  } | null> {
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
    let personRef: string | null = null;
    if (msg.from) {
      const displayName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ");
      const personSlug = safeFilename(displayName);
      // Absolute box-root path so the ref resolves the same from any
      // chat-thread location (threads live at varying depths).
      if (personSlug) personRef = `/people/${personSlug}.person.card`;

      personFile = await updatePersonEntry({
        boxRoot: this.boxRoot,
        connector: "telegram",
        connectorId: msg.from.id,
        firstName: msg.from.first_name,
        ...(msg.from.last_name != null ? { lastName: msg.from.last_name } : {}),
        ...(msg.from.username != null ? { username: msg.from.username } : {}),
      });
    }

    // Ensure thread file exists (with description and initial participant)
    const description = msg.chat.title ?? senderName;
    const threadRelPath = await ensureThreadFile({
      boxRoot: this.boxRoot,
      connector: "telegram",
      chatSlug,
      chatId: String(msg.chat.id),
      description,
      ...(personRef ? { participants: [personRef] } : {}),
    });

    // Check if thread file is new (only has the root element, no messages)
    const absPath = path.join(this.boxRoot, threadRelPath);
    const content = await fs.readFile(absPath, "utf-8");
    const newThread = !content.includes("<message");

    // Ensure this sender is in the participants list
    if (personRef) {
      await ensureParticipant({
        boxRoot: this.boxRoot,
        threadRelPath,
        personRef,
      });
    }

    // Append message to thread
    await appendMessageToThread({
      boxRoot: this.boxRoot,
      threadRelPath,
      message: {
        id: String(msg.message_id),
        sender: senderName,
        ...(msg.from?.id != null ? { senderId: String(msg.from.id) } : {}),
        time: timestamp,
        text,
      },
    });

    return { threadRelPath, newThread, personFile, personRef };
  }

  /**
   * Set webhook so Telegram pushes updates to our server.
   */
  private async setupWebhook(config: TelegramConfig): Promise<void> {
    const publicUrl = await loadPublicUrl(this.boxRoot);
    if (!publicUrl) {
      throw new Error("publicUrl not set in config/box.json — cannot set Telegram webhook");
    }

    const boxSlug = path.basename(this.boxRoot);
    // publicUrl includes the box slug (e.g. https://box.example.com/ledger)
    // but webhook routes are at the server root, so strip the trailing path segment
    const baseUrl = new URL(publicUrl);
    baseUrl.pathname = baseUrl.pathname.replace(/\/[^/]+\/?$/, "");
    const basePath = baseUrl.pathname.replace(/\/+$/, "");
    const webhookUrl = `${baseUrl.origin}${basePath}/webhook/${boxSlug}/telegram`;

    const tg = this.getTelegram(config.botToken);
    await tg.setWebhook(webhookUrl, {
      secret_token: config.webhookSecret,
      allowed_updates: ["message", "edited_message"],
    });
  }

  /**
   * Check callback timers and create jobs for expired ones.
   */
  private async checkCallbackTimers(): Promise<string[]> {
    const state = await loadTransientState<TelegramState>({
      boxRoot: this.boxRoot,
      connectorName: "telegram",
      defaultValue: {},
    });

    const callbacks = state.callbacks ?? {};
    const now = new Date(getBoxTimeISO(this.boxRoot));
    const jobs: string[] = [];
    let changed = false;

    for (const [threadRef, timer] of Object.entries(callbacks)) {
      if (new Date(timer.at) <= now) {
        // Timer expired — create a job
        const slug = path.basename(path.dirname(threadRef));
        const jobPath = await createChatJob({
          boxRoot: this.boxRoot,
          threadRef,
          description: `Callback timer for ${slug}`,
          source: "telegram",
        });
        jobs.push(jobPath);

        // Remove the timer
        delete callbacks[threadRef];
        changed = true;
      }
    }

    if (changed) {
      state.callbacks = callbacks;
      await saveTransientState({
        boxRoot: this.boxRoot,
        connectorName: "telegram",
        data: state,
      });
    }

    if (jobs.length > 0) {
      await stageFiles(this.boxRoot, jobs);
      await commit(this.boxRoot, {
        message: `Create callback job${jobs.length === 1 ? "" : "s"} for Telegram`,
        trailers: {
          "Created-By": "telegram-connector",
          ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}),
        },
      });
    }

    return jobs;
  }

  /**
   * Send outbound messages: scan thread files for unsent agent messages.
   */
  private async sendOutbound(config: TelegramConfig): Promise<string[]> {
    const chatDir = path.join(this.boxRoot, "store/chat/telegram");
    let threadPaths: string[];
    try {
      threadPaths = await glob("*/thread.chat-thread.card", { cwd: chatDir });
    } catch (e) {
      console.warn(`Could not glob Telegram thread files in ${chatDir}, skipping outbound send: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }

    if (threadPaths.length === 0) return [];

    const tg = this.getTelegram(config.botToken);
    const pushed: string[] = [];

    for (const relThread of threadPaths) {
      const absPath = path.join(chatDir, relThread);
      const threadRelPath = path.relative(this.boxRoot, absPath);

      try {
        const { fields, unsent } = await findUnsentAgentMessages(absPath);
        if (unsent.length === 0) continue;

        const chatId = fields["chat-id"];
        if (!chatId) continue;

        // Record callback-in from trailing seen entry for later
        await this.recordCallbackTimers(fields, threadRelPath);

        for (const msg of unsent) {
          const text = msg.text?.trim();
          if (!text) continue;

          const result = await tg.sendMessage(chatId, text);
          const sentAt = new Date().toISOString();

          await stampSentMessage({
            absPath,
            messageText: text,
            sentAt,
            messageId: String(result.message_id),
          });
        }

        // Commit the stamped thread
        await stageFiles(this.boxRoot, [threadRelPath]);
        const slug = path.basename(path.dirname(threadRelPath));
        await commit(this.boxRoot, {
          message: `Send telegram message to ${slug}`,
          trailers: {
            "Pushed-By": "telegram-connector",
            ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}),
          },
        });

        pushed.push(threadRelPath);
      } catch (err) {
        console.error(`Failed to send outbound for ${threadRelPath}: ${(err as Error).message}`);
      }
    }

    return pushed;
  }

  /**
   * Scan for <seen callback-in="..."> elements and record timers in state.
   */
  private async recordCallbackTimers(
    fields: ChatThreadFields,
    threadRelPath: string
  ): Promise<void> {
    const entries = fields.entries ?? [];
    const lastEntry = entries[entries.length - 1];
    if (!lastEntry || lastEntry.kind !== "seen") return;

    const callbackIn = lastEntry["callback-in"];
    if (!callbackIn) return;

    const durationMs = parseDuration(callbackIn);
    if (!durationMs) return;

    const state = await loadTransientState<TelegramState>({
      boxRoot: this.boxRoot,
      connectorName: "telegram",
      defaultValue: {},
    });

    const callbacks = state.callbacks ?? {};
    const at = new Date(Date.now() + durationMs).toISOString();
    callbacks[threadRelPath] = { at };
    state.callbacks = callbacks;

    await saveTransientState({
      boxRoot: this.boxRoot,
      connectorName: "telegram",
      data: state,
    });
  }
}

/**
 * Parse a human-friendly duration string like "5m", "1h", "30s" into milliseconds.
 */
function parseDuration(dur: string): number | null {
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

/**
 * Create and register the Telegram connector for a box.
 */
export function createTelegramConnector(boxRoot: string, telegram?: TelegramService): Connector {
  const connector = new TelegramConnector(boxRoot, telegram);
  registerConnector(connector);
  return connector;
}

/**
 * Process a webhook update — used by the webhook route.
 * Appends to a thread file, commits, and creates a chat job.
 * Returns the thread relative path, or null if the update was skipped.
 */
export async function processWebhookUpdate(opts: {
  boxRoot: string;
  update: TelegramUpdate;
  /** When true, skip chat job creation (caller handles response directly) */
  skipJob?: boolean | undefined;
}): Promise<{ threadRef: string; personRef: string | null } | null> {
  const { boxRoot, update, skipJob } = opts;

  // Load state for chat mappings
  const state = await loadTransientState<TelegramState>({
    boxRoot,
    connectorName: "telegram",
    defaultValue: {},
  });

  const connector = new TelegramConnector(boxRoot);
  const result = await connector.processUpdateToThread(update, state);
  if (!result) return null;

  // Save state (chat mappings may have been updated)
  await saveTransientState({ boxRoot, connectorName: "telegram", data: state });

  // Commit the thread file + any people files
  const filesToStage = [result.threadRelPath];
  if (result.personFile) filesToStage.push(result.personFile);

  await stageFiles(boxRoot, filesToStage);

  const extracted = extractMessage(update)!;
  await commit(boxRoot, {
    message: `Telegram: ${extracted.senderName} in ${path.basename(path.dirname(result.threadRelPath))}`,
    trailers: { "Pulled-By": "telegram-webhook" },
  });

  if (!skipJob) {
    // Create chat job
    const slug = path.basename(path.dirname(result.threadRelPath));
    const jobPath = await createChatJob({
      boxRoot,
      threadRef: result.threadRelPath,
      description: `New messages in ${slug}`,
      source: "telegram",
    });
    await stageFiles(boxRoot, [jobPath]);
    await commit(boxRoot, {
      message: "Create chat job for Telegram message",
      trailers: { "Created-By": "telegram-webhook" },
    });
  }

  // Update state so catch-up polling doesn't re-process this update
  if (!state.lastUpdateId || update.update_id > state.lastUpdateId) {
    state.lastUpdateId = update.update_id;
    await saveTransientState({ boxRoot, connectorName: "telegram", data: state });
  }

  return { threadRef: result.threadRelPath, personRef: result.personRef };
}
