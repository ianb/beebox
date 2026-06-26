/**
 * Write routes for raw box files — the mutation half of `/api/files/*`.
 *
 *   PUT  /api/files/*      {content}          create or overwrite (parents made)
 *   POST /api/files/*      {content}          append (creates when missing)
 *   POST /api/files-commit {path, message}    commit the file's card + attach scope
 *
 * Writes do NOT auto-commit — interactive views can be chatty, and a commit
 * per save would spam history. Uncommitted changes are visible as
 * `gitStatus` on view file metadata, swept by box housekeeping (wakeup),
 * and committed deliberately via the commit route at meaningful boundaries.
 *
 * Card files are excluded (use the card API / `cb create` — they have
 * validation); dotfiles are excluded like the read route.
 */

import type { FastifyInstance } from "fastify";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { EventBus } from "../../core/event-bus.js";
import { fileEtag } from "../file-etag.js";
import { stageFiles, commitPaths, pathsHaveChanges } from "../../cli/lib/git.js";
import {
  attachDirFor,
  attachDirOwnerBasename,
  isInsideAttachScope,
} from "../../shared/attach-path.js";

interface RegisterApiFilesWriteRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
  eventBus: EventBus;
}

interface WriteBody {
  content?: string;
}

interface CommitBody {
  path?: string;
  message?: string;
}

export function registerApiFilesWriteRoutes(options: RegisterApiFilesWriteRoutesOptions): void {
  const { server, boxRoot, eventBus } = options;

  const guard = (reqPath: string): { resolved: string } | { error: string; status: number } => {
    const root = path.resolve(boxRoot);
    const resolved = path.resolve(path.join(boxRoot, reqPath));
    // Reject escapes, including sibling dirs a bare startsWith would allow.
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      return { error: "Access denied", status: 403 };
    }
    if (reqPath === "") {
      return { error: "File path required", status: 400 };
    }
    if (resolved.endsWith(".card")) {
      return { error: "Card writes go through the card API or cb create (cards validate)", status: 403 };
    }
    if (path.basename(resolved).startsWith(".")) {
      return { error: "Dotfiles are not writable through this endpoint", status: 403 };
    }
    return { resolved };
  };

  const writeHandler = (append: boolean) =>
    async (
      request: {
        params: { "*": string };
        body: unknown;
        headers: Record<string, string | string[] | undefined>;
      },
      reply: { status: (code: number) => { send: (body: unknown) => unknown } }
    ) => {
      const reqPath = request.params["*"] || "";
      const guarded = guard(reqPath);
      if ("error" in guarded) {
        return reply.status(guarded.status).send({ error: guarded.error });
      }
      const body = (request.body ?? {}) as WriteBody;
      if (typeof body.content !== "string") {
        return reply.status(400).send({ error: 'Body must be {"content": "<text>"}' });
      }
      const { resolved } = guarded;
      const current = await statMeta(resolved, reqPath);

      // Mid-air collision detection. If-Match: the write asserts the version
      // it read; a mismatch (or a vanished file) is a 412 carrying the
      // current state so the client can refresh. If-None-Match: * asserts
      // creation — the file must not exist yet.
      const ifMatch = headerValue(request.headers["if-match"]);
      const ifNoneMatch = headerValue(request.headers["if-none-match"]);
      if (ifNoneMatch === "*" && current !== null) {
        return reply.status(412).send({ error: "File already exists", current });
      }
      if (ifMatch !== undefined && (current === null || current.etag !== ifMatch)) {
        return reply.status(412).send({
          error: current === null ? "File no longer exists" : "File changed since it was read",
          current,
        });
      }

      await fs.mkdir(path.dirname(resolved), { recursive: true });
      if (append) {
        await fs.appendFile(resolved, body.content, "utf8");
      } else {
        await fs.writeFile(resolved, body.content, "utf8");
      }
      const stat = await fs.stat(resolved);
      eventBus.emitTransient("file-change", {
        event: current !== null ? "change" : "add",
        path: reqPath,
        timestamp: new Date().toISOString(),
      });
      const file = { path: reqPath, size: stat.size, mtimeMs: stat.mtimeMs, etag: fileEtag(stat) };
      return reply.status(current !== null ? 200 : 201).send({ ok: true, file });
    };

  // PUT /api/files/* — create or overwrite
  server.put<{ Params: { "*": string }; Body: WriteBody }>("/api/files/*", writeHandler(false));

  // POST /api/files/* — append (creates when missing)
  server.post<{ Params: { "*": string }; Body: WriteBody }>("/api/files/*", writeHandler(true));

  // POST /api/files-commit — commit the file's card + attach scope, nothing else
  server.post<{ Body: CommitBody }>("/api/files-commit", async (request, reply) => {
    const reqPath = typeof request.body?.path === "string" ? request.body.path : "";
    const message = typeof request.body?.message === "string" ? request.body.message.trim() : "";
    if (reqPath === "" || message === "") {
      return reply.status(400).send({ error: 'Body must be {"path": "...", "message": "..."}' });
    }
    const guardResolved = path.resolve(path.join(boxRoot, reqPath));
    if (!guardResolved.startsWith(path.resolve(boxRoot))) {
      return reply.status(403).send({ error: "Access denied" });
    }

    const paths = await commitScopeFor(boxRoot, reqPath);
    if (!(await pathsHaveChanges(boxRoot, paths))) {
      return { ok: true, committed: false, paths };
    }
    await stageFiles(boxRoot, paths);
    const hash = await commitPaths(boxRoot, {
      paths,
      message,
      trailers: { "Created-By": "files-api" },
    });
    return { ok: true, committed: true, hash, paths };
  });
}

