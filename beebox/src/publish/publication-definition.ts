/** Agent-authored, strict metadata for a static publication source. */

import { z } from "zod";

import { pubIdSchema } from "./manifest.js";

/** A connection name: the account a publication deploys through. */
export const publicationConnectionSchema = z.string().regex(/^[a-z][\da-z-]{0,39}$/, "must start with a lowercase letter and contain only lowercase letters, digits, or hyphens (up to 40 characters)");
/** A publication title; also the publication card's title. */
export const publicationTitleSchema = z.string().trim().min(1).max(200);
/** The requested public hostname label; valid only for the `public` tier. */
export const publicationSlugSchema = z.string().min(1).max(80).regex(/^[\da-z]+(?:-[\da-z]+)*$/);
/** The requested reader emails; required for, and valid only for, the `accounts` tier. */
export const publicationEmailsSchema = z.array(z.string().email()).min(1);
/** The four audience tiers a publication can request. */
export const publicationTierSchema = z.enum(["public", "secret", "accounts", "any-account"]);

const baseDefinition = {
  pubId: pubIdSchema,
  connection: publicationConnectionSchema,
  content: z.enum(["static", "project"]),
  title: publicationTitleSchema,
} as const;

const publicDefinition = z.object({
  ...baseDefinition,
  tier: z.literal("public"),
  slug: publicationSlugSchema.optional(),
}).strict();

const secretDefinition = z.object({
  ...baseDefinition,
  tier: z.literal("secret"),
}).strict();

const accountsDefinition = z.object({
  ...baseDefinition,
  tier: z.literal("accounts"),
  emails: publicationEmailsSchema.transform((values) => [...new Set(values.map((email) => email.toLowerCase()))].toSorted()),
}).strict();

const anyAccountDefinition = z.object({
  ...baseDefinition,
  tier: z.literal("any-account"),
}).strict();

/** Strict desired publication settings; roots and deployment targets are derived server-side. */
export const publicationDefinitionSchema = z.discriminatedUnion("tier", [
  publicDefinition,
  secretDefinition,
  accountsDefinition,
  anyAccountDefinition,
]);

export type PublicationDefinition = z.infer<typeof publicationDefinitionSchema>;

class PublicationDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicationDefinitionError";
  }
}

function definitionError(message: string): PublicationDefinitionError {
  return new PublicationDefinitionError(message);
}

/**
 * Build the definition that local prepare uses from a publication card's
 * fields. The card names the request; `content` comes from which attach
 * directory exists. One validation: the result passes through
 * {@link publicationDefinitionSchema}.
 */
export function definitionFromCard(fields: Readonly<Record<string, unknown>>, content: PublicationDefinition["content"]): PublicationDefinition {
  const candidate: Record<string, unknown> = {
    pubId: fields["pubId"],
    connection: fields["connection"],
    content,
    title: fields["title"],
    tier: fields["tier"],
  };
  for (const key of ["slug", "emails"]) {
    if (fields[key] !== undefined) candidate[key] = fields[key];
  }
  const parsed = publicationDefinitionSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const field = issue === undefined ? "card" : issue.path.join(".") || "card";
  throw definitionError(`publication card ${String(fields["pubId"])} is invalid at ${field}: ${issue?.message ?? "rejected without a validation detail"}`);
}
