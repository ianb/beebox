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
import { isTaskOutputPathForBox } from "../../core/chat/session/transcript-paths.js";
import { registerApiAdapterRoutes } from "./api-adapters.js";
import { registerApiExternalRoute } from "./api-external.js";
import { registerApiImageRoutes } from "./api-image.js";
import { registerApiImagesRoutes } from "./api-images.js";
import { registerApiSessionMediaRoutes } from "./api-session-media.js";

/**
 * Register API routes on the Fastify server.
 */
interface RegisterApiRoutesOptions {
  boxRoot: string;
  eventBus: EventBus;
  devSurfaces: boolean;
}

export async function registerApiRoutes(
  server: FastifyInstance,
  options: RegisterApiRoutesOptions,
): Promise<void> {
  const { boxRoot, eventBus, devSurfaces } = options;
  // Cheap lifecycle signal for a visible browser tab. This route deliberately
  // lives inside the box scope: reaching it through a lazy hub starts the box
  // child (or refreshes its idle timer) without running the full health checks
  // below. Hidden tabs send no heartbeat, so abandoned tabs still idle out.
  server.head("/api/keepalive", (_request, reply) =>
    reply.header("Cache-Control", "no-store").status(204).send(),
  );

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
  registerApiImagesRoutes({ server, boxRoot });

  // /api/session-media/* — one inline chat photo, read back out of the
  // transcript line the history path stripped it from.
  registerApiSessionMediaRoutes({ server, boxRoot });

  // /api/external — explicit local-development wrapper for the commentary
  // surface; reads allowlisted files OUTSIDE the box root. Omission is safe:
  // production callers never enable development surfaces.
  if (devSurfaces) {
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

      // Security: only this box's own background-task output files — see
      // isTaskOutputPathForBox for the exact shape (tmp root, /tasks/, and
      // THIS box's encoded-cwd segment). Checked on the literal path before
      // any filesystem access, then again on the realpath'd target below so a
      // symlink inside an otherwise-valid path can't point the read at
      // another box's task output.
      if (!isTaskOutputPathForBox({ boxRoot, filePath })) {
        return reply.status(403).send({ error: "Access denied" });
      }

      let realResolved: string;
      try {
        realResolved = await fs.realpath(path.resolve(filePath));
      } catch (e) {
        if (errnoCode(e) !== "ENOENT") {
          console.warn(`Could not resolve task output path, returning 404: ${filePath}:`, e);
        }
        return reply.status(404).send({ error: "Output file not found" });
      }
      if (!isTaskOutputPathForBox({ boxRoot, filePath: realResolved })) {
        return reply.status(403).send({ error: "Access denied" });
      }

      try {
        const stat = await fs.lstat(realResolved);
        if (!stat.isFile()) {
          return reply.status(404).send({ error: "Output file not found" });
        }
        const content = await fs.readFile(realResolved, "utf-8");
        return reply.header("Content-Type", "text/plain").send(content);
      } catch (e) {
        if (errnoCode(e) !== "ENOENT") {
          console.warn(`Could not read task output file, returning 404: ${realResolved}:`, e);
        }
        return reply.status(404).send({ error: "Output file not found" });
      }
    }
  );
}