interface FileMeta {
  path: string;
  size: number;
  mtimeMs: number;
  etag: string;
}

async function statMeta(absPath: string, reqPath: string): Promise<FileMeta | null> {
  try {
    const stat = await fs.stat(absPath);
    if (!stat.isFile()) return null;
    return { path: reqPath, size: stat.size, mtimeMs: stat.mtimeMs, etag: fileEtag(stat) };
  } catch (_e) {
    return null;
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The pathspec "this file and its attachments": a card commits with its
 * attach scope; a file inside an attach scope commits with its owning card
 * and the whole scope; anything else commits alone.
 */
async function commitScopeFor(boxRoot: string, reqPath: string): Promise<string[]> {
  if (reqPath.endsWith(".card")) {
    return [reqPath, attachDirFor(reqPath)];
  }
  if (isInsideAttachScope(reqPath)) {
    const segments = reqPath.split("/");
    const scopeIndex = segments.findIndex((seg) => attachDirOwnerBasename(seg) !== null);
    const scopeDir = segments.slice(0, scopeIndex + 1).join("/");
    const ownerBase = attachDirOwnerBasename(segments[scopeIndex] ?? "");
    const parentDir = segments.slice(0, scopeIndex).join("/");
    const ownerCard = await findOwnerCard(boxRoot, { parentDir, ownerBase: ownerBase ?? "" });
    return ownerCard !== null ? [ownerCard, scopeDir] : [scopeDir];
  }
  return [reqPath];
}

/** Find `<base>.<type>.card` next to a `<base>.attach/` scope. */
async function findOwnerCard(
  boxRoot: string,
  { parentDir, ownerBase }: { parentDir: string; ownerBase: string }
): Promise<string | null> {
  try {
    const entries = await fs.readdir(path.join(boxRoot, parentDir));
    const match = entries.find(
      (name) => name.startsWith(`${ownerBase}.`) && name.endsWith(".card")
    );
    return match === undefined ? null : parentDir === "" ? match : `${parentDir}/${match}`;
  } catch (_e) {
    return null;
  }
}
