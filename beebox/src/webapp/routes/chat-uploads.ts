/**
 * File-upload route for the chat composer.
 *
 * POST /api/chat/upload-file - multipart upload of a single file, with an
 * optional `batch` text field (sent BEFORE the file part) naming the message
 * it belongs to. The chat composer mints one batch id per draft, so every
 * attachment of one message — non-image files and the originals of inline
 * images alike — lands together in `<boxRoot>/_tmp/chat/<batch>/<name>`, and
 * the box-relative path is returned. The composer references each one inline
 * by token (`[file#N]`, `[image#N]`) and lists `<token>: <path>` inside an
 * <attachments> block sibling to <typed>, so the agent sees a markdown-style
 * reference link it can Read.
 *
 * Without `batch` (an older client) the file lands flat in `_tmp/` under a
 * timestamp-prefixed name, as before.
 *
 * The returned path is the one the file is actually at, under `_tmp/`, the
 * box's swept scratch area (`lib/box-tmp.ts`): a batch directory goes when
 * its newest file is a week old (`core/housekeeping.ts`). It used to say
 * `tmp/`, a directory no box has, so every attachment line pointed at a file
 * that was not there.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FastifyInstance } from "fastify";
import { chatUploadBatchesDir, ensureBoxTmpDir } from "../../lib/box-tmp.js";
import { errnoCode } from "../../lib/error-guards.js";

interface RegisterChatUploadRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
}

/**
 * A client-minted batch id: URL-safe, bounded, never a path. Anything else
 * is refused rather than sanitized — the client is ours and mints it.
 */
const BATCH_ID_RE = /^[\w-]{8,64}$/;

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

/**
 * Within a batch a name is kept as the user has it, so the agent reads
 * `IMG_0001.jpg`, not a timestamp. Two attachments with one name in one
 * message get `-2`, `-3`, … before the extension. The name is claimed by
 * the write itself (`wx`: create, never truncate): a message's uploads run
 * in parallel, and two pasted clipboard images are both called `image.png`,
 * so a check-then-write would let the second clobber the first.
 */
async function writeUnderUnusedName(dir: string, { safeName, buffer }: { safeName: string; buffer: Buffer }): Promise<string> {
  const ext = path.extname(safeName);
  const stem = safeName.slice(0, safeName.length - ext.length);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? safeName : `${stem}-${String(n)}${ext}`;
    try {
      await fs.writeFile(path.join(dir, candidate), buffer, { flag: "wx" });
      return candidate;
    } catch (e) {
      if (errnoCode(e) !== "EEXIST") throw e;
    }
  }
}

function multipartText(fields: Record<string, unknown>, name: string): string | null {
  const field = fields[name];
  if (field !== null && typeof field === "object" && "value" in field && typeof field.value === "string") {
    return field.value;
  }
  return null;
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
    const batch = multipartText(data.fields, "batch");
    if (batch !== null && !BATCH_ID_RE.test(batch)) {
      return reply.status(400).send({ error: "Invalid batch id" });
    }

    const buffer = await data.toBuffer();
    const tmpDir = await ensureBoxTmpDir(boxRoot);

    const originalName = data.filename || "upload";
    const safeName = sanitizeFilename(originalName);
    const dir = batch === null ? tmpDir : path.join(chatUploadBatchesDir(boxRoot), batch);

    // Defense in depth: ensure the resolved directory stays inside tmpDir
    // (the sanitized name has no separators, so the file does too).
    const resolved = path.resolve(dir);
    const tmpResolved = path.resolve(tmpDir);
    if (
      resolved !== tmpResolved &&
      !resolved.startsWith(tmpResolved + path.sep)
    ) {
      return reply.status(400).send({ error: "Invalid filename" });
    }

    let filename: string;
    if (batch === null) {
      filename = `${safeTimestamp()}_${safeName}`;
      await fs.writeFile(path.join(dir, filename), buffer);
    } else {
      await fs.mkdir(dir, { recursive: true });
      filename = await writeUnderUnusedName(dir, { safeName, buffer });
    }
    const fullPath = path.join(dir, filename);

    return {
      path: path.relative(boxRoot, fullPath),
      originalName,
      size: buffer.length,
      mimetype: data.mimetype,
    };
  });
}
