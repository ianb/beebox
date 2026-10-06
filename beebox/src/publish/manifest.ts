/**
 * Publication ids. A pub-id names one publication across the box-side
 * definition (`src/publications/<name>/publication.json`), the R2 keys under
 * `pubs/<pub-id>/`, and the Worker routes. Node-only (`node:crypto`), so the
 * Worker imports its runtime-agnostic schemas from `manifest-edge.ts` instead.
 */

import { randomBytes } from "node:crypto";
import { z } from "zod";

/** RFC 4648 lowercase base32 alphabet (a-z, 2-7), no padding. */
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * Encode bytes as lowercase base32 (RFC 4648, no padding). 16 bytes → 26 chars,
 * carrying the full 128 bits (the final char holds 3 padding bits). Kept local:
 * the only caller is {@link generatePubId}, and no sibling base32 encoder lives
 * in `src/lib/`.
 */
function encodeBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

/**
 * A publication id / capability token: 26 lowercase-base32 chars (≥128 bits of
 * entropy). For the `secret` tier the pub-id *is* the capability token, so its
 * unguessability is load-bearing. Branded so a bare string can't stand in for a
 * validated one; produced by {@link generatePubId} or {@link pubIdSchema}.
 */
export const pubIdSchema = z
  .string()
  .length(26)
  .regex(/^[2-7a-z]+$/, "must be 26 lowercase base32 (a-z, 2-7) characters")
  .brand("PubId");

export type PubId = z.infer<typeof pubIdSchema>;

/** Mint a fresh pub-id from 16 CSPRNG bytes. Validated through the schema. */
export function generatePubId(): PubId {
  return pubIdSchema.parse(encodeBase32(randomBytes(16)));
}
