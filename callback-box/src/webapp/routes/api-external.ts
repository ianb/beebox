/**
 * Dev-only route serving the live wrapper's external files (commentary surface,
 * Track B). `GET /api/external?href=<url-encoded file: URL>` resolves the href
 * via the allowlisted, read-only `resolveExternalRef`, and returns a JSON
 * envelope — base64 bytes + content type + current version markers — so the
 * commentary renderer can render the file and drift-check its anchors in one
 * round-trip.
 *
 * Registered only when `NODE_ENV !== "production"` (see `api.ts`); the deployed
 * server never mounts it.
 */

import type { FastifyInstance } from "fastify";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  resolveExternalRef,
  buildVersionMarkers,
  ExternalRefError,
  MalformedUrlError,
  NotFileUrlError,
} from "../../core/external-ref.js";
import { loadBoxConfig } from "../box-config.js";

const CONTENT_TYPES: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".ts": "text/plain",
  ".tsx": "text/plain",
  ".js": "text/plain",
  ".json": "application/json",
  ".txt": "text/plain",
  ".html": "text/html",
  ".css": "text/css",
  ".yaml": "text/plain",
  ".yml": "text/plain",
};

function contentTypeFor(absPath: string): string {
  return CONTENT_TYPES[path.extname(absPath).toLowerCase()] ?? "text/plain";
}

/** Expand a leading `~` / `~/` to the home directory; other paths pass through. */
function expandTilde(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Canonicalize a root to its realpath so it compares cleanly against the
 * realpath'd target in `resolveExternalRef` (e.g. macOS `/var` → `/private/var`).
 * A configured root that doesn't exist falls back to its resolved-but-unreal
 * form — it simply won't match anything.
 */
async function resolveRoot(p: string): Promise<string> {
  const abs = path.resolve(expandTilde(p));
  try {
    return await fs.realpath(abs);
  } catch (_e) {
    return abs;
  }
}

/**
 * The roots this box's `file:` hrefs may resolve under: the box's own root
 * (always) plus the box's declared `externalRoots` (config/box.json). Read
 * per request so edits to box.json take effect without a restart
 * (loadBoxConfig is mtime-cached, so this is cheap).
 */
async function rootsForBox(boxRoot: string): Promise<string[]> {
  const config = await loadBoxConfig(boxRoot);
  return Promise.all([boxRoot, ...(config.externalRoots ?? [])].map(resolveRoot));
}

/** Register `GET /api/external` — call only behind the dev gate (see api.ts). */
export function registerApiExternalRoute(options: { server: FastifyInstance; boxRoot: string }): void {
  const { server, boxRoot } = options;

  server.get<{ Querystring: { href?: string } }>("/api/external", async (request, reply) => {
    const href = request.query.href;
    if (href === undefined || href === "") {
      return reply.status(400).send({ error: "missing href query parameter" });
    }

    let real: string;
    try {
      real = await resolveExternalRef(href, { roots: await rootsForBox(boxRoot) });
    } catch (e) {
      // A malformed or non-file: URL is a client mistake (400); a path that
      // doesn't exist, escapes the roots, or is denylisted is "not available
      // here" (404). Both expose only the hardcoded reason, never the value.
      if (e instanceof MalformedUrlError || e instanceof NotFileUrlError) {
        return reply.status(400).send({ error: e.message });
      }
      if (e instanceof ExternalRefError) {
        return reply.status(404).send({ error: e.message });
      }
      // resolveExternalRef only throws ExternalRefError, so this is unreachable
      // in practice; log and 500 rather than leak an unexpected error.
      request.log.error({ err: e }, "unexpected error resolving external href");
      return reply.status(500).send({ error: "external read failed" });
    }

    const bytes = await fs.readFile(real);
    const markers = await buildVersionMarkers(real);
    return reply.send({
      contentBase64: bytes.toString("base64"),
      contentType: contentTypeFor(real),
      markers,
    });
  });
}
