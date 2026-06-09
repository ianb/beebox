/**
 * REST API routes for the webapp.
 *
 * This module owns the small, stateless summary endpoints (health, status,
 * inbox, questions, activity, context, task-output) and wires up the larger,
 * self-contained route families that live in sibling modules:
 *
 *   api-card-routes.ts — GET/PATCH /api/card/* (helpers in api-card-patch.ts)
 *   api-browse.ts      — GET /api/browse/*
 *   api-files.ts       — GET/HEAD + DELETE /api/files/*
 *   api-debug-log.ts   — GET/POST/DELETE /api/debug-log
 */

import type { FastifyInstance } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getSystemState } from "../../core/state.js";
import { generateContext } from "../context.js";
import { runHealthChecks } from "../trpc/routers/health.js";
import { getLog } from "../../cli/lib/git.js";
import type { EventBus } from "../../core/event-bus.js";
import { registerApiCardRoutes } from "./api-card-routes.js";
import { registerApiBrowseRoutes } from "./api-browse.js";
import { registerApiFilesRoutes } from "./api-files.js";
import { registerApiExternalRoute } from "./api-external.js";
import { registerApiDebugLogRoutes } from "./api-debug-log.js";
import { registerApiImageRoutes } from "./api-image.js";

/**
 * Register API routes on the Fastify server.
 */
interface RegisterApiRoutesOptions {
  boxRoot: string;
  eventBus: EventBus;
}

export async function registerApiRoutes(
  server: FastifyInstance,
  options: RegisterApiRoutesOptions,
): Promise<void> {
  const { boxRoot, eventBus } = options;
  // GET /api/health - Health check (permissions, API keys)
  server.get("/api/health", async () => {
    const checks = await runHealthChecks(boxRoot);
    const hasErrors = checks.some((c) => !c.ok && c.severity === "error");
    const hasWarnings = checks.some((c) => !c.ok && c.severity === "warning");
    const status = hasErrors ? "unhealthy" : hasWarnings ? "degraded" : "healthy";
    return { status, checks };
  });

  // GET /api/status - System state summary
  server.get("/api/status", async () => {
    const state = await getSystemState(boxRoot);
    return {
      boxRoot: state.boxRoot,
      boxVersion: state.boxVersion,
      created: state.created,
      git: state.git,
      counts: {
        inbox: state.inbox.length,
        questions: state.questions.length,
        pendingQuestions: state.questions.filter(q => q.status === "pending").length,
      },
    };
  });

  // GET /api/inbox - List inbox cards
  server.get("/api/inbox", async () => {
    const state = await getSystemState(boxRoot);
    return {
      items: state.inbox,
    };
  });

  // GET /api/questions - List question cards
  server.get("/api/questions", async () => {
    const state = await getSystemState(boxRoot);
    const context = await generateContext(boxRoot);

    // Enrich questions with prompt data from context
    const enriched = state.questions.map(q => {
      const pending = context.pendingQuestions.find(p => p.path === q.relativePath);
      return {
        ...q,
        prompt: pending?.prompt,
        options: pending?.options,
      };
    });

    return {
      items: enriched,
    };
  });

  // /api/card/* — load + patch a single card
  registerApiCardRoutes({ server, boxRoot });

  // GET /api/activity - Recent git commits (renamed from /api/log to avoid ad blockers)
  server.get<{ Querystring: { count?: string } }>("/api/activity", async (request) => {
    const count = parseInt(request.query.count ?? "10", 10);
    const entries = await getLog(boxRoot, count);
    return {
      entries,
    };
  });

  // GET /api/context - Agent context
  server.get("/api/context", async () => {
    const context = await generateContext(boxRoot);
    return context;
  });

  // /api/browse/* — one-level directory listing
  registerApiBrowseRoutes({ server, boxRoot });

  // /api/files/* — serve and delete raw box files (images, audio, etc.)
  registerApiFilesRoutes({ server, boxRoot, eventBus });

  // /api/image/* — unified image resolver (plain files + .image.card)
  registerApiImageRoutes({ server, boxRoot });

  // /api/external — dev-only live wrapper for the commentary surface; reads
  // allowlisted files OUTSIDE the box root. Never mounted in production.
  if (process.env.NODE_ENV !== "production") {
    registerApiExternalRoute({ server, boxRoot });
  }

  // GET /api/task-output - Read a background task output file
  server.get<{ Querystring: { file?: string } }>(
    "/api/task-output",
    async (request, reply) => {
      const filePath = request.query.file;
      if (!filePath) {
        return reply.status(400).send({ error: "Missing file parameter" });
      }

      // Security: only allow reading from tmp task output directories
      const resolved = path.resolve(filePath);
      if (!resolved.includes("/tasks/") || !resolved.startsWith("/private/tmp/") && !resolved.startsWith("/tmp/")) {
        return reply.status(403).send({ error: "Access denied" });
      }

      try {
        const content = await fs.readFile(resolved, "utf-8");
        return reply.header("Content-Type", "text/plain").send(content);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn(`Could not read task output file, returning 404: ${resolved}:`, e);
        }
        return reply.status(404).send({ error: "Output file not found" });
      }
    }
  );

  // /api/debug-log — client console-log collector (in-memory + rolling file)
  registerApiDebugLogRoutes({ server, boxRoot });
}
