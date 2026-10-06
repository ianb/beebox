/**
 * Read a publication card and find its source folder for local prepare.
 *
 * The card `<dir>/<Name>.publication.card` is the publication. Its source is
 * exactly one of `<dir>/<Name>.attach/static/` or `<dir>/<Name>.attach/project/`.
 * Nothing on the path from the box root to the card or the source folder may
 * be a symlink.
 */

import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";

import { parseCardText } from "../../core/card-io.js";
import { publicationCardsByPubId } from "../../core/card-lint/publication-duplicates.js";
import { PublicationSchema } from "../../schemas/publication.js";
import { attachDirFor } from "../../shared/attach-path.js";
import { errnoCode, errorMessage } from "../../shared/error-guards.js";
import { parseRef, resolveRefPath } from "../../shared/ref-path/core.js";
import { definitionFromCard, type PublicationDefinition } from "../publication-definition.js";

const PUBLICATION_CARD_SUFFIX = ".publication.card";
/** Cards outside the content area (scratch, config, bookkeeping) are not publications. */
const CONTENT_PREFIX = "_content/";
const schemas = new Map([[PublicationSchema.type, PublicationSchema]]);

/** A card or source problem, carrying the prepare failure reason it maps to. */
export class PublicationCardSourceError extends Error {
  readonly reason: "invalid-definition" | "invalid-source";

  constructor(message: string, options: { reason: "invalid-definition" | "invalid-source" }) {
    super(message);
    this.reason = options.reason;
    this.name = "PublicationCardSourceError";
  }
}

function definitionError(message: string): PublicationCardSourceError {
  return new PublicationCardSourceError(message, { reason: "invalid-definition" });
}

function sourceError(message: string): PublicationCardSourceError {
  return new PublicationCardSourceError(message, { reason: "invalid-source" });
}

/** Resolve a box-relative publication card path; fails closed outside the box. */
export function resolvePublicationCardPath(card: string): string {
  const parsed = parseRef(card);
  if (parsed.query !== undefined || parsed.fragment !== undefined) {
    throw definitionError(`publication card path '${card}' must not carry a query or fragment`);
  }
  const resolved = resolveRefPath({ fromPath: undefined, ref: parsed.path, kind: "card" });
  if (resolved === null) throw definitionError(`publication card path '${card}' is not a file inside the box`);
  if (!resolved.startsWith(CONTENT_PREFIX)) {
    throw definitionError(`publication card '${resolved}' must be under ${CONTENT_PREFIX}`);
  }
  if (!resolved.endsWith(PUBLICATION_CARD_SUFFIX)) {
    throw definitionError(`'${resolved}' is not a publication card; the path must end with ${PUBLICATION_CARD_SUFFIX}`);
  }
  return resolved;
}

type EntryKind = "file" | "directory" | "missing";

/** lstat one box-relative path; a symlink or the wrong type is refused. */
async function entryKind(args: { boxRoot: string; relPath: string }): Promise<EntryKind> {
  let info;
  try {
    info = await lstat(path.join(args.boxRoot, args.relPath));
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return "missing";
    throw sourceError(`cannot inspect ${args.relPath}: ${errorMessage(error)}`);
  }
  if (info.isSymbolicLink()) throw sourceError(`${args.relPath} must not be a symlink`);
  if (info.isDirectory()) return "directory";
  if (info.isFile()) return "file";
  throw sourceError(`${args.relPath} is neither a file nor a directory`);
}

/** Refuse a symlink anywhere among the card's parent directories. */
async function assertRealParents(args: { boxRoot: string; relPath: string }): Promise<void> {
  const segments = args.relPath.split("/").slice(0, -1);
  for (let index = 1; index <= segments.length; index += 1) {
    const relPath = segments.slice(0, index).join("/");
    if (await entryKind({ boxRoot: args.boxRoot, relPath }) !== "directory") {
      throw definitionError(`${relPath} must be a directory on the way to the publication card`);
    }
  }
}

async function readCardFields(args: { boxRoot: string; cardPath: string }): Promise<Record<string, unknown>> {
  await assertRealParents({ boxRoot: args.boxRoot, relPath: args.cardPath });
  let kind: EntryKind;
  try {
    kind = await entryKind({ boxRoot: args.boxRoot, relPath: args.cardPath });
  } catch (error) {
    throw definitionError(errorMessage(error));
  }
  if (kind !== "file") throw definitionError(`publication card ${args.cardPath} is not a regular file`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path.join(args.boxRoot, args.cardPath), constants.O_RDONLY | constants.O_NOFOLLOW);
    const text = await handle.readFile("utf8");
    return parseCardText(text, { source: args.cardPath, schemas }).fields;
  } catch (error) {
    throw definitionError(`publication card ${args.cardPath} cannot be used: ${errorMessage(error)}`);
  } finally {
    await handle?.close();
  }
}

async function assertUniquePubId(args: { boxRoot: string; cardPath: string; pubId: unknown }): Promise<void> {
  if (typeof args.pubId !== "string") return;
  const index = await publicationCardsByPubId(args.boxRoot);
  const others = (index.get(args.pubId) ?? []).filter((other) => other !== args.cardPath);
  if (others.length > 0) {
    throw definitionError(`publication id ${args.pubId} is claimed by ${args.cardPath} and ${others.join(", ")}; keep one card`);
  }
}

async function sourceMode(args: { boxRoot: string; cardPath: string }): Promise<{ content: PublicationDefinition["content"]; sourceRel: string }> {
  const attachRel = attachDirFor(args.cardPath);
  const staticRel = `${attachRel}/static`;
  const projectRel = `${attachRel}/project`;
  const expected = `exactly one of ${staticRel}/ or ${projectRel}/`;
  const attachKind = await entryKind({ boxRoot: args.boxRoot, relPath: attachRel });
  if (attachKind !== "directory") throw sourceError(`publication card ${args.cardPath} needs ${expected}; ${attachRel}/ is not a directory`);
  const staticKind = await entryKind({ boxRoot: args.boxRoot, relPath: staticRel });
  const projectKind = await entryKind({ boxRoot: args.boxRoot, relPath: projectRel });
  for (const [relPath, kind] of [[staticRel, staticKind], [projectRel, projectKind]] as const) {
    if (kind === "file") throw sourceError(`${relPath} must be a directory`);
  }
  if ((staticKind === "directory") === (projectKind === "directory")) {
    const found = staticKind === "directory" ? "both exist" : "neither exists";
    throw sourceError(`publication card ${args.cardPath} needs ${expected}; ${found}`);
  }
  return staticKind === "directory" ? { content: "static", sourceRel: staticRel } : { content: "project", sourceRel: projectRel };
}

/** Read the card, refuse a duplicate `pubId`, and find the absolute source root. */
export async function readPublicationCardSource(args: { boxRoot: string; cardPath: string }): Promise<{ definition: PublicationDefinition; sourceRoot: string }> {
  const fields = await readCardFields(args);
  await assertUniquePubId({ ...args, pubId: fields["pubId"] });
  const { content, sourceRel } = await sourceMode(args);
  let definition: PublicationDefinition;
  try {
    definition = definitionFromCard(fields, content);
  } catch (error) {
    throw definitionError(`publication card ${args.cardPath}: ${errorMessage(error)}`);
  }
  return { definition, sourceRoot: path.join(args.boxRoot, sourceRel) };
}
