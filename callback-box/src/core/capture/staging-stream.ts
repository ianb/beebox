/**
 * Streaming staged-file writes for bulk uploads.
 *
 * Unlike capture's buffered photo/audio/file path (which reads the whole body
 * into a `Buffer` before writing), a bulk item streams to a temp file — hashing
 * and counting bytes as they flow — so dozens of ~50 MB items never pin RAM. The
 * byte transfer runs OUTSIDE the per-session lock; only the atomic
 * rename-into-place plus the manifest update run under it, so a slow upload
 * can't block concurrent uploads to the same batch.
 *
 * Split out of `staging-store.ts` to keep that file under the line cap; it
 * depends only on the store's public helpers (no import cycle — the store does
 * not import this module).
 */

import * as fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { type Readable } from "node:stream";
import * as path from "node:path";
import { getBoxTimeISO } from "../../lib/time.js";
import { enforceStagingLimits, MAX_STAGED_BYTES, StagingByteLimitError } from "./staging-limits.js";
import {
  StagingSessionGoneError,
  StagingUploadReplayConflictError,
  StagingSessionNotOpenError,
  StagingItemNotRegisteredError,
} from "./staging-errors.js";
import {
  withStagingLock,
  resolveStagedFile,
  readStagingSession,
  writeStagingSession,
  stagingSessionDir,
} from "./staging-store.js";
import type { StagingFile } from "./staging-schema.js";

export interface AddFileStreamedParams {
  boxRoot: string;
  id: string;
  filename: string;
  uploadedAt: string;
  originalName: string;
  mimeType: string;
  /** Predeclared bulk-registry item id this file fulfils. */
  itemId?: string | undefined;
  /** The request body stream — never buffered whole in memory. */
  source: Readable;
}

export interface AddFileStreamedResult {
  size: number;
  sha256: string;
  /** True when this exact filename was already staged with identical bytes. */
  replay: boolean;
}

/**
 * Stream one bulk-upload file into the session, computing its sha256 + byte
 * count as the bytes reach a temp file, then atomically renaming it into place
 * and recording it on the manifest under the per-session lock. A runaway stream
 * is aborted the moment it crosses {@link MAX_STAGED_BYTES}, before the whole
 * body reaches disk.
 *
 * Idempotent per filename (the upload idempotency key): a retry with identical
 * bytes returns `replay: true`; the same filename with different bytes is a
 * {@link StagingUploadReplayConflictError}.
 */
export async function addFileStreamed(params: AddFileStreamedParams): Promise<AddFileStreamedResult> {
  const { boxRoot, id, filename, uploadedAt, originalName, mimeType, itemId, source } = params;
  const destPath = resolveStagedFile({ boxRoot, id, filename }); // guards traversal
  const sessionDir = stagingSessionDir(boxRoot, id);
  const tmpPath = path.join(sessionDir, `.upload-tmp-${process.pid}-${crypto.randomUUID()}`);

  const hash = createHash("sha256");
  let size = 0;
  // An async-generator transform meters + hashes each chunk and aborts a
  // runaway body before it fully lands. pipeline handles backpressure + cleanup.
  async function* meter(chunks: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
    for await (const chunk of chunks) {
      size += chunk.length;
      if (size > MAX_STAGED_BYTES) throw new StagingByteLimitError();
      hash.update(chunk);
      yield chunk;
    }
  }

  try {
    await pipeline(source, meter, createWriteStream(tmpPath));
  } catch (e) {
    await fs.rm(tmpPath, { force: true });
    throw e;
  }
  const sha256 = hash.digest("hex");

  try {
    return await withStagingLock(id, async () => {
      const session = await readStagingSession({ boxRoot, id });
      if (!session) throw new StagingSessionGoneError(id);

      // The seal is a barrier: re-check state + registration UNDER the lock so a
      // finalize that raced past the route's pre-lock checks can't slip a commit
      // into a sealed batch (or register an item the seal already froze out).
      if (session.state !== "open") throw new StagingSessionNotOpenError(id, session.state);
      if (itemId !== undefined && !(session.expectedItems ?? []).some((it) => it.id === itemId)) {
        throw new StagingItemNotRegisteredError(itemId);
      }

      const existing = session.files.find((f) => f.filename === filename);
      if (existing) {
        if (existing.sha256 === sha256) return { size, sha256, replay: true };
        throw new StagingUploadReplayConflictError(filename);
      }

      enforceStagingLimits({ session, incomingBytes: size });
      await fs.rename(tmpPath, destPath);

      const file: StagingFile = { filename, uploadedAt, originalName, mimeType, size, sha256 };
      if (itemId !== undefined) file.itemId = itemId;
      session.files.push(file);
      session.totalBytes = (session.totalBytes ?? 0) + size;
      session.lastActivityAt = getBoxTimeISO(boxRoot);
      await writeStagingSession({ boxRoot, session });
      return { size, sha256, replay: false };
    });
  } finally {
    // On the replay/conflict/limit paths the temp file is still on disk; on the
    // success path the rename already moved it, so this is a no-op there.
    await fs.rm(tmpPath, { force: true });
  }
}
