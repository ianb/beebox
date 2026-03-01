/**
 * REST API routes for the webapp.
 */

import type { FastifyInstance } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getSystemState, generateContext } from "../../core/state.js";
import { createLoader } from "../../cli/lib/loader.js";
import { parseCardName } from "../../cli/lib/paths.js";
import { getLog } from "../../cli/lib/git.js";
import type { ElementNode } from "cardworks";

type PatchOp =
  | { op: "set-attr"; path?: string; attr: string; value: string }
  | { op: "remove-attr"; path?: string; attr: string }
  | { op: "set-text"; path: string; value: string }
  | { op: "append-child"; path?: string; xml: string }
  | { op: "remove-child"; path: string; index: number };

/**
 * Navigate to a child element by a simple path like "section/ingredients/ing[2]".
 * Segments are tag names; [N] picks the Nth match (0-indexed).
 */
function navigateToChild(el: ElementNode, pathStr: string): ElementNode | null {
  const segments = pathStr.split("/").filter(Boolean);
  let current: ElementNode = el;
  for (const seg of segments) {
    const match = seg.match(/^(\w[\w-]*?)(?:\[(\d+)])?$/);
    if (!match) return null;
    const tagName = match[1]!;
    const idx = match[2] !== undefined ? parseInt(match[2], 10) : 0;
    const matches = current.children.filter(c => c.tagName === tagName);
    if (idx >= matches.length) return null;
    current = matches[idx]!;
  }
  return current;
}

/**
 * Parse a simple XML fragment like `<tag attr="val">text</tag>` into an ElementNode.
 * Very basic — handles single elements only.
 */
