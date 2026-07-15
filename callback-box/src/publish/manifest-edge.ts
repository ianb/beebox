/**
 * Runtime-agnostic publication vocabulary — the pieces of the manifest schema
 * (Track A of `docs/plans/publish-pages.md`) that must load in *both* the box
 * (Node) and the Cloudflare Worker (workerd) runtimes.
 *
 * This module has **zero node-only imports** (zod only): it is the single source
 * the `pub-worker/` package imports so no `node:*` builtin (e.g. the
 * `node:crypto` `randomBytes` behind {@link generatePubId}) is ever pulled into
 * the workerd bundle. The Node-only pieces — pub-id minting and the full
 * box-side {@link PublicationManifest} with its provenance — live in
 * `manifest.ts`, which imports and re-exports from here so nothing box-side
 * breaks.
 *
 * The edge manifest is the minimal subset the Worker needs to serve and gate a
 * publication, stored in R2. It deliberately drops provenance, source refs, and
 * every box identifier (the Notion lesson: nothing edge-side names cards or the
 * box beyond what serving requires). It is a zod discriminated union on `tier`
 * with strict objects, so illegal states are unrepresentable at the type level
 * and rejected at runtime; the Worker treats its own R2 store as an untrusted
 * boundary and `safeParse`s this schema on every serve.
 */

import { z } from "zod";

/** The four access tiers. Visible in the URL prefix (`/p/ /s/ /a/`). */
export const tierValues = ["public", "secret", "accounts", "any-account"] as const;

export type Tier = (typeof tierValues)[number];

/** Publication lifecycle status. `revoked` is the tombstone (Track A). */
export const statusSchema = z.enum(["draft", "live", "revoked"]);

/** A single submit-form field. `choices` is present iff `kind` is `"choice"`. */
const submitFieldSchema = z
  .object({
    name: z.string(),
    kind: z.enum(["text", "textarea", "email", "choice"]),
    required: z.boolean(),
    maxLength: z.number().int().positive(),
    choices: z.array(z.string()).optional(),
  })
  .strict()
  .refine((field) => (field.kind === "choice" ? field.choices !== undefined : field.choices === undefined), {
    message: "`choices` must be present for kind 'choice' and absent otherwise",
  });

/**
 * The submit ("drop box") block — an optional constrained form on the non-public
 * tiers. Full use is Track F; the shape is locked here.
 */
export const submitBlockSchema = z
  .object({
    fields: z.array(submitFieldSchema),
    maxSubmissionBytes: z.number().int().positive(),
    maxPerDay: z.number().int().positive(),
  })
  .strict();

export type SubmitBlock = z.infer<typeof submitBlockSchema>;

/** Per-file integrity record for the rendered bundle tree. */
const fileEntrySchema = z
  .object({
    bytes: z.number().int().nonnegative(),
    sha256: z.string(),
  })
  .strict();

export const filesSchema = z.record(z.string(), fileEntrySchema);

/** `submit` is nullable + optional so both `null` and absence are legal. */
const optionalSubmit = submitBlockSchema.nullable().optional();

// Fields common to every tier of the edge manifest — the minimal serve/gate
// subset. No provenance, no sourceRefs, no pubId, no box identifiers.
const commonEdgeFields = {
  status: statusSchema,
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  files: filesSchema,
} as const;

const publicEdgeSchema = z
  .object({ tier: z.literal("public"), slug: z.string().optional(), ...commonEdgeFields })
  .strict();

const secretEdgeSchema = z
  .object({ tier: z.literal("secret"), submit: optionalSubmit, ...commonEdgeFields })
  .strict();

// `allowedEmails` is optional: absent/empty parses (it MEANS nobody — the
// fail-closed rule lives in the Worker, not the schema).
const accountsEdgeSchema = z
  .object({
    tier: z.literal("accounts"),
    allowedEmails: z.array(z.string().email()).optional(),
    submit: optionalSubmit,
    ...commonEdgeFields,
  })
  .strict();

const anyAccountEdgeSchema = z
  .object({ tier: z.literal("any-account"), submit: optionalSubmit, ...commonEdgeFields })
  .strict();

/** The R2-stored subset the Worker parses on every serve. */
export const edgeManifestSchema = z.discriminatedUnion("tier", [
  publicEdgeSchema,
  secretEdgeSchema,
  accountsEdgeSchema,
  anyAccountEdgeSchema,
]);

export type EdgeManifest = z.infer<typeof edgeManifestSchema>;
