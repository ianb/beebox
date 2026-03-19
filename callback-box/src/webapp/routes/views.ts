/**
 * REST routes for agent-generated views.
 *
 * - GET /api/views — list all views
 * - GET /api/views/:slug/module.js — compiled JS module
 * - GET /api/views/:slug/cards — cards matching view dependencies
 */

import type { FastifyInstance } from "fastify";
import * as path from "node:path";
import { glob } from "glob";
import { compileView, listViews, buildErrorModule } from "../views/compiler.js";
import { createLoader } from "../../cli/lib/loader.js";
import type { ViewCard, ViewCardChild } from "../../types/views.js";
import type { ElementNode } from "cardworks";

interface RegisterViewRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
}

function elementToViewCardChild(el: ElementNode): ViewCardChild {
  const result: ViewCardChild = {
    tagName: el.tagName,
    attrs: el.attrs,
  };
  if (el.text) {
    result.text = el.text;
  }
  if (el.children && el.children.length > 0) {
    result.children = el.children
      .filter((c): c is ElementNode => typeof c !== "string" && "tagName" in c)
      .map(elementToViewCardChild);
  }
  return result;
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

  // GET /api/views/:slug/cards — cards matching view dependencies
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

      if (dependencies.length === 0) {
        return [];
      }

      // Collect matching card files from all dependency globs
      const cardPaths = new Set<string>();
      for (const pattern of dependencies) {
        const matches = await glob(pattern, { cwd: boxRoot });
        for (const m of matches) {
          if (m.endsWith(".card")) {
            cardPaths.add(m);
          }
        }
      }

      const loader = await createLoader(boxRoot);
      const cards: ViewCard[] = [];

      for (const relPath of cardPaths) {
        try {
          const absPath = path.join(boxRoot, relPath);
          const card = await loader.load(absPath);
          const el = card.element;
          const viewCard: ViewCard = {
            path: relPath,
            tagName: el.tagName,
            attrs: el.attrs,
          };
          if (el.text) {
            viewCard.text = el.text;
          }
          if (el.attrs["status"]) {
            viewCard.status = el.attrs["status"];
          }
          if (el.children && el.children.length > 0) {
            viewCard.children = el.children
              .filter((c): c is ElementNode => typeof c !== "string" && "tagName" in c)
              .map(elementToViewCardChild);
          }
          cards.push(viewCard);
        } catch (_e) {
          // Skip cards that fail to load (validation errors, etc.)
        }
      }

      return cards;
    }
  );
}
