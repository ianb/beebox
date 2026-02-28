/**
 * Telegram webhook route.
 *
 * POST /webhook/<box>/telegram — receives updates from Telegram's Bot API.
 * Validates the secret token header, appends the message to the thread,
 * then routes it to a persistent per-thread Claude session via ChatSessionPool.
 * Responses are sent directly to Telegram via the Bot API as soon as
 * <chat-response> tags are intercepted from the agent's output stream.
 */

import * as path from "node:path";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { BroadcastEventFn } from "./sse.js";
import {
  loadTelegramConfig,
  processWebhookUpdate,
  extractMessage,
  type TelegramUpdate,
} from "../../connectors/telegram.js";
import { ChatSessionPool } from "../../core/chat-session-pool.js";
import { sendTelegramMessage, startTypingIndicator } from "../../core/telegram-send.js";
import { appendMessageToThread } from "../../connectors/chat-utils.js";
import { stageFiles, commit } from "../../cli/lib/git.js";

interface RegisterTelegramRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
  broadcastEvent: BroadcastEventFn;
}

export async function registerTelegramRoutes(opts: RegisterTelegramRoutesOptions): Promise<void> {
  const { server, boxRoot, broadcastEvent } = opts;

  // Singleton pool for this box
  const pool = new ChatSessionPool(boxRoot);

  server.post("/telegram", async (request: FastifyRequest, reply: FastifyReply) => {
    const config = await loadTelegramConfig(boxRoot);
    if (!config) {
      return reply.status(404).send({ error: "Telegram not configured" });
    }

    // Validate secret token
    const secretHeader = request.headers["x-telegram-bot-api-secret-token"];
    if (secretHeader !== config.webhookSecret) {
      return reply.status(403).send({ error: "Invalid secret token" });
    }

    const body = request.body as Record<string, unknown>;
    if (!body || typeof body.update_id !== "number") {
      return reply.status(400).send({ error: "Invalid update" });
    }

    const update = body as unknown as TelegramUpdate;
    const extracted = extractMessage(update);
    if (!extracted) {
      return reply.status(200).send({ ok: true });
    }

    const chatId = extracted.msg.chat.id;

    try {
      // Append message to thread, commit (skip job creation — we handle directly)
      const threadRef = await processWebhookUpdate({ boxRoot, update, skipJob: true });

      if (threadRef) {
        broadcastEvent("cards-changed", { source: "telegram" });

        const chatDescription = extracted.msg.chat.title ?? extracted.senderName;

        // Fire-and-forget: send to pool, deliver responses, archive
        handleChatMessage({
          pool,
          boxRoot,
          threadRef,
          chatDescription,
          messageText: extracted.text,
          senderName: extracted.senderName,
          chatId,
          botToken: config.botToken,
          broadcastEvent,
        }).catch((err) => {
          console.error(`[telegram-webhook] Pool handling failed: ${err}`);
        });
      }

      return reply.status(200).send({ ok: true });
    } catch (err) {
      request.log.error(err, "Telegram webhook processing failed");
      // Return 200 anyway so Telegram doesn't retry
      return reply.status(200).send({ ok: true, error: "processing failed" });
    }
  });
}

interface HandleChatMessageOptions {
  pool: ChatSessionPool;
  boxRoot: string;
  threadRef: string;
  chatDescription: string;
  messageText: string;
  senderName: string;
  chatId: number;
  botToken: string;
  broadcastEvent: BroadcastEventFn;
}

/**
 * Send a message to the persistent session. Responses are delivered eagerly
 * to Telegram as soon as each <chat-response> tag is intercepted from the
 * agent's output stream — the agent may continue working after responding.
 */
async function handleChatMessage(opts: HandleChatMessageOptions): Promise<void> {
  const { pool, boxRoot, threadRef, chatDescription, messageText, senderName, chatId, botToken, broadcastEvent } = opts;
  const slug = path.basename(path.dirname(threadRef));

  // Show "typing..." indicator until agent responds or turn ends
  const stopTyping = startTypingIndicator({ botToken, chatId });

  const onResponse = async (text: string) => {
    // Stop typing indicator once first response arrives
    stopTyping();

    // Send to Telegram immediately
    let messageId: string | undefined;
    try {
      const sent = await sendTelegramMessage({ botToken, chatId, text });
      messageId = String(sent.messageId);
    } catch (err) {
      console.error(`[telegram-webhook] Failed to send response: ${err}`);
    }

    // Archive to thread file
    try {
      await appendMessageToThread({
        boxRoot,
        threadRelPath: threadRef,
        message: {
          sender: "agent",
          sent: new Date().toISOString(),
          ...(messageId ? { id: messageId } : {}),
          text,
        },
      });

      await stageFiles(boxRoot, [threadRef]);
      await commit(boxRoot, {
        message: `Chat response to ${senderName} in ${slug}`,
        trailers: { "Sent-By": "telegram-chat-pool" },
      });

      broadcastEvent("cards-changed", { source: "telegram" });
    } catch (err) {
      console.error(`[telegram-webhook] Failed to archive response in ${slug}: ${err}`);
    }
  };

  try {
    await pool.send({
      threadRef,
      message: messageText,
      chatDescription,
      onResponse,
    });
  } finally {
    // Ensure typing indicator is stopped even if send fails
    stopTyping();
  }
}
