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

interface AnswerBody {
  questionPath: string;
  answer: string;
  selectedId?: string;
}

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

/**
 * Handle POST /api/actions/answer - Answer a question.
 */
async function handleAnswer(args: {
  request: FastifyRequest<{ Body: AnswerBody }>;
  reply: FastifyReply;
  boxRoot: string;
  eventBus: EventBus;
}): Promise<unknown> {
  const { request, reply, boxRoot, eventBus } = args;
  const { questionPath, answer, selectedId } = request.body ?? {};

  if (!questionPath) {
    return reply.status(400).send({ error: "questionPath is required" });
  }
  if (!answer && !selectedId) {
    return reply.status(400).send({ error: "answer or selectedId is required" });
  }

  const ctx: CommandContext = {
    boxRoot,
    write: () => {},
    writeLine: () => {},
  };

  try {
    const result = await runCommand({
      name: "answer",
      args: {
        question: questionPath,
        answer: answer,
        selectedId: selectedId,
        via: "web",
      },
      ctx,
    });

    if (!result.success) {
      return reply.status(400).send({ error: result.error });
    }

    // Broadcast the change
    eventBus.emit("question-answered", {
      path: questionPath,
      answer,
      selectedId,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      message: "Question answered",
      path: questionPath,
    };
  } catch (error) {
    return reply.status(500).send({
      error: "Failed to answer question",
      details: (error as Error).message,
    });
  }
}

/**
 * Handle POST /api/actions/create - Create a card.
 */
async function handleCreate(args: {
  request: FastifyRequest<{ Body: CreateBody }>;
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

  // POST /api/actions/answer - Answer a question
  server.post<{ Body: AnswerBody }>("/api/actions/answer", async (request, reply) =>
    handleAnswer({ request, reply, boxRoot, eventBus })
  );

  // POST /api/actions/create - Create a card
  server.post<{ Body: CreateBody }>("/api/actions/create", async (request, reply) =>
    handleCreate({ request, reply, boxRoot, eventBus })
  );

}
