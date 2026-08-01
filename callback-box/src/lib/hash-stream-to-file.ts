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
  } catch (e) {
    await fs.rm(destPath, { force: true });
    throw e;
  }
  return { size, sha256: hash.digest("hex") };
}
