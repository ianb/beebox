/**
 * REST API routes for the webapp.
 *
 * This module owns the small, stateless summary endpoints (health, status,
 * inbox, questions, activity, context, task-output) and wires up the larger,
 * self-contained route families that live in sibling modules:
 *
 *   api-browse.ts      — GET /api/browse/*
 *   api-files.ts       — GET/HEAD + DELETE /api/files/*
 */

import type { FastifyInstance } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { runHealthChecks } from "../trpc/routers/health.js";
import type { EventBus } from "../../core/event-bus.js";
import { registerApiBrowseRoutes } from "./api-browse.js";
import { registerApiFilesRoutes } from "./api-files.js";
import { registerProxyImageRoutes } from "./proxy-image.js";
import { registerApiFilesWriteRoutes } from "./api-files-write.js";
import { errnoCode } from "../../lib/error-guards.js";
import { registerApiAdapterRoutes } from "./api-adapters.js";
import { registerApiExternalRoute } from "./api-external.js";
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
  // GET /api/health - Health check (permissions, API keys). Stays raw: hit by
  // infra/uptime monitors that aren't tRPC clients. The summary endpoints
  // (status/inbox/questions/activity/context) moved to the `status` tRPC router.
  server.get("/api/health", async () => {
    const checks = await runHealthChecks(boxRoot);
    const hasErrors = checks.some((c) => !c.ok && c.severity === "error");
    const hasWarnings = checks.some((c) => !c.ok && c.severity === "warning");
    const status = hasErrors ? "unhealthy" : hasWarnings ? "degraded" : "healthy";
    return { status, checks };
  });

  // /api/browse/* — one-level directory listing
  registerApiBrowseRoutes({ server, boxRoot });

  // /api/files/* — serve and delete raw box files (images, audio, etc.)
  registerApiFilesRoutes({ server, boxRoot, eventBus });
  // /api/proxy-image — SSRF-guarded fetch for hot-link fallback (frozen pages + markdown images)
  registerProxyImageRoutes({ server });
  registerApiFilesWriteRoutes({ server, boxRoot, eventBus });
  registerApiAdapterRoutes({ server, boxRoot });

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
        if (errnoCode(e) !== "ENOENT") {
          console.warn(`Could not read task output file, returning 404: ${resolved}:`, e);
        }
        return reply.status(404).send({ error: "Output file not found" });
      }
    }
  );
}
