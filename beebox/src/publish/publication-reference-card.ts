import { constants } from "node:fs";
import { mkdir, lstat, open, writeFile } from "node:fs/promises";
import path from "node:path";

import { errnoCode } from "../shared/error-guards.js";
import { withFileLock } from "../lib/file-lock.js";
import { parseCardText } from "../core/card-io.js";
import { PublicationSchema, createPublicationCardTemplate } from "../schemas/publication.js";
import { publicationCardPath } from "../shared/publication-card.js";

const schemas = new Map([[PublicationSchema.type, PublicationSchema]]);

export abstract class PublicationReferenceCardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicationReferenceCardError";
  }
}

class PublicationCardInspectionError extends PublicationReferenceCardError {
  constructor() { super("Publication card path could not be inspected."); this.name = "PublicationCardInspectionError"; }
}
class PublicationCardDirectoryError extends PublicationReferenceCardError {
  constructor() { super("Publication card directories must be real directories."); this.name = "PublicationCardDirectoryError"; }
}
class PublicationCardCreateError extends PublicationReferenceCardError {
  constructor() { super("Publication card could not be created."); this.name = "PublicationCardCreateError"; }
}
class PublicationCardNotRegularError extends PublicationReferenceCardError {
  constructor() { super("Publication card path is not a regular file."); this.name = "PublicationCardNotRegularError"; }
}
class PublicationCardCollisionError extends PublicationReferenceCardError {
  constructor(cardPath: string) {
    super(`Publication card ${cardPath} identifies a different publication. Move or rename that card, or restore its pubId; it was left unchanged.`);
    this.name = "PublicationCardCollisionError";
  }
}
class PublicationCardInvalidError extends PublicationReferenceCardError {
  constructor() { super("Existing publication card is invalid; it was left unchanged."); this.name = "PublicationCardInvalidError"; }
}

/** Create a publication reference card once, preserving same-id human edits. */
export async function ensurePublicationReferenceCard(args: {
  boxRoot: string;
  pubId: string;
  title: string;
}): Promise<{ cardPath: string; created: boolean }> {
  const cardPath = publicationCardPath(args.pubId);
  const absolutePath = path.join(args.boxRoot, cardPath);
  const lockDir = path.join(args.boxRoot, ".beebox", "publication-card-locks");
  await mkdir(lockDir, { recursive: true });
  return withFileLock({
    lockPath: path.join(lockDir, `${args.pubId}.lock`),
    metadata: { purpose: "publication-reference-card", pubId: args.pubId },
    waitMs: 10_000,
  }, async () => {
    const directory = path.dirname(absolutePath);
    await ensureDirectoryChain(args.boxRoot, path.relative(args.boxRoot, directory).split(path.sep));
    const existing = await readExisting({ absolutePath, cardPath, pubId: args.pubId });
    if (existing) return { cardPath, created: false };
    try {
      await writeFile(absolutePath, createPublicationCardTemplate({ pubId: args.pubId, title: args.title }), { flag: "wx", mode: 0o644 });
      return { cardPath, created: true };
    } catch (error) {
      if (errnoCode(error) !== "EEXIST") throw new PublicationCardCreateError();
      const raced = await readExisting({ absolutePath, cardPath, pubId: args.pubId });
      if (!raced) throw new PublicationCardCreateError();
      return { cardPath, created: false };
    }
  });
}

/** Read-only existence check for publication list navigation. */
export async function hasPublicationReferenceCard(boxRoot: string, pubId: string): Promise<boolean> {
  const cardPath = publicationCardPath(pubId);
  try { return await readExisting({ absolutePath: path.join(boxRoot, cardPath), cardPath, pubId }); }
  catch (error) {
    if (error instanceof PublicationReferenceCardError) return false;
    throw new PublicationCardInspectionError();
  }
}

async function ensureDirectoryChain(boxRoot: string, segments: string[]): Promise<void> {
  let current = boxRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new PublicationCardDirectoryError();
      }
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") throw error;
      try { await mkdir(current); }
      catch (mkdirError) { if (errnoCode(mkdirError) !== "EEXIST") throw mkdirError; }
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new PublicationCardDirectoryError();
      }
    }
  }
}

async function readExisting(args: { absolutePath: string; cardPath: string; pubId: string }): Promise<boolean> {
  let stat;
  try { stat = await lstat(args.absolutePath); }
  catch (error) {
    if (errnoCode(error) === "ENOENT") return false;
    throw new PublicationCardInspectionError();
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new PublicationCardNotRegularError();
  }
  let handle;
  try {
    handle = await open(args.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const text = await handle.readFile("utf8");
    const parsed = parseCardText(text, { source: args.cardPath, schemas });
    if (parsed.schema.type !== "publication" || parsed.fields["pubId"] !== args.pubId) {
      throw new PublicationCardCollisionError(args.cardPath);
    }
    return true;
  } catch (error) {
    if (error instanceof PublicationReferenceCardError) throw error;
    throw new PublicationCardInvalidError();
  } finally {
    await handle?.close();
  }
}
