/**
 * Webhook-side ingest for the Telegram connector: append a pushed update to its
 * thread, commit, and (optionally) create a chat job. Split out of
 * `telegram.ts` to keep that file under the line cap (precedent:
 * telegram-outbound / telegram-helpers).
 */

import * as path from "node:path";
import { stageAndCommitPaths } from "../lib/git.js";
import { updateTransientState } from "./transient-state.js";
import { createChatJob } from "./chat-utils.js";
import { processUpdateToThread, type IngestResult } from "./telegram-ingest.js";
import type { TelegramState, TelegramUpdate } from "./telegram-types.js";

/**
 * Process a webhook update — used by the webhook route.
 * Appends to a thread file, commits, and creates a chat job.
 * Returns the thread relative path, or null if the update was skipped.
 *
 * The transient-state read-modify-write is split into two independent
 * `updateTransientState` calls, each a delta against FRESH state (Track 1), so
 * the transient-state lock is never held across the git commits in between and
 * an interleaved catch-up poll can't lose this update's progress:
 *
 *   1. Before the commits: ingest the message, persisting any new chat mappings.
 *   2. After the commits: advance `lastUpdateId` to `max(current, this update)`.
 */
export async function processWebhookUpdate(opts: {
  boxRoot: string;
  update: TelegramUpdate;
  /** When true, skip chat job creation (caller handles response directly) */
  skipJob?: boolean | undefined;
}): Promise<{ threadRef: string; personRef: string | null } | null> {
  const { boxRoot, update, skipJob } = opts;

  // Call 1: ingest + persist chat-mapping delta. processUpdateToThread mutates
  // `state.chatMappings` (via getChatSlug) in place; returning that same fresh
  // object preserves a concurrent writer's lastUpdateId/callbacks. The lock is
  // released before the git commits below — we never hold it across a commit.
  //
  // A holder object (rather than a captured `let`) sidesteps a TypeScript
  // narrowing false-positive: the checker otherwise treats a bare `let`
  // reassigned inside this closure as unconditionally written by the time
  // `updateTransientState` resolves, which isn't true — processUpdateToThread
  // genuinely returns null for update types extractMessage() doesn't handle
  // (e.g. edited_message, channel_post).
  const holder: { ingested: IngestResult | null } = { ingested: null };
  await updateTransientState<TelegramState>({
    boxRoot,
    connectorName: "telegram",
    defaultValue: {},
    update: async (state) => {
      holder.ingested = await processUpdateToThread({ boxRoot, update, state });
      return state;
    },
  });
  if (!holder.ingested) return null;
  const result: IngestResult = holder.ingested;

  // Commit the thread file + any people files/cards (Track 2). Path-scoped so a
  // concurrent mutator's staged files aren't co-committed. FIRST of the three
  // commit sites in the one logical webhook flow — see the chat-job commit
  // below and the chat-response commit in webapp/routes/telegram.ts.
  const filesToStage = [result.threadRelPath];
  if (result.personFile) filesToStage.push(result.personFile);
  // Person card is staged internally by telegram-ingest; a scoped commit only
  // commits paths it names, so it must be listed here too.
  if (result.personCard) filesToStage.push(result.personCard);

  await stageAndCommitPaths(boxRoot, {
    paths: filesToStage,
    message: `Telegram: ${result.senderName} in ${path.basename(path.dirname(result.threadRelPath))}`,
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
    // SECOND commit site of the one logical webhook flow (see the thread commit
    // above and the chat-response commit in webapp/routes/telegram.ts).
    await stageAndCommitPaths(boxRoot, {
      paths: [jobPath],
      message: "Create chat job for Telegram message",
      trailers: { "Created-By": "telegram-webhook" },
    });
  }

  // Call 2: advance lastUpdateId so catch-up polling doesn't re-process this
  // update. Expressed as a delta (max of current and this update) against fresh
  // state so an interleaved catch-up poll and this webhook can't clobber each
  // other's progress.
  await updateTransientState<TelegramState>({
    boxRoot,
    connectorName: "telegram",
    defaultValue: {},
    update: (state) => ({
      ...state,
      lastUpdateId: Math.max(state.lastUpdateId ?? 0, update.update_id),
    }),
  });

  return { threadRef: result.threadRelPath, personRef: result.personRef };
}
