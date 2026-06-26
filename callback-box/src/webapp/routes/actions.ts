/**
 * Action routes for the webapp.
 *
 * These routes handle mutations and trigger processing.
 * Most actions now delegate to the command runner for shared logic.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
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

/**
 * Determine the file extension to use for an uploaded audio buffer
 * based on its mimetype.
 */
function audioExtensionFor(mimetype: string): string {
  if (mimetype === "audio/webm") return ".webm";
  if (mimetype === "audio/mp3" || mimetype === "audio/mpeg") return ".mp3";
  if (mimetype === "audio/wav") return ".wav";
  if (mimetype === "audio/ogg") return ".ogg";
  if (mimetype === "audio/m4a" || mimetype === "audio/mp4") return ".m4a";
  if (mimetype === "audio/flac") return ".flac";
  return ".webm";
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
 * Handle POST /api/actions/create-voice-memo - Create a voice memo with audio file.
 * This route uploads the audio file to temp, then calls the create command with attachment.
 */
async function handleCreateVoiceMemo(args: {
  request: FastifyRequest;
  reply: FastifyReply;
  boxRoot: string;
  eventBus: EventBus;
}): Promise<unknown> {
  const { request, reply, boxRoot, eventBus } = args;
  try {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: "No file uploaded" });
    }

    // Get the audio file buffer
    const audioBuffer = await data.toBuffer();
    const mimetype = data.mimetype;

    // Determine file extension from mimetype
    const ext = audioExtensionFor(mimetype);

    // Save to temp file
    const tempDir = path.join(os.tmpdir(), "callback-box-uploads");
    await fs.mkdir(tempDir, { recursive: true });
    const tempPath = path.join(tempDir, `${randomUUID()}${ext}`);
    await fs.writeFile(tempPath, audioBuffer);

    // Generate a name from timestamp
    const now = new Date();
    const name = `Voice_Memo_${now.toISOString().replace(/[.:]/g, "-").slice(0, 19)}`;
    const cardPath = `box/inbox/${name}.memo.card`;

    const ctx: CommandContext = {
      boxRoot,
      write: () => {},
      writeLine: () => {},
    };

    const result = await runCommand({
      name: "create",
      args: {
        path: cardPath,
        template: "voice-memo",
        attachment: tempPath,
        attachmentMimetype: mimetype,
        commit: true,
      },
      ctx,
    });

    // Clean up temp file
    try {
      await fs.unlink(tempPath);
    } catch (e) {
      console.warn(`Failed to clean up temp upload file ${tempPath}:`, e);
    }

    if (!result.success) {
      return reply.status(500).send({
        error: "Failed to create voice memo",
        details: result.error,
      });
    }

    const resultData = result.data as { cardPath: string; attachmentPath?: string };

    // Broadcast
    eventBus.emit("card-created", {
      path: resultData.cardPath,
      template: "voice-memo",
      audioPath: resultData.attachmentPath,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      path: resultData.cardPath,
      audioPath: resultData.attachmentPath,
    };
  } catch (error) {
    return reply.status(500).send({
      error: "Failed to create voice memo",
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

  // POST /api/actions/create-voice-memo - Create a voice memo with audio file
  server.post("/api/actions/create-voice-memo", async (request: FastifyRequest, reply) =>
    handleCreateVoiceMemo({ request, reply, boxRoot, eventBus })
  );
}
