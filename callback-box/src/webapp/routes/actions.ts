/**
 * Action routes for the webapp.
 *
 * These routes handle mutations and trigger processing.
 * Most actions now delegate to the command runner for shared logic.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import type { BroadcastEventFn } from "./sse.js";
import {
  runCommand,
  type CommandContext,
} from "../../core/commands/index.js";

interface AnswerBody {
  questionPath: string;
  answer: string;
  selectedId?: string;
}

interface WakeupBody {
  dryRun?: boolean;
}

interface CreateBody {
  path: string;
  template: string;
  args?: Record<string, unknown>;
}

interface RegisterActionRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
  broadcastEvent: BroadcastEventFn;
}

/**
 * Register action routes on the Fastify server.
 */
export async function registerActionRoutes(
  options: RegisterActionRoutesOptions
): Promise<void> {
  const { server, boxRoot, broadcastEvent } = options;
  // POST /api/actions/wakeup - Trigger processing
  server.post<{ Body: WakeupBody }>("/api/actions/wakeup", async (request, reply) => {
    const dryRun = request.body?.dryRun ?? false;

    // Broadcast that wakeup is starting
    broadcastEvent("wakeup-start", {
      timestamp: new Date().toISOString(),
      dryRun,
    });

    // Collect log messages to return
    const logs: string[] = [];
    const ctx: CommandContext = {
      boxRoot,
      write: (msg: string) => {
        logs.push(msg);
        console.log(msg);
      },
      writeLine: (msg: string) => {
        logs.push(msg);
        console.log(msg);
      },
    };

    try {
      const result = await runCommand({ name: "wakeup", args: { dryRun }, ctx });

      // Broadcast completion
      broadcastEvent("wakeup-complete", {
        timestamp: new Date().toISOString(),
        success: result.success,
        phases: (result.data as { phases?: unknown })?.phases,
      });

      if (!result.success) {
        return reply.status(500).send({
          success: false,
          error: result.error,
          phases: (result.data as { phases?: unknown })?.phases,
          logs,
        });
      }

      return {
        success: true,
        message: dryRun ? "Wakeup completed (dry run)" : "Wakeup completed",
        phases: (result.data as { phases?: unknown })?.phases,
        logs,
      };
    } catch (error) {
      broadcastEvent("wakeup-error", {
        timestamp: new Date().toISOString(),
        error: (error as Error).message,
      });

      return reply.status(500).send({
        success: false,
        error: (error as Error).message,
        logs,
      });
    }
  });

  // POST /api/actions/answer - Answer a question
  server.post<{ Body: AnswerBody }>("/api/actions/answer", async (request, reply) => {
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
      broadcastEvent("question-answered", {
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
  });

  // POST /api/actions/create - Create a card
  server.post<{ Body: CreateBody }>("/api/actions/create", async (request, reply) => {
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
      broadcastEvent("card-created", {
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
  });

  // POST /api/actions/create-voice-memo - Create a voice memo with audio file
  // This route uploads the audio file to temp, then calls the create command with attachment
  server.post("/api/actions/create-voice-memo", async (request: FastifyRequest, reply) => {
    try {
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: "No file uploaded" });
      }

      // Get the audio file buffer
      const audioBuffer = await data.toBuffer();
      const mimetype = data.mimetype;

      // Determine file extension from mimetype
      let ext = ".webm";
      if (mimetype === "audio/webm") ext = ".webm";
      else if (mimetype === "audio/mp3" || mimetype === "audio/mpeg") ext = ".mp3";
      else if (mimetype === "audio/wav") ext = ".wav";
      else if (mimetype === "audio/ogg") ext = ".ogg";
      else if (mimetype === "audio/m4a" || mimetype === "audio/mp4") ext = ".m4a";
      else if (mimetype === "audio/flac") ext = ".flac";

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
      } catch {
        // Ignore cleanup errors
      }

      if (!result.success) {
        return reply.status(500).send({
          error: "Failed to create voice memo",
          details: result.error,
        });
      }

      const resultData = result.data as { cardPath: string; attachmentPath?: string };

      // Broadcast
      broadcastEvent("card-created", {
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
  });
}
