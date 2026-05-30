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

import * as path from "node:path";
import {
  registerConnector,
  type Connector,
  type SyncResult,
} from "./index.js";
import { stageFiles, commit } from "../cli/lib/git.js";
import { loadTransientState, saveTransientState } from "./transient-state.js";
import { createChatJob } from "./chat-utils.js";
import { getBoxTimeISO } from "../cli/lib/time.js";
import type { TelegramService } from "../services/telegram.js";
import { createTelegramService } from "../services/telegram.js";
import type {
  TelegramConfig,
  TelegramState,
  TelegramUpdate,
} from "./telegram-types.js";
import {
  MissingPublicUrlError,
  loadPublicUrl,
  loadTelegramConfig,
  extractMessage,
} from "./telegram-helpers.js";
import {
  processUpdateToThread,
  type IngestResult,
} from "./telegram-ingest.js";
import { sendOutbound } from "./telegram-outbound.js";

// Re-export the public surface that previously lived in this file so existing
// importers ("./telegram.js") keep working unchanged.
export type { TelegramConfig, TelegramUpdate } from "./telegram-types.js";
export { loadTelegramConfig, extractMessage } from "./telegram-helpers.js";

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
  ): Promise<IngestResult | null> {
    return processUpdateToThread({ boxRoot: this.boxRoot, update, state });
  }

  /**
   * Set webhook so Telegram pushes updates to our server.
   */
  private async setupWebhook(config: TelegramConfig): Promise<void> {
    const publicUrl = await loadPublicUrl(this.boxRoot);
    if (!publicUrl) {
      throw new MissingPublicUrlError();
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
    return sendOutbound({
      boxRoot: this.boxRoot,
      triggeredBy: this.triggeredBy,
      tg: this.getTelegram(config.botToken),
    });
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
