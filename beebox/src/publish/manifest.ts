/**
 * Publication manifest — the vocabulary the whole publish feature locks onto
 * (Track A of `docs/plans/publish-pages.md`).
 *
 * Two forms of the same publication:
 *  - {@link PublicationManifest} — the box-side full manifest, git-committed at
 *    `box/publish/<pub-id>/manifest.json`. Carries provenance and per-tier
 *    fields.
 *  - {@link EdgeManifest} — the minimal subset the Cloudflare Worker needs to
 *    serve and gate a publication, stored in R2. It deliberately drops
 *    provenance, source refs, and every box identifier (the Notion lesson:
 *    nothing edge-side names cards or the box beyond what serving requires).
 *
 * The runtime-agnostic pieces (tier literals, the submit block, the shared field
 * schemas, and the whole {@link EdgeManifest}) live in `manifest-edge.ts`, which
 * has **zero node-only imports** so the Worker can import it into the workerd
 * runtime without dragging in `node:crypto`. This module owns the Node-only
 * pieces — pub-id minting ({@link generatePubId}, `node:crypto` `randomBytes`)
 * and the full box-side manifest — and re-exports the edge pieces so existing
 * box-side importers keep resolving everything from `manifest.ts`.
 *
 * Both forms are zod discriminated unions on `tier`, with strict objects, so
 * illegal states are *unrepresentable* at the type level and *rejected* at
 * runtime: "public + submit" and "secret + slug" cannot be constructed, and a
 * plain `safeParse` refuses them.
 */

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { assertNever } from "../lib/invariant.js";
import {
  type EdgeManifest,
  edgeManifestSchema,
  filesSchema,
  statusSchema,
  submitBlockSchema,
} from "./manifest-edge.js";

// Re-export the runtime-agnostic pieces so box-side code keeps importing them
// from `manifest.ts` (the Worker imports them from `manifest-edge.ts` instead).
export {
  type EdgeManifest,
  type SubmitBlock,
  type Tier,
  tierValues,
} from "./manifest-edge.js";

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

/** Machine-filled record of where a publication came from — box-side only. */
const provenanceSchema = z
  .object({
    boxSlug: z.string(),
    renderedAt: z.string().datetime({ offset: true }),
    sourceRefs: z.array(z.string()),
    renderer: z.enum(["docs", "view"]),
    softwareVersion: z.string(),
    // Leak-scan finding ids the drafter explicitly waved through with
    // `--accept-leak` (Track E). Absent when the scan was clean. Recorded here
    // so the accept decision is auditable in git alongside the manifest.
    acceptedLeaks: z.array(z.string()).optional(),
  })
  .strict();

// Fields common to every tier of the full manifest. `submit` is nullable +
// optional so both `null` and absence are legal on the tiers that allow it.
const commonManifestFields = {
  pubId: pubIdSchema,
  status: statusSchema,
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  provenance: provenanceSchema,
  files: filesSchema,
} as const;

const optionalSubmit = submitBlockSchema.nullable().optional();

// Full manifest, per tier. `.strict()` is what turns "MUST NOT carry X" into a
// runtime rejection: an out-of-tier field is an unknown key, not a stripped one.
const publicManifestSchema = z
  .object({ tier: z.literal("public"), slug: z.string().optional(), ...commonManifestFields })
  .strict();

const secretManifestSchema = z
  .object({ tier: z.literal("secret"), submit: optionalSubmit, ...commonManifestFields })
  .strict();

// `allowedEmails` is optional: absent/empty parses (it MEANS nobody — the
// fail-closed rule lives in the Worker, not the schema).
const accountsManifestSchema = z
  .object({
    tier: z.literal("accounts"),
    allowedEmails: z.array(z.string().email()).optional(),
    submit: optionalSubmit,
    ...commonManifestFields,
  })
  .strict();

const anyAccountManifestSchema = z
  .object({ tier: z.literal("any-account"), submit: optionalSubmit, ...commonManifestFields })
  .strict();

/** The box-side full publication manifest (`box/publish/<pub-id>/manifest.json`). */
export const publicationManifestSchema = z.discriminatedUnion("tier", [
  publicManifestSchema,
  secretManifestSchema,
  accountsManifestSchema,
  anyAccountManifestSchema,
]);

export type PublicationManifest = z.infer<typeof publicationManifestSchema>;

/**
 * Project a validated full manifest down to its edge subset, then re-parse so
 * the projection can't silently drift from {@link edgeManifestSchema}. Builds
 * each tier's fields explicitly (rather than spreading the whole manifest) so a
 * box identifier can never leak edge-side by accident.
 */
export function toEdgeManifest(manifest: PublicationManifest): EdgeManifest {
  const base = { status: manifest.status, expiresAt: manifest.expiresAt, files: manifest.files };
  switch (manifest.tier) {
    case "public":
      return edgeManifestSchema.parse({
        tier: "public",
        ...(manifest.slug !== undefined ? { slug: manifest.slug } : {}),
        ...base,
      });
    case "secret":
      return edgeManifestSchema.parse({
        tier: "secret",
        ...(manifest.submit != null ? { submit: manifest.submit } : {}),
        ...base,
      });
    case "accounts":
      return edgeManifestSchema.parse({
        tier: "accounts",
        ...(manifest.allowedEmails !== undefined ? { allowedEmails: manifest.allowedEmails } : {}),
        ...(manifest.submit != null ? { submit: manifest.submit } : {}),
        ...base,
      });
    case "any-account":
      return edgeManifestSchema.parse({
        tier: "any-account",
        ...(manifest.submit != null ? { submit: manifest.submit } : {}),
        ...base,
      });
    default:
      return assertNever(manifest);
  }
}
