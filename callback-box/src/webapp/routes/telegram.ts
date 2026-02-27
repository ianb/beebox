/**
 * Telegram webhook route.
 *
 * POST /api/telegram/webhook — receives updates from Telegram's Bot API.
 * Validates the secret token header, processes the update synchronously
 * (appends to chat thread, commits, creates chat job), then returns 200.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { BroadcastEventFn } from "./sse.js";
import {
  loadTelegramConfig,
  processWebhookUpdate,
  type TelegramUpdate,
} from "../../connectors/telegram.js";

interface RegisterTelegramRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
  broadcastEvent: BroadcastEventFn;
}

export async function registerTelegramRoutes(opts: RegisterTelegramRoutesOptions): Promise<void> {
  const { server, boxRoot, broadcastEvent } = opts;

  server.post("/api/telegram/webhook", async (request: FastifyRequest, reply: FastifyReply) => {
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

    try {
      const cardPath = await processWebhookUpdate({ boxRoot, update });

      if (cardPath) {
        broadcastEvent("cards-changed", { source: "telegram" });
      }

      return reply.status(200).send({ ok: true });
    } catch (err) {
      request.log.error(err, "Telegram webhook processing failed");
      // Return 200 anyway so Telegram doesn't retry
      return reply.status(200).send({ ok: true, error: "processing failed" });
    }
  });
}
