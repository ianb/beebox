/**
 * Runtime-agnostic publication vocabulary: the R2-stored site manifest and the
 * shared-host route marker, which must load in *both* the box (Node) and the
 * Cloudflare Worker (workerd) runtimes.
 *
 * This module has **zero node-only imports** (zod only): it is the single source
 * the `pub-worker/` package imports so no `node:*` builtin (e.g. the
 * `node:crypto` `randomBytes` behind `generatePubId` in `manifest.ts`) is ever
 * pulled into the workerd bundle.
 *
 * The site manifest is the minimal state the Worker needs to serve and gate a
 * publication. It carries no provenance, source refs, or box identifiers beyond
 * the random host handle. It is a zod discriminated union on `tier` with strict
 * objects, so illegal states are unrepresentable at the type level and rejected
 * at runtime; the Worker treats its own R2 store as an untrusted boundary and
 * `safeParse`s this schema on every serve.
 */

import { z } from "zod";

/** Per-file integrity record for the rendered bundle tree. */
const fileEntrySchema = z
  .object({
    bytes: z.number().int().nonnegative(),
    sha256: z.string(),
  })
  .strict();

export const filesSchema = z.record(z.string(), fileEntrySchema);

/** Immutable release identity: SHA-256 of the canonical release inventory. */
const releaseIdSchema = z.string().regex(/^[\da-f]{64}$/);

class ReleaseInventoryMutationError extends Error {
  constructor() {
    super("release inventory changed while hashing");
    this.name = "ReleaseInventoryMutationError";
  }
}

/**
 * Hash a file inventory in a runtime-stable order. The id identifies the
 * inventory of content hashes, not a second copy of each asset's bytes.
 */
export async function releaseIdForFiles(files: z.infer<typeof filesSchema>): Promise<string> {
  const canonicalInventory = Object.fromEntries(
    Object.keys(files)
      .toSorted()
      .map((filePath) => {
        const entry = files[filePath];
        if (entry === undefined) throw new ReleaseInventoryMutationError();
        return [filePath, { bytes: entry.bytes, sha256: entry.sha256 }];
      }),
  );
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonicalInventory)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const siteFilesSchema = filesSchema.refine((files) => Object.prototype.hasOwnProperty.call(files, "index.html"), {
  message: "site release inventory must include index.html",
});

const siteReleaseSchema = z.object({ id: releaseIdSchema, files: siteFilesSchema }).strict();

const previousSiteReleaseSchema = z
  .object({
    id: releaseIdSchema,
    files: siteFilesSchema,
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

const siteCommonFields = {
  kind: z.literal("site"),
  hostHandle: z.string().regex(/^[\da-z](?:[\da-z-]{0,61}[\da-z])?$/),
  customHostname: z.string().min(1).optional(),
  status: z.enum(["disabled", "live", "revoked"]),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  activeRelease: siteReleaseSchema,
  previousRelease: previousSiteReleaseSchema.optional(),
} as const;

const sitePublicEdgeSchema = z
  .object({
    tier: z.literal("public"),
    slug: z.string().min(1).max(80).regex(/^[\da-z]+(?:-[\da-z]+)*$/).optional(),
    ...siteCommonFields,
  })
  .strict();

const siteSecretEdgeSchema = z.object({ tier: z.literal("secret"), ...siteCommonFields }).strict();

const siteAccountsEdgeSchema = z
  .object({ tier: z.literal("accounts"), allowedEmails: z.array(z.string().email()).min(1), ...siteCommonFields })
  .strict();

const siteAnyAccountEdgeSchema = z.object({ tier: z.literal("any-account"), ...siteCommonFields }).strict();

/** Per-publication Worker authority, read by both pinned and shared-host Workers. */
export const siteEdgeManifestSchema = z.discriminatedUnion("tier", [
  sitePublicEdgeSchema,
  siteSecretEdgeSchema,
  siteAccountsEdgeSchema,
  siteAnyAccountEdgeSchema,
]);

export type SiteEdgeManifest = z.infer<typeof siteEdgeManifestSchema>;

const sharedReservedPaths = new Set(["s", "p", "a"]);
/** Shared-host public slug segment, matching the Worker's root route grammar. */
export const sharedPublicSlugSchema = z.string()
  .regex(/^[\da-z](?:[\da-z-]{0,61}[\da-z])?$/)
  .refine((slug) => !sharedReservedPaths.has(slug), "slug is reserved by shared-host routing");

/** Shared-host enrollment; the current site manifest remains authoritative for serving state. */
export const sharedRouteMarkerSchema = z.object({
  schemaVersion: z.literal(1),
  pubId: z.string().regex(/^[2-7a-z]{26}$/),
  boxHostHandle: z.string().min(1),
  hostname: z.string().min(1),
  path: z.string().min(1),
  manifestHostHandle: z.string().min(1),
}).strict();
export type SharedRouteMarker = z.infer<typeof sharedRouteMarkerSchema>;

export function sharedMarkerMatchesScope(marker: SharedRouteMarker | null, expected: SharedRouteMarker): boolean {
  return marker !== null
    && marker.pubId === expected.pubId
    && marker.boxHostHandle === expected.boxHostHandle
    && marker.hostname === expected.hostname
    && marker.path === expected.path
    && marker.manifestHostHandle === expected.manifestHostHandle;
}

/** R2 key for a public-tier slug pointer (value = pub-id). */
export function slugKey(slug: string): string {
  return `slugs/${slug}`;
}

export function sharedRouteMarkerKey(pubId: string): string {
  return `shared-routes/${pubId}/route.json`;
}
