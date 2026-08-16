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
import type { EventBus } from "../../core/event-bus.js";
import {
  loadTelegramConfig,
  processWebhookUpdate,
  extractMessage,
  type TelegramUpdate,
} from "../../connectors/telegram.js";
import { telegramUpdateSchema } from "../../services/telegram-schemas.js";
import { ChatSessionPool } from "../../core/chat/session/pool.js";
import { sendTelegramMessage, startTypingIndicator } from "../../core/telegram-send.js";
import { appendMessageToThread } from "../../connectors/chat-utils.js";
import { stageAndCommitPaths } from "../../lib/git.js";
import { trackMutationStart } from "../../lib/dev-bundle-reload.js";

interface RegisterTelegramRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
  eventBus: EventBus;
}

export async function registerTelegramRoutes(opts: RegisterTelegramRoutesOptions): Promise<void> {
  const { server, boxRoot, eventBus } = opts;

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

    // Validate the untyped webhook body once, at the boundary (Track D.2): a
    // shape that doesn't match the narrow update schema is rejected loudly
    // instead of casting through to silent undefineds downstream.
    const parsed = telegramUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid update" });
    }
    const update: TelegramUpdate = parsed.data;
    const extracted = extractMessage(update);
    if (!extracted) {
      return reply.status(200).send({ ok: true });
    }

    const chatId = extracted.msg.chat.id;

    try {
      // Append message to thread, commit (skip job creation — we handle directly)
      const result = await processWebhookUpdate({ boxRoot, update, skipJob: true });

      if (result) {
        eventBus.emit("cards-changed", { source: "telegram" });

        const chatDescription = extracted.msg.chat.title ?? extracted.senderName;

        // Fire-and-forget: send to pool, deliver responses, archive
        const finishBackgroundWork = trackMutationStart();
        void handleChatMessage({
          pool,
          boxRoot,
          threadRef: result.threadRef,
          chatDescription,
          messageText: extracted.text,
          senderName: extracted.senderName,
          senderRef: result.personRef,
          chatId,
          botToken: config.botToken,
          eventBus,
        })
          .catch((err) => {
            console.error(`[telegram-webhook] Pool handling failed: ${err}`);
          })
          .finally(finishBackgroundWork);
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
  senderRef: string | null;
  chatId: number;
  botToken: string;
  eventBus: EventBus;
}

/**
 * Send a message to the persistent session. Responses are delivered eagerly
 * to Telegram as soon as each <chat-response> tag is intercepted from the
 * agent's output stream — the agent may continue working after responding.
 */
async function handleChatMessage(opts: HandleChatMessageOptions): Promise<void> {
  const { pool, boxRoot, threadRef, chatDescription, messageText, senderName, senderRef, chatId, botToken, eventBus } = opts;
  const slug = path.basename(path.dirname(threadRef));

  // Persistent delivery callback — sends to Telegram + archives.
  // Stored by the pool for reuse when schedules fire.
  const deliverResponse = async (text: string) => {
    let messageId: string | undefined;
    try {
      const sent = await sendTelegramMessage({ botToken, chatId, text });
      messageId = String(sent.messageId);
    } catch (err) {
      console.error(`[telegram] Failed to send response: ${err}`);
    }

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

      // Path-scoped commit (Track 2): third of the three commit sites in the
      // one logical Telegram webhook flow — the inbound message + optional chat
      // job commit from `processWebhookUpdate` (connectors/telegram.ts), and
      // this outbound chat-response commit. Scoping to `threadRef` keeps a
      // concurrent mutator's unrelated staged files off this commit.
      await stageAndCommitPaths(boxRoot, {
        paths: [threadRef],
        message: `Chat response in ${slug}`,
        trailers: { "Sent-By": "telegram-chat-pool" },
      });

      eventBus.emit("cards-changed", { source: "telegram" });
    } catch (err) {
      console.error(`[telegram] Failed to archive response in ${slug}: ${err}`);
    }
  };

  // Show "typing..." indicator until agent responds or turn ends
  const stopTyping = startTypingIndicator({ botToken, chatId });
  const onResponse = async (text: string) => {
    stopTyping();
    await deliverResponse(text);
  };

  // Wrap message with sender identity so the agent knows who's talking
  const refAttr = senderRef ? ` ref="${senderRef}"` : "";
  const wrappedMessage = `<chat-message from="${senderName}"${refAttr}>${messageText}</chat-message>`;

  try {
    await pool.send({
      threadRef,
      message: wrappedMessage,
      chatDescription,
      onResponse,
      deliverResponse,
    });
  } finally {
    // Ensure typing indicator is stopped even if send fails
    stopTyping();
  }
}
