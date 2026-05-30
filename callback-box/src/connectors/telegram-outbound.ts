/**
 * Outbound Telegram delivery: scan chat-thread files for unsent agent messages,
 * send them via the Telegram service, stamp them as sent, and record any
 * callback timers requested by a trailing <seen callback-in="..."> entry.
 */

import * as path from "node:path";
import { glob } from "glob";
import type { ChatThreadFields } from "../schemas/chat-thread.js";
import { stageFiles, commit } from "../cli/lib/git.js";
import { loadTransientState, saveTransientState } from "./transient-state.js";
import { findUnsentAgentMessages, stampSentMessage } from "./chat-utils.js";
import { parseDuration } from "./telegram-helpers.js";
import type { TelegramState } from "./telegram-types.js";
import type { TelegramService } from "../services/telegram.js";

interface OutboundContext {
  boxRoot: string;
  triggeredBy: string | undefined;
  tg: TelegramService;
}

/**
 * Send outbound messages: scan thread files for unsent agent messages.
 * Returns the relative paths of threads that had messages pushed.
 */
export async function sendOutbound(ctx: OutboundContext): Promise<string[]> {
  const { boxRoot } = ctx;
  const chatDir = path.join(boxRoot, "store/chat/telegram");
  let threadPaths: string[];
  try {
    threadPaths = await glob("*/thread.chat-thread.card", { cwd: chatDir });
  } catch (e) {
    console.warn(`Could not glob Telegram thread files in ${chatDir}, skipping outbound send: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }

  if (threadPaths.length === 0) return [];

  const pushed: string[] = [];
  for (const relThread of threadPaths) {
    const absPath = path.join(chatDir, relThread);
    const threadRelPath = path.relative(boxRoot, absPath);
    try {
      const sent = await sendThreadOutbound(ctx, { absPath, threadRelPath });
      if (sent) pushed.push(threadRelPath);
    } catch (err) {
      console.error(`Failed to send outbound for ${threadRelPath}: ${(err as Error).message}`);
    }
  }

  return pushed;
}

/**
 * Send any unsent agent messages for a single thread file. Returns true if the
 * thread had messages sent (and was committed).
 */
async function sendThreadOutbound(
  ctx: OutboundContext,
  opts: { absPath: string; threadRelPath: string }
): Promise<boolean> {
  const { boxRoot, triggeredBy, tg } = ctx;
  const { absPath, threadRelPath } = opts;

  const { fields, unsent } = await findUnsentAgentMessages(absPath);
  if (unsent.length === 0) return false;

  const chatId = fields["chat-id"];
  if (!chatId) return false;

  // Record callback-in from trailing seen entry for later
  await recordCallbackTimers(boxRoot, { fields, threadRelPath });

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
  await stageFiles(boxRoot, [threadRelPath]);
  const slug = path.basename(path.dirname(threadRelPath));
  await commit(boxRoot, {
    message: `Send telegram message to ${slug}`,
    trailers: {
      "Pushed-By": "telegram-connector",
      ...(triggeredBy ? { "Triggered-By": triggeredBy } : {}),
    },
  });

  return true;
}

/**
 * Scan for <seen callback-in="..."> elements and record timers in state.
 */
async function recordCallbackTimers(
  boxRoot: string,
  opts: { fields: ChatThreadFields; threadRelPath: string }
): Promise<void> {
  const { fields, threadRelPath } = opts;
  const entries = fields.entries ?? [];
  const lastEntry = entries[entries.length - 1];
  if (!lastEntry || lastEntry.kind !== "seen") return;

  const callbackIn = lastEntry["callback-in"];
  if (!callbackIn) return;

  const durationMs = parseDuration(callbackIn);
  if (!durationMs) return;

  const state = await loadTransientState<TelegramState>({
    boxRoot,
    connectorName: "telegram",
    defaultValue: {},
  });

  const callbacks = state.callbacks ?? {};
  const at = new Date(Date.now() + durationMs).toISOString();
  callbacks[threadRelPath] = { at };
  state.callbacks = callbacks;

  await saveTransientState({
    boxRoot,
    connectorName: "telegram",
    data: state,
  });
}
