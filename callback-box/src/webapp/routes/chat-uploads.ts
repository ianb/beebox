/**
 * File-upload route for the chat composer.
 *
 * POST /api/chat/upload-file - multipart upload of a single file. The file is
 * written to <boxRoot>/tmp/<isoTimestamp>_<sanitizedName> and the relative
 * path is returned. The chat composer then references it inline as `[fileN]`
 * and lists `[fileN]: tmp/...` inside an <attachments> block sibling to
 * <typed>, so the agent sees a markdown-style reference link it can Read.
 *
 * Uploads accumulate until cb wakeup's housekeeping sweep removes them.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FastifyInstance } from "fastify";

interface RegisterChatUploadRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
}

/**
 * Sanitize a user-supplied filename to a safe basename. Strips path
 * components, replaces unsafe characters, prevents leading dots, caps length.
 */
function sanitizeFilename(name: string): string {
  const base = path.basename(name);
  let out = base.replace(/[^\w.-]/g, "_").replace(/^\.+/, "");
  const MAX = 100;
  if (out.length > MAX) {
    const ext = path.extname(out);
    const stem = out.slice(0, out.length - ext.length);
    out = stem.slice(0, MAX - ext.length) + ext;
  }
  if (out.length === 0) out = "upload";
  return out;
}

/** ISO timestamp safe for filenames (replaces colons). */
function safeTimestamp(): string {
  return new Date().toISOString().replace(/:/g, "-");
}

export async function registerChatUploadRoutes(
  options: RegisterChatUploadRoutesOptions
): Promise<void> {
  const { server, boxRoot } = options;

  server.post("/api/chat/upload-file", async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: "No file uploaded" });
    }

    const buffer = await data.toBuffer();
    const tmpDir = path.join(boxRoot, "tmp");
    await fs.mkdir(tmpDir, { recursive: true });

    const originalName = data.filename || "upload";
    const safeName = sanitizeFilename(originalName);
    const filename = `${safeTimestamp()}_${safeName}`;
    const fullPath = path.join(tmpDir, filename);

    // Defense in depth: ensure the resolved path stays inside tmpDir.
    const resolved = path.resolve(fullPath);
    const tmpResolved = path.resolve(tmpDir);
    if (
      resolved !== tmpResolved &&
      !resolved.startsWith(tmpResolved + path.sep)
    ) {
      return reply.status(400).send({ error: "Invalid filename" });
    }

    await fs.writeFile(fullPath, buffer);

    return {
      path: `tmp/${filename}`,
      originalName,
      size: buffer.length,
      mimetype: data.mimetype,
    };
  });
}
