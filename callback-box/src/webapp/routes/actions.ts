/**
 * Action routes for the webapp.
 *
 * These routes handle mutations and trigger processing.
 * Most actions now delegate to the command runner for shared logic.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { EventBus } from "../../core/event-bus.js";
import {
  runCommand,
  type CommandContext,
} from "../../core/commands/index.js";

interface CreateBody {
  path: string;
  template: string;
  args?: Record<string, unknown>;
}

interface RegisterActionRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
  eventBus: EventBus;
}

// Note: POST /api/actions/wakeup was removed. The box agent runs the wakeup
// cycle (scheduler / `cb wakeup`); the web UI no longer triggers it directly.
// POST /api/actions/answer was removed too — answering (and dismissing) a
// question is the tRPC `actions.answer`/`actions.dismiss` mutation the frontend
// actually uses; this raw duplicate was dead weight (principle 8, one way).

/**
 * Handle POST /api/actions/create - Create a card.
 */
async function handleCreate(args: {
  request: FastifyRequest<{ Body: CreateBody | undefined }>;
  reply: FastifyReply;
  boxRoot: string;
  eventBus: EventBus;
}): Promise<unknown> {
  const { request, reply, boxRoot, eventBus } = args;
  const { path: cardPath, template, args: templateArgs } = request.body ?? {};

  if (!cardPath) {
    return reply.status(400).send({ error: "path is required" });
  }
  if (!template) {
    return reply.status(400).send({ error: "template is required" });
  }

  const ctx: CommandContext = {
    boxRoot,
    write: () => {},
    writeLine: () => {},
  };

  try {
    const result = await runCommand({
      name: "create",
      args: {
        path: cardPath,
        template,
        args: templateArgs,
        commit: true, // Always commit from web API
      },
      ctx,
    });

    if (!result.success) {
      return reply.status(400).send({ error: result.error });
    }

    // Broadcast
    eventBus.emit("card-created", {
      path: cardPath,
      template,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      path: cardPath,
    };
  } catch (error) {
    return reply.status(500).send({
      error: "Failed to create card",
      details: (error as Error).message,
    });
  }
}

/**
 * Register action routes on the Fastify server.
 */
export async function registerActionRoutes(
  options: RegisterActionRoutesOptions
): Promise<void> {
  const { server, boxRoot, eventBus } = options;

  // POST /api/actions/create - Create a card
  server.post<{ Body: CreateBody | undefined }>("/api/actions/create", async (request, reply) =>
    handleCreate({ request, reply, boxRoot, eventBus })
  );

}
