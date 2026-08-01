/**
 * Stream a `Readable` (in practice an HTTP request body) to a file while
 * hashing and metering it.
 *
 * This exists because Fastify's `bodyLimit` does NOT meter a passthrough
 * content-type parser: a route that hands `request.raw` straight to disk sees
 * unbounded bytes unless it counts them itself. Both upload paths that stream
 * raw bodies (bulk-upload staging and scan-upload quarantine) share this one
 * metered writer rather than each re-deriving the async-generator idiom.
 *
 * The limit is enforced mid-flight — a runaway body is aborted the moment it
 * crosses `maxBytes`, before the whole thing lands — and the partial file is
 * removed on any failure, so a caller never has to clean up after a throw.
 *
 * The written file is fsynced before this returns: both callers hand the client
 * a durable-sounding answer immediately afterwards.
 */

import { createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

/** The source stream carried more than `maxBytes`; the partial file is gone. */
export class StreamByteLimitError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Stream exceeded the ${maxBytes}-byte limit`);
    this.name = "StreamByteLimitError";
  }
}

export interface HashStreamToFileResult {
  /** Bytes actually received (never a client-claimed length). */
  size: number;
  /** SHA-256 of those bytes, lowercase hex. */
  sha256: string;
}

/**
 * Write `source` to `destPath`, returning the received byte count and SHA-256.
 *
 * Throws {@link StreamByteLimitError} past `maxBytes`; on any failure the
 * partial `destPath` is deleted before the error propagates.
 */
export async function hashStreamToFile(opts: {
  source: Readable;
  destPath: string;
  maxBytes: number;
}): Promise<HashStreamToFileResult> {
  const { source, destPath, maxBytes } = opts;
  const hash = createHash("sha256");
  let size = 0;
  // An async-generator transform meters + hashes each chunk and aborts a
  // runaway body before it fully lands. pipeline handles backpressure + cleanup.
  async function* meter(chunks: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
    for await (const chunk of chunks) {
      size += chunk.length;
      if (size > maxBytes) throw new StreamByteLimitError(maxBytes);
      hash.update(chunk);
      yield chunk;
    }
  }

  try {
    await pipeline(source, meter, createWriteStream(destPath));
    // Push the bytes out of the page cache before we return. Callers treat a
    // successful return as "these bytes are on disk" — the scan route renames
    // this file into quarantine and then answers the client `accepted`, which
    // is its cue to delete its only other copy. Cheap relative to the transfer
    // that just happened, so capture staging gets it too.
    //
    // ACCEPTED RESIDUAL: the containing directory's entry is not fsynced, so a
    // host that loses power in the window between the rename and the next
    // directory flush can lose the file even though we answered `accepted`. The
    // client's archive/Trash copy survives that window, and the full
    // directory-fsync ceremony (parent dir on both the staging and quarantine
    // side, on every upload) is not worth its cost here.
    const handle = await fs.open(destPath, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (e) {
    await fs.rm(destPath, { force: true });
    throw e;
  }
  return { size, sha256: hash.digest("hex") };
}
