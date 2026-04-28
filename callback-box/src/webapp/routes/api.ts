/**
 * REST API routes for the webapp.
 */

import type { FastifyInstance } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getSystemState, generateContext } from "../../core/state.js";
import { runHealthChecks } from "../trpc/routers/health.js";
import { createLoader } from "../../cli/lib/loader.js";
import { parseCardName } from "../../cli/lib/paths.js";
import { commitPaths, getLog, pathsHaveChanges, stageFiles } from "../../cli/lib/git.js";
import type { EventBus } from "../../core/event-bus.js";
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

  // GET (and HEAD) /api/files/* - Serve raw box files (images, audio, etc.)
  server.get<{ Params: { "*": string } }>(
    "/api/files/*",
    { exposeHeadRoute: true },
    async (request, reply) => {
      const reqPath = request.params["*"] || "";

      // Security: resolve and ensure within boxRoot
      const resolved = path.resolve(path.join(boxRoot, reqPath));
      if (!resolved.startsWith(path.resolve(boxRoot))) {
        return reply.status(403).send({ error: "Access denied" });
      }

      // Don't serve .card files or dotfiles through this endpoint
      if (resolved.endsWith(".card") || path.basename(resolved).startsWith(".")) {
        return reply.status(403).send({ error: "Use card API for card files" });
      }

      try {
        const stat = await fs.stat(resolved);
        if (!stat.isFile()) {
          return reply.status(404).send({ error: "Not found" });
        }

        // Infer MIME type from extension
        const ext = path.extname(resolved).toLowerCase();
        const mimeTypes: Record<string, string> = {
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".png": "image/png",
          ".gif": "image/gif",
          ".webp": "image/webp",
          ".svg": "image/svg+xml",
          ".webm": "audio/webm",
          ".mp4": "video/mp4",
          ".m4a": "audio/mp4",
          ".mp3": "audio/mpeg",
          ".wav": "audio/wav",
          ".ogg": "audio/ogg",
          ".pdf": "application/pdf",
          ".json": "application/json",
          ".md": "text/markdown",
          ".txt": "text/plain",
          ".csv": "text/csv",
          ".html": "text/html",
          ".doc": "application/msword",
          ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          ".xls": "application/vnd.ms-excel",
          ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          ".ppt": "application/vnd.ms-powerpoint",
          ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          ".zip": "application/zip",
        };
        const contentType = mimeTypes[ext] || "application/octet-stream";

        // Conditional GET: build weak ETag from mtime + size, serve 304 when
        // the client already has the current version. `no-cache` means the
        // browser keeps the body but must revalidate every time, so an agent
        // editing the file on disk becomes visible on the next reload.
        const lastModified = stat.mtime.toUTCString();
        const etag = `W/"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;
        const ifNoneMatch = request.headers["if-none-match"];
        const ifModifiedSince = request.headers["if-modified-since"];
        const etagMatches = ifNoneMatch === etag;
        const mtimeMatches =
          typeof ifModifiedSince === "string" &&
          Number.isFinite(Date.parse(ifModifiedSince)) &&
          Math.floor(Date.parse(ifModifiedSince) / 1000) >= Math.floor(stat.mtimeMs / 1000);
        if (etagMatches || mtimeMatches) {
          return reply
            .header("ETag", etag)
            .header("Last-Modified", lastModified)
            .header("Cache-Control", "no-cache")
            .status(304)
            .send();
        }

        const content = await fs.readFile(resolved);
        return reply
          .header("Content-Type", contentType)
          .header("Cache-Control", "no-cache")
          .header("ETag", etag)
          .header("Last-Modified", lastModified)
          .send(content);
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
    }
  );

  // DELETE /api/files/* - Remove a raw box file and commit the deletion
  server.delete<{ Params: { "*": string } }>(
    "/api/files/*",
    async (request, reply) => {
      const reqPath = request.params["*"] || "";
      const resolved = path.resolve(path.join(boxRoot, reqPath));

      if (!resolved.startsWith(path.resolve(boxRoot))) {
        return reply.status(403).send({ error: "Access denied" });
      }

      if (reqPath === "" || path.basename(resolved).startsWith(".")) {
        return reply.status(400).send({ error: "File path required" });
      }

      if (resolved.endsWith(".card")) {
        return reply.status(403).send({ error: "Card deletion is not supported through this endpoint" });
      }

      try {
        const stat = await fs.stat(resolved);
        if (!stat.isFile()) {
          return reply.status(404).send({ error: "Not found" });
        }
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }

      if (await pathsHaveChanges(boxRoot, [reqPath])) {
        await stageFiles(boxRoot, [reqPath]);
        await commitPaths(boxRoot, {
          paths: [reqPath],
          message: `Saved before user delete: ${reqPath}`,
        });
      }

      await fs.unlink(resolved);
      await stageFiles(boxRoot, [reqPath]);
      const commitHash = await commitPaths(boxRoot, {
        paths: [reqPath],
        message: `Deleted by user: ${reqPath}`,
      });

      eventBus.emitTransient("file-change", {
        event: "unlink",
        path: reqPath,
        timestamp: new Date().toISOString(),
      });

      return {
        ok: true,
        path: reqPath,
        commit: commitHash,
      };
    }
  );

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
      } catch {
        return reply.status(404).send({ error: "Output file not found" });
      }
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
  // The frontend always captures console.error/warn and forwards them here.
  // When the debug panel is open, all console levels are forwarded.
  // Logs are kept in-memory (for GET) and appended to a rolling log file.
  //   GET  /api/debug-log    — read in-memory logs
  //   POST /api/debug-log    — { entries: [{ level, message }] }
  //   DELETE /api/debug-log  — clear in-memory logs
  // Read from CLI:  curl http://localhost:3210/<box>/api/debug-log | python3 -m json.tool
  // Log file:  .callback-box/client-debug.log (rolling, max ~100KB)
  const clientLogs: Array<{ ts: string; level: string; message: string }> = [];
  const MAX_CLIENT_LOGS = 200;
  const logFile = path.join(boxRoot, ".callback-box", "client-debug.log");
  const MAX_LOG_FILE_BYTES = 100_000;

  async function appendToLogFile(lines: string[]) {
    try {
      await fs.mkdir(path.dirname(logFile), { recursive: true });
      await fs.appendFile(logFile, lines.join("") );
      // Truncate if too large: keep the last half
      const stat = await fs.stat(logFile);
      if (stat.size > MAX_LOG_FILE_BYTES) {
        const content = await fs.readFile(logFile, "utf-8");
        const half = content.slice(content.length / 2);
        const firstNewline = half.indexOf("\n");
        await fs.writeFile(logFile, firstNewline !== -1 ? half.slice(firstNewline + 1) : half);
      }
    } catch (_e) {
      // Don't let log file failures break the API
    }
  }

  server.post<{ Body: { entries: Array<{ level: string; message: string }> } }>(
    "/api/debug-log",
    async (request) => {
      const { entries } = request.body;
      if (Array.isArray(entries)) {
        const lines: string[] = [];
        for (const entry of entries) {
          const ts = new Date().toISOString();
          const level = String(entry.level);
          const message = String(entry.message);
          clientLogs.push({ ts, level, message });
          lines.push(`${ts} [${level}] ${message}\n`);
        }
        while (clientLogs.length > MAX_CLIENT_LOGS) clientLogs.shift();
        appendToLogFile(lines);
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
