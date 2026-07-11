/**
 * Command execution routes for the webapp.
 *
 * These routes provide a streaming interface to execute commands
 * that are shared between CLI and web.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import {
  runCommand,
  type CommandContext,
} from "../../core/commands/index.js";
import type { EventBus } from "../../core/event-bus.js";
import { mimetypeToExtension } from "../../lib/mimetype.js";

/**
 * Output line for streaming command execution.
 */
export interface OutputLine {
  type: "output" | "result";
  text?: string;
  success?: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Execute a command, emitting OutputLine messages via the callback.
 *
 * Returns the final result. This is the testable core of streaming command
 * execution — the route handler just wires `emit` to SSE format.
 */
export async function executeCommandStreaming(options: {
  command: string;
  args: Record<string, unknown>;
  boxRoot: string;
  emit: (line: OutputLine) => void;
}): Promise<OutputLine> {
  const { command, args, boxRoot, emit } = options;

  const ctx: CommandContext = {
    boxRoot,
    write: (text: string) => emit({ type: "output", text }),
    writeLine: (text: string) => emit({ type: "output", text }),
  };

  try {
    const result = await runCommand({ name: command, args, ctx });
    const resultLine: OutputLine = result.success
      ? { type: "result", success: true, data: result.data }
      : { type: "result", success: false, data: result.data, error: result.error ?? "Unknown error" };
    emit(resultLine);
    return resultLine;
  } catch (error) {
    const errorLine: OutputLine = {
      type: "result",
      success: false,
      error: (error as Error).message,
    };
    emit(errorLine);
    return errorLine;
  }
}

interface RegisterCommandRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
  eventBus: EventBus;
}

/**
 * Register command routes on the Fastify server.
 */
export async function registerCommandRoutes(
  options: RegisterCommandRoutesOptions
): Promise<void> {
  const { server } = options;
  // POST /api/upload - Upload a file to temp storage
  server.post("/api/upload", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: "No file uploaded" });
      }

      // Get the file buffer
      const buffer = await data.toBuffer();
      const mimetype = data.mimetype;

      // Create temp directory if needed
      const tempDir = path.join(os.tmpdir(), "callback-box-uploads");
      await fs.mkdir(tempDir, { recursive: true });

      // Determine file extension from mimetype
      const ext = mimetypeToExtension(mimetype);

      // Generate unique filename
      const filename = `${randomUUID()}${ext}`;
      const tempPath = path.join(tempDir, filename);

      // Write file
      await fs.writeFile(tempPath, buffer);

      return {
        success: true,
        path: tempPath,
        mimetype,
        size: buffer.length,
      };
    } catch (error) {
      return reply.status(500).send({
        error: "Failed to upload file",
        details: (error as Error).message,
      });
    }
  });
}

