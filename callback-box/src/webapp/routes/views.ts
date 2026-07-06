/**
 * Raw routes for agent-generated views — these serve non-JSON payloads, so they
 * stay raw. The JSON view *list* moved to the `views.list` tRPC procedure.
 *
 * - GET /api/views/:slug/module.js — compiled JS module (JavaScript body)
 * - GET /api/views/:slug/cards — cards matching view dependencies
 */

import type { FastifyInstance } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { bundleView, getViewMeta, buildErrorModule, resolveViewsDir } from "../views/compiler.js";
import { loadViewCards } from "../../core/views/cards.js";

interface RegisterViewRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
}

/**
 * Resolve a view slug to its `.tsx` path, rejecting anything that would escape
 * the box's views directory (path separators, `..`, absolute paths). Returns
 * null for an invalid slug. The views directory itself is shape-aware
 * (`boxRoot/views` for a legacy box, `packageRoot/src/views` for a package
 * box) — see `resolveViewsDir`.
 */
function resolveViewPath(viewsDir: string, slug: string): string | null {
  if (!slug || /[/\\]/.test(slug) || slug.includes("..")) return null;
  const resolvedViewsDir = path.resolve(viewsDir);
  const viewPath = path.resolve(resolvedViewsDir, `${slug}.tsx`);
  if (viewPath !== path.join(resolvedViewsDir, `${slug}.tsx`)) return null;
  if (!viewPath.startsWith(resolvedViewsDir + path.sep)) return null;
  return viewPath;
}

export async function registerViewRoutes(options: RegisterViewRoutesOptions): Promise<void> {
  const { server, boxRoot } = options;

  // GET /api/views/:slug/module.js — compiled JS module
  server.get<{ Params: { slug: string } }>(
    "/api/views/:slug/module.js",
    async (request, reply) => {
      const { slug } = request.params;
      const { viewsDir } = await resolveViewsDir(boxRoot);
      const viewPath = resolveViewPath(viewsDir, slug);
      if (!viewPath) {
        return reply
          .header("Content-Type", "application/javascript")
          .header("Cache-Control", "no-cache")
          .send(buildErrorModule("Invalid view name"));
      }

      try {
        const { output } = await bundleView(viewPath);
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
      const { viewsDir, boxShape } = await resolveViewsDir(boxRoot);
      const viewPath = resolveViewPath(viewsDir, slug);
      if (!viewPath) {
        return reply.status(404).send({ error: "View not found" });
      }

      try {
        await fs.access(viewPath);
      } catch (_e) {
        return reply.status(404).send({ error: "View not found" });
      }

      // getViewMeta never throws (a broken view degrades to empty
      // dependencies, matching "no cards selected" rather than a hard error —
      // the module.js endpoint above is where a compile failure surfaces).
      const meta = await getViewMeta(viewPath, { boxShape });

      // A live page silently omits cards that fail to load, so the `skipped`
      // diagnostics are dropped here; `cb view test` surfaces them instead.
      const { cards, files } = await loadViewCards(boxRoot, meta.dependencies);
      return { cards, files };
    }
  );
}
