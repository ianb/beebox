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
import { promises as fs } from "node:fs";
import { compileView, listViews, buildErrorModule } from "../views/compiler.js";
import { createLoader } from "../../cli/lib/loader.js";
import { attachDirFor } from "../../lib/attach-path.js";
import type { ViewCard, ViewCardChild, ViewFile } from "../../types/views.js";
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

      if (dependencies.length === 0) {
        return { cards: [], files: [] };
      }

      // Collect matching files from all dependency globs: cards parse into
      // ViewCard; everything else (attachments, .md, .jsonl, ...) arrives
      // as raw text in `files`.
      const cardPaths = new Set<string>();
      const filePaths = new Set<string>();
      for (const pattern of dependencies) {
        const matches = await glob(pattern, { cwd: boxRoot, nodir: true });
        for (const m of matches) {
          if (m.endsWith(".card")) cardPaths.add(m);
          else filePaths.add(m);
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
          const attachments = await listAttachments(boxRoot, relPath);
          if (attachments.length > 0) {
            viewCard.attachments = attachments;
          }
          cards.push(viewCard);
        } catch (_e) {
          // Skip cards that fail to load (validation errors, etc.)
        }
      }

      const files: ViewFile[] = [];
      for (const relPath of [...filePaths].toSorted()) {
        const content = await readViewFile(boxRoot, relPath);
        if (content !== null) files.push({ path: relPath, content });
      }

      return { cards, files };
    }
  );
}

/** Extensions never delivered as view file content. */
const BINARY_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic",
  ".pdf", ".zip", ".m4a", ".mp3", ".mp4", ".wav", ".webm",
]);

/** Views are a render surface, not a download channel — cap per-file size. */
const MAX_VIEW_FILE_BYTES = 1024 * 1024;

async function readViewFile(boxRoot: string, relPath: string): Promise<string | null> {
  if (BINARY_EXTENSIONS.has(path.extname(relPath).toLowerCase())) return null;
  try {
    const abs = path.join(boxRoot, relPath);
    const st = await fs.stat(abs);
    if (st.size > MAX_VIEW_FILE_BYTES) return null;
    return await fs.readFile(abs, "utf8");
  } catch (_e) {
    // Vanished between glob and read — contributes nothing this render.
    return null;
  }
}

/**
 * Files in a card's attach scope, scope-relative — so a view can discover
 * e.g. "sessions/history.jsonl" next to its card and add a dependency glob
 * (or view: link) for it.
 */
async function listAttachments(boxRoot: string, cardRelPath: string): Promise<string[]> {
  const scopeRel = attachDirFor(cardRelPath);
  const scopeAbs = path.join(boxRoot, scopeRel);
  const out: string[] = [];
  async function walk(absDir: string, relPrefix: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch (_e) {
      return; // no attach scope — the common case
    }
    for (const entry of entries) {
      const rel = relPrefix === "" ? entry.name : `${relPrefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(path.join(absDir, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  }
  await walk(scopeAbs, "");
  return out.toSorted();
}
