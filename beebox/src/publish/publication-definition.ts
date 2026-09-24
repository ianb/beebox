/** Agent-authored, strict metadata for a static publication source. */

import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { errorMessage } from "../lib/error-guards.js";
import { pubIdSchema } from "./manifest.js";

const nameSchema = z.string().regex(/^[\da-z](?:[\da-z-]{0,61}[\da-z])?$/, "use a lowercase slug with letters, digits, and hyphens");
const connectionSchema = z.string().regex(/^[a-z][\da-z-]{0,39}$/, "must start with a lowercase letter and contain only lowercase letters, digits, or hyphens (up to 40 characters)");
const titleSchema = z.string().trim().min(1).max(200);

const baseDefinition = {
  pubId: pubIdSchema,
  connection: connectionSchema,
  content: z.enum(["static", "project"]),
  title: titleSchema,
} as const;

const publicDefinition = z.object({
  ...baseDefinition,
  tier: z.literal("public"),
  slug: z.string().min(1).max(80).regex(/^[\da-z]+(?:-[\da-z]+)*$/).optional(),
}).strict();

const secretDefinition = z.object({
  ...baseDefinition,
  tier: z.literal("secret"),
}).strict();

const accountsDefinition = z.object({
  ...baseDefinition,
  tier: z.literal("accounts"),
  emails: z.array(z.string().email()).min(1).transform((values) => [...new Set(values.map((email) => email.toLowerCase()))].toSorted()),
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

export class PublicationDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicationDefinitionError";
  }
}

function definitionError(message: string): PublicationDefinitionError {
  return new PublicationDefinitionError(message);
}

/** Validate a publication directory name before it is used as a path segment. */
export function parsePublicationName(value: string): string {
  const parsed = nameSchema.safeParse(value);
  if (!parsed.success) {
    throw definitionError(`invalid publication name '${value}': ${parsed.error.issues[0]?.message ?? "invalid name"}`);
  }
  return parsed.data;
}

/** The server-derived source root for a content mode. */
export function publicationSourcePath(args: { boxRoot: string; name: string; content: PublicationDefinition["content"] }): string {
  const safeName = parsePublicationName(args.name);
  const sourceDir = args.content === "static" ? "site" : "project";
  return path.join(args.boxRoot, "src", "publications", safeName, sourceDir);
}

export function publicationDefinitionPath(boxRoot: string, name: string): string {
  const safeName = parsePublicationName(name);
  return path.join(boxRoot, "src", "publications", safeName, "publication.json");
}

/** Read and validate the box-owned desired config without following a symlink. */
export async function readPublicationDefinition(args: { boxRoot: string; name: string }): Promise<PublicationDefinition> {
  const name = parsePublicationName(args.name);
  const sourceDir = path.join(args.boxRoot, "src");
  const publicationsDir = path.join(args.boxRoot, "src", "publications");
  const publicationDir = path.join(publicationsDir, name);
  const definitionPath = path.join(publicationDir, "publication.json");

  for (const [label, candidate] of [["source directory", sourceDir], ["publications directory", publicationsDir], ["publication directory", publicationDir], ["publication.json", definitionPath]] as const) {
    let info;
    try {
      info = await lstat(candidate);
    } catch (error) {
      throw definitionError(`cannot read ${label} for publication '${name}': ${errorMessage(error)}`);
    }
    if (info.isSymbolicLink()) throw definitionError(`${label} for publication '${name}' must not be a symlink`);
    if (label === "publication.json" ? !info.isFile() : !info.isDirectory()) {
      throw definitionError(`${label} for publication '${name}' has the wrong file type`);
    }
  }

  let raw: string;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(definitionPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    raw = await handle.readFile("utf-8");
  } catch (error) {
    throw definitionError(`cannot read publication '${name}' definition: ${errorMessage(error)}`);
  } finally {
    await handle?.close();
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw definitionError(`publication '${name}' has invalid JSON: ${errorMessage(error)}`);
  }
  const parsed = publicationDefinitionSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue === undefined) throw definitionError(`publication '${name}' definition was rejected without a validation detail`);
    const field = issue.path.join(".") || "definition";
    throw definitionError(`publication '${name}' definition is invalid at ${field}: ${issue.message}`);
  }
  return parsed.data;
}
