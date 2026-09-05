/**
 * Telegram Connector — receives messages via webhook, catches up via polling on wakeup,
 * sends outbound messages from chat thread files.
 *
 * Configuration: _config/connectors/telegram.secret.json
 * {
 *   "botToken": "123456:ABC-DEF...",
 *   "webhookSecret": "random-secret-string"
 * }
 *
 * Transient state: _bookkeeping/connectors/telegram.state.json (gitignored)
 * {
 *   "lastUpdateId": 12345,
 *   "chatMappings": { "8239678071": "Ian_Bicking" },
 *   "callbacks": { "_content/chat/telegram/Family_Group/thread.chat-thread.card": { "at": "..." } }
 * }
 */

import * as path from "node:path";
import { errorMessage } from "../lib/error-guards.js";
import { boxSlug } from "../lib/box-slug.js";
import {
  registerConnector,
  type Connector,
  type SyncResult,
} from "./index.js";
import { stageAndCommitPaths } from "../lib/git.js";
import { loadTransientState, updateTransientState } from "./transient-state.js";
import { createChatJob } from "./chat-utils.js";
import { getBoxTimeISO } from "../lib/time.js";
import { invariant } from "../lib/invariant.js";
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
} from "./telegram-helpers.js";
import {
  processUpdateToThread,
  type IngestResult,
} from "./telegram-ingest.js";
import { sendOutbound } from "./telegram-outbound.js";
import { sendOutputCards } from "./telegram-output-cards.js";

// Re-export the public surface that previously lived in this file so existing
// importers ("./telegram.js") keep working unchanged.
export type { TelegramConfig, TelegramUpdate } from "./telegram-types.js";
export { loadTelegramConfig, extractMessage } from "./telegram-helpers.js";
export { processWebhookUpdate } from "./telegram-webhook.js";

/**
 * Merge an ingest working copy's telegram-state deltas into freshly loaded
 * state (Track 1). Only the fields the poll/webhook ingest owns are merged:
 * `lastUpdateId` takes the newer value and `chatMappings` merges per key —
 * working contributes chat ids fresh hasn't seen, but on a key collision FRESH
 * wins (a mapping a concurrent writer already committed is authoritative; the
 * working copy's is at best a redundant re-derivation of the same slug).
 * `callbacks` is left to `fresh` — ingest never sets timers, so writing the
 * working copy's possibly-stale callbacks back would resurrect a timer a
 * concurrent `sendOutbound`/`checkCallbackTimers` just changed.
 */
