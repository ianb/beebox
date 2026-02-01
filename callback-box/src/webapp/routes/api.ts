/**
 * REST API routes for the webapp.
 */

import type { FastifyInstance } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getSystemState, generateContext, type CardInfo } from "../../core/state.js";
import { createLoader } from "../../cli/lib/loader.js";
import { getLog } from "../../cli/lib/git.js";
import type { ElementNode } from "cardworks";

/**
 * JSON-safe element node for the frontend.
 */
interface JsonElement {
  tagName: string;
  attrs: Record<string, string>;
  text?: string;
  children?: JsonElement[];
}

/**
 * Convert an ElementNode to a JSON-safe structure.
 */
function sanitizeElement(el: ElementNode): JsonElement {
  const result: JsonElement = {
    tagName: el.tagName,
    attrs: {},
  };

  // Copy string attributes only
  for (const [key, value] of Object.entries(el.attrs)) {
    if (typeof value === "string") {
      result.attrs[key] = value;
    }
  }

  // Include text if present
  if (el.text !== undefined && el.text !== null) {
    result.text = String(el.text).trim();
  }

  // Recursively process children
  if (el.children && Array.isArray(el.children) && el.children.length > 0) {
    result.children = el.children.map((child) => sanitizeElement(child as ElementNode));
  }

  return result;
}

/**
 * Count news items in a directory.
 */
async function countNewsInDir(boxRoot: string, relativeDir: string): Promise<number> {
  const dir = path.join(boxRoot, relativeDir);
  try {
    const files = await fs.readdir(dir);
    return files.filter((f) => f.endsWith(".news-item.card")).length;
  } catch {
    return 0;
  }
}

/**
 * Register API routes on the Fastify server.
 */
export async function registerApiRoutes(
  server: FastifyInstance,
  boxRoot: string
): Promise<void> {
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
        commands: state.commands.length,
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

  // GET /api/commands - List command cards
  server.get("/api/commands", async () => {
    const state = await getSystemState(boxRoot);
    return {
      items: state.commands,
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

  // GET /api/card/:path - Get a single card's content
  server.get<{ Params: { "*": string }; Querystring: { format?: string } }>(
    "/api/card/*",
    async (request, reply) => {
      const cardPath = request.params["*"];
      if (!cardPath) {
        return reply.status(400).send({ error: "Card path required" });
      }

      const fullPath = path.join(boxRoot, cardPath);
      const loader = createLoader(boxRoot);

      try {
        const card = await loader.load(fullPath);
        const xml = loader.serialize(card.element);

        // Include element tree for tree view rendering
        const element = sanitizeElement(card.element);

        return {
          path: cardPath,
          tagName: card.element.tagName,
          status: card.element.attrs["status"],
          version: card.version,
          xml,
          element,
        };
      } catch (error) {
        return reply.status(404).send({
          error: `Card not found: ${cardPath}`,
          details: (error as Error).message,
        });
      }
    }
  );

  // GET /api/log - Recent git commits
  server.get<{ Querystring: { count?: string } }>("/api/log", async (request) => {
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

  // GET /api/news-status - News pipeline status by location
  server.get("/api/news-status", async () => {
    const [inboxCount, poolCount, archiveCount, trashCount] = await Promise.all([
      countNewsInDir(boxRoot, "box/inbox/news"),
      countNewsInDir(boxRoot, "box/pool/news"),
      countNewsInDir(boxRoot, "store/archive/news"),
      countNewsInDir(boxRoot, "store/trash/news"),
    ]);

    return {
      inbox: inboxCount,
      pool: poolCount,
      archive: archiveCount,
      trash: trashCount,
    };
  });
}