function parseXmlFragment(xml: string): ElementNode | null {
  const match = xml.match(/^<(\w[\w-]*)((?:\s+[\w-]+="[^"]*")*)(?:\s*\/>|>([\S\s]*?)<\/\1>)$/);
  if (!match) return null;
  const tagName = match[1]!;
  const attrStr = match[2] ?? "";
  const text = match[3]?.trim();

  const attrs: Record<string, string> = {};
  const attrRegex = /([\w-]+)="([^"]*)"/g;
  let attrMatch;
  while ((attrMatch = attrRegex.exec(attrStr))) {
    attrs[attrMatch[1]!] = attrMatch[2]!;
  }

  return {
    tagName,
    attrs,
    children: [],
    text: text || undefined,
    comments: {},
    location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
    dirty: true,
  } as ElementNode;
}

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

  // GET /api/card/:path - Get a single card's content
  server.get<{ Params: { "*": string }; Querystring: { format?: string } }>(
    "/api/card/*",
    async (request, reply) => {
      const cardPath = request.params["*"];
      if (!cardPath) {
        return reply.status(400).send({ error: "Card path required" });
      }

      const fullPath = path.join(boxRoot, cardPath);
      const loader = await createLoader(boxRoot);

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
        const msg = (error as Error).message;
        const isNotFound = msg.includes("ENOENT") || msg.includes("no such file");
        return reply.status(isNotFound ? 404 : 422).send({
          error: isNotFound ? `Card not found: ${cardPath}` : `Card validation failed: ${cardPath}`,
          details: msg,
        });
      }
    }
  );

  // PATCH /api/card/:path - Apply patch operations to a card
  server.patch<{ Params: { "*": string }; Body: { ops: PatchOp[] } }>(
    "/api/card/*",
    async (request, reply) => {
      const cardPath = request.params["*"];
      if (!cardPath) {
        return reply.status(400).send({ error: "Card path required" });
      }

      const { ops } = request.body as { ops: PatchOp[] };
      if (!Array.isArray(ops) || ops.length === 0) {
        return reply.status(400).send({ error: "Patch ops required" });
      }

      const fullPath = path.join(boxRoot, cardPath);
      const loader = await createLoader(boxRoot);

      try {
        const card = await loader.load(fullPath);

        // Apply each patch operation
        for (const op of ops) {
          const target = op.path ? navigateToChild(card.element, op.path) : card.element;
          if (!target) {
            return reply.status(400).send({ error: `Path not found: ${op.path}` });
          }

          switch (op.op) {
            case "set-attr":
              target.attrs[op.attr] = op.value;
              break;
            case "remove-attr":
              delete target.attrs[op.attr];
              break;
            case "set-text":
              target.text = op.value;
              break;
            case "append-child": {
              const fragment = parseXmlFragment(op.xml);
              if (fragment) {
                target.children.push(fragment);
              }
              break;
            }
            case "remove-child": {
              const idx = op.index;
              if (idx >= 0 && idx < target.children.length) {
                target.children.splice(idx, 1);
              }
              break;
            }
          }
        }

        // Save (validates against schema if one exists)
        await loader.save(card);

        // Re-read and return updated card
        const updated = await loader.load(fullPath);
        const xml = loader.serialize(updated.element);
        const element = sanitizeElement(updated.element);

        return {
          path: cardPath,
          tagName: updated.element.tagName,
          status: updated.element.attrs["status"],
          version: updated.version,
          xml,
          element,
        };
      } catch (error) {
        return reply.status(400).send({
          error: `Patch failed: ${(error as Error).message}`,
        });
      }
    }
  );

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

  // GET /api/browse/* - Browse directory contents (one level)
  server.get<{ Params: { "*": string } }>(
    "/api/browse/*",
    async (request) => {
      const reqPath = request.params["*"] || "";

      // Resolve the target directory
      const targetDir = reqPath ? path.join(boxRoot, reqPath) : boxRoot;

      // Security: ensure we stay within boxRoot
      const resolved = path.resolve(targetDir);
      if (!resolved.startsWith(path.resolve(boxRoot))) {
        return { path: reqPath, dirs: [], cards: [] };
      }

      let entries: Array<{ name: string; isDirectory: () => boolean }>;
      try {
        entries = await fs.readdir(resolved, { withFileTypes: true });
      } catch {
        return { path: reqPath, dirs: [], cards: [] };
      }

      const dirs: string[] = [];
      const cards: Array<{
        relativePath: string;
        name: string;
        type: string;
        tagName: string;
        status?: string | undefined;
      }> = [];

      const loader = await createLoader(boxRoot);

      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;

        if (entry.isDirectory()) {
          dirs.push(entry.name);
          continue;
        }

        if (!entry.name.endsWith(".card")) continue;

        const parsed = parseCardName(entry.name);
        if (!parsed) continue;

        const fullPath = path.join(resolved, entry.name);
        const relativePath = path.relative(boxRoot, fullPath);

        try {
          const card = await loader.load(fullPath);
          cards.push({
            relativePath,
            name: parsed.name,
            type: parsed.type,
            tagName: card.element.tagName,
            status: card.element.attrs["status"],
          });
        } catch {
          cards.push({
            relativePath,
            name: parsed.name,
            type: parsed.type,
            tagName: "unknown",
          });
        }
      }

      dirs.sort();
      cards.sort((a, b) => a.name.localeCompare(b.name));

      return { path: reqPath, dirs, cards };
    }
  );

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

  // --- Client debug log collector ---
  // The frontend patches console.log/warn/error (via DebugLog.tsx + enableDebugLogCapture())
  // and forwards entries here. Useful for mobile debugging where dev tools aren't available.
  //   GET  /api/debug-log    — read collected logs
  //   POST /api/debug-log    — { entries: [{ level, message }] }
  //   DELETE /api/debug-log  — clear all logs
  // To enable: toggle "Debug Log" in the Chat page's ⋮ menu (also shows on-screen overlay).
  // Read from CLI:  curl http://localhost:3210/<box>/api/debug-log | python3 -m json.tool
  const clientLogs: Array<{ ts: string; level: string; message: string }> = [];
  const MAX_CLIENT_LOGS = 200;

  server.post<{ Body: { entries: Array<{ level: string; message: string }> } }>(
    "/api/debug-log",
    async (request) => {
      const { entries } = request.body;
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          clientLogs.push({
            ts: new Date().toISOString(),
            level: String(entry.level),
            message: String(entry.message),
          });
        }
        while (clientLogs.length > MAX_CLIENT_LOGS) clientLogs.shift();
      }
      return { ok: true };
    }
  );

  server.get("/api/debug-log", async () => {
    return { entries: clientLogs };
  });

  server.delete("/api/debug-log", async () => {
    clientLogs.length = 0;
    return { ok: true };
  });
}
