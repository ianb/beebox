/**
 * REST routes for agent-generated views.
 *
 * - GET /api/views — list all views
 * - GET /api/views/:slug/module.js — compiled JS module
 * - GET /api/views/:slug/cards — cards matching view dependencies
 */

import type { FastifyInstance } from "fastify";
import * as path from "node:path";
import { compileView, listViews, buildErrorModule } from "../views/compiler.js";
import { loadViewCards } from "../../core/view-cards.js";

interface RegisterViewRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
}

export async function registerViewRoutes(options: RegisterViewRoutesOptions): Promise<void> {
  const { server, boxRoot } = options;

  // GET /api/views — list all views
  server.get("/api/views", async () => {
    return listViews(boxRoot);
  });

  // GET /api/views/:slug/module.js — compiled JS module
  server.get<{ Params: { slug: string } }>(
    "/api/views/:slug/module.js",
    async (request, reply) => {
      const { slug } = request.params;
      const viewPath = path.join(boxRoot, "views", `${slug}.tsx`);

      try {
        const { output } = await compileView(viewPath);
        return reply
          .header("Content-Type", "application/javascript")
          .header("Cache-Control", "no-cache")
          .send(output);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return reply
          .header("Content-Type", "application/javascript")
          .header("Cache-Control", "no-cache")
          .send(buildErrorModule(message));
      }
    }
  );

  // GET /api/views/:slug/cards — cards + non-card files matching view dependencies
  server.get<{ Params: { slug: string } }>(
    "/api/views/:slug/cards",
    async (request, reply) => {
      const { slug } = request.params;
      const viewPath = path.join(boxRoot, "views", `${slug}.tsx`);

      let dependencies: string[];
      try {
        const { meta } = await compileView(viewPath);
        dependencies = meta.dependencies;
      } catch (_e) {
        return reply.status(404).send({ error: "View not found" });
      }

      // A live page silently omits cards that fail to load, so the `skipped`
      // diagnostics are dropped here; `cb view test` surfaces them instead.
      const { cards, files } = await loadViewCards(boxRoot, dependencies);
      return { cards, files };
    }
  );
}