function mergeIngestState(fresh: TelegramState, working: TelegramState): TelegramState {
  const merged: TelegramState = { ...fresh };
  if (working.lastUpdateId != null) {
    merged.lastUpdateId = Math.max(fresh.lastUpdateId ?? 0, working.lastUpdateId);
  }
  if (working.chatMappings) {
    merged.chatMappings = { ...working.chatMappings, ...(fresh.chatMappings ?? {}) };
  }
  return merged;
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
      errors.push(`Polling catch-up failed: ${errorMessage(err)}`);
    }

    // Phase 2: Set webhook for real-time updates
    try {
      await this.setupWebhook(config);
    } catch (err) {
      errors.push(`Webhook setup failed: ${errorMessage(err)}`);
    }

    // Phase 3: Check callback timers
    try {
      const callbackJobs = await this.checkCallbackTimers();
      jobs.push(...callbackJobs);
    } catch (err) {
      errors.push(`Callback timer check failed: ${errorMessage(err)}`);
    }

    // Phase 4: Send outbound messages from thread files
    try {
      const sentThreads = await sendOutbound({
        boxRoot: this.boxRoot,
        triggeredBy: this.triggeredBy,
        tg: this.getTelegram(config.botToken),
      });
      pushed.push(...sentThreads);
    } catch (err) {
      errors.push(`Outbound send failed: ${errorMessage(err)}`);
    }

    // Phase 5: Send pending telegram-message cards from _bookkeeping/output/
    try {
      const sentCards = await sendOutputCards({
        boxRoot: this.boxRoot,
        triggeredBy: this.triggeredBy,
        tg: this.getTelegram(config.botToken),
      });
      pushed.push(...sentCards);
    } catch (err) {
      errors.push(`Output card send failed: ${errorMessage(err)}`);
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
    // Working copy for reads (chat-slug mappings + offset). Persisted per batch
    // via updateTransientState, whose update fn delta-merges into freshly-loaded
    // state (Track 1) so a concurrent webhook's lastUpdateId/chatMappings aren't
    // clobbered. We never hold the transient-state lock across the getUpdates
    // network calls or the git commits below.
    let working = await loadTransientState<TelegramState>({
      boxRoot: this.boxRoot,
      connectorName: "telegram",
      defaultValue: {},
    });

    // Must delete webhook before calling getUpdates
    await tg.deleteWebhook({ drop_pending_updates: false });

    const allThreads = new Set<string>();
    const allPeopleFiles: string[] = [];
    const allPersonCards: string[] = [];
    const created: string[] = [];
    let offset = working.lastUpdateId ? working.lastUpdateId + 1 : undefined;

    // Drain all pending updates
    for (;;) {
      const updates = await tg.getUpdates(
        offset != null
          ? { offset, limit: 100, timeout: 0 }
          : { limit: 100, timeout: 0 }
      );

      if (updates.length === 0) break;

      for (const update of updates) {
        const result = await this.processUpdateToThread(update, working);
        if (result) {
          allThreads.add(result.threadRelPath);
          if (result.newThread) created.push(result.threadRelPath);
          if (result.personFile) allPeopleFiles.push(result.personFile);
          if (result.personCard) allPersonCards.push(result.personCard);
        }
        offset = update.update_id + 1;
      }

      // Persist offset + any new chat mappings after each batch as a delta into
      // fresh state; the returned merged state becomes the working copy so it
      // now reflects any concurrent writes too.
      const lastUpdate = updates[updates.length - 1];
      invariant(lastUpdate !== undefined, "updates is non-empty here (checked above)");
      const batchMax = lastUpdate.update_id;
      working = await updateTransientState<TelegramState>({
        boxRoot: this.boxRoot,
        connectorName: "telegram",
        defaultValue: {},
        update: (fresh) => mergeIngestState(fresh, { ...working, lastUpdateId: batchMax }),
      });
    }

    // Commit all thread changes, people files, and seeded person cards in one
    // path-scoped commit (Track 2). Person cards are staged internally by
    // telegram-ingest, so they must be named here or a scoped commit leaves
    // them staged-but-uncommitted.
    const filesToStage = [...allThreads, ...allPeopleFiles, ...allPersonCards];
    const jobs: string[] = [];

    if (filesToStage.length > 0) {
      const msgCount = allThreads.size;
      await stageAndCommitPaths(this.boxRoot, {
        paths: filesToStage,
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
        await stageAndCommitPaths(this.boxRoot, {
          paths: jobs,
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

    const slug = await boxSlug(this.boxRoot);
    // publicUrl includes the box slug (e.g. https://box.example.com/ledger)
    // but webhook routes are at the server root, so strip the trailing path segment
    const baseUrl = new URL(publicUrl);
    baseUrl.pathname = baseUrl.pathname.replace(/\/[^/]+\/?$/, "");
    const basePath = baseUrl.pathname.replace(/\/+$/, "");
    const webhookUrl = `${baseUrl.origin}${basePath}/webhook/${slug}/telegram`;

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
    // Capture the exact timer value we fire on, so the delete below removes only
    // the timer we handled — never a fresher timer a concurrent sendOutbound
    // re-added for the same thread between our read and the write (Track 1).
    const fired: Array<{ threadRef: string; at: string }> = [];

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
        fired.push({ threadRef, at: timer.at });
      }
    }

    if (fired.length > 0) {
      // Delta against fresh state: remove only the exact timers we fired,
      // preserving any callbacks a concurrent writer added.
      await updateTransientState<TelegramState>({
        boxRoot: this.boxRoot,
        connectorName: "telegram",
        defaultValue: {},
        update: (fresh) => {
          const freshCallbacks = { ...(fresh.callbacks ?? {}) };
          for (const { threadRef, at } of fired) {
            if (freshCallbacks[threadRef]?.at === at) delete freshCallbacks[threadRef];
          }
          return { ...fresh, callbacks: freshCallbacks };
        },
      });
    }

    if (jobs.length > 0) {
      await stageAndCommitPaths(this.boxRoot, {
        paths: jobs,
        message: `Create callback job${jobs.length === 1 ? "" : "s"} for Telegram`,
        trailers: {
          "Created-By": "telegram-connector",
          ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}),
        },
      });
    }

    return jobs;
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

// processWebhookUpdate lives in ./telegram-webhook.js (kept out of this file for
// the line cap); re-exported below so importers of "./telegram.js" are unchanged.
