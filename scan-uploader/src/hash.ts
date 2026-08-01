/** Streaming SHA-256, lowercase hex — the hash algorithm the wire contract
 * fixes as the PUT path segment, check key, and server dedup key. */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}
