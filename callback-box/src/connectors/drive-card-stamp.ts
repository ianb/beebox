/**
 * Whole-file writes for the two connector-managed Drive cards that have no
 * attach scope: `.gfolder.card` (the mount) and `.glink.card` (a pointer).
 *
 * Read-mutate-write rather than render-from-template, for one reason: a
 * pointer's **body is the boxholder's**, and a folder card may carry
 * agent-owned frontmatter (`contains:`). Only the connector's own keys are
 * touched; everything else on the card rides through untouched.
 */

import * as fs from "node:fs/promises";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { splitCardContent } from "../cards/index.js";
import { isRecord } from "../lib/is-record.js";
import { createGlinkTemplate, type GlinkOriginType } from "../schemas/glink.js";
import { createGfolderTemplate } from "../schemas/gfolder.js";
import type { DriveFile } from "../services/google-drive.js";

/** Existing frontmatter as a mutable bag, plus the body to write back. */
interface CardParts {
  fields: Record<string, unknown>;
  body: string;
}

async function readCardParts(cardPath: string): Promise<CardParts> {
  const content = await fs.readFile(cardPath, "utf-8");
  const split = splitCardContent(content);
  const parsed: unknown = split.frontmatterText === "" ? {} : parseYaml(split.frontmatterText);
  return { fields: isRecord(parsed) ? { ...parsed } : {}, body: split.body };
}

async function writeCardParts(cardPath: string, parts: CardParts): Promise<void> {
  await fs.writeFile(cardPath, `---\n${stringifyYaml(parts.fields)}---\n${parts.body}`);
}

/** The outcome the folder card reports after a sync pass. */
export interface FolderStamp {
  name: string | null;
  link: string | null;
  lastSync: string;
  error: string | null;
}

/** Re-stamp a folder card's Drive metadata and last-sync outcome. */
export async function stampGfolderCard(cardPath: string, stamp: FolderStamp): Promise<void> {
  const parts = await readCardParts(cardPath);
  if (stamp.name !== null) parts.fields["name"] = stamp.name;
  if (stamp.link !== null) parts.fields["link"] = stamp.link;
  parts.fields["status"] = stamp.error === null ? "ok" : "error";
  parts.fields["last-sync"] = stamp.lastSync;
  if (stamp.error === null) delete parts.fields["error"];
  else parts.fields["error"] = stamp.error;
  await writeCardParts(cardPath, parts);
}

/**
 * Re-stamp a pointer's Drive metadata. The body — purpose notes someone wrote
 * — and `origin` are left exactly as they are; a pointer whose body the
 * connector rewrote would lose the only thing it is really for.
 */
export async function stampGlinkCard(cardPath: string, file: DriveFile): Promise<boolean> {
  const parts = await readCardParts(cardPath);
  const before = JSON.stringify(parts.fields);
  parts.fields["name"] = file.name;
  parts.fields["mime"] = file.mimeType;
  if (file.webViewLink !== undefined) parts.fields["link"] = file.webViewLink;
  if (JSON.stringify(parts.fields) === before) return false;
  await writeCardParts(cardPath, parts);
  return true;
}

/** Write a new pointer card. Body starts empty — the notes are not ours. */
export async function writeGlinkCard(cardPath: string, opts: {
  file: DriveFile;
  origin: GlinkOriginType;
}): Promise<void> {
  const { file, origin } = opts;
  await fs.writeFile(
    cardPath,
    createGlinkTemplate({
      driveId: file.id,
      link: file.webViewLink ?? driveViewLink(file.id),
      name: file.name,
      mime: file.mimeType,
      origin,
      notes: "",
    }),
  );
}

/** Write a new folder-mount card for a mirrored subfolder. */
export async function writeGfolderCard(cardPath: string, file: DriveFile): Promise<void> {
  await fs.writeFile(
    cardPath,
    createGfolderTemplate({
      driveId: file.id,
      name: file.name,
      link: file.webViewLink ?? driveFolderLink(file.id),
    }),
  );
}

/** The canonical Drive URL for an item, when the API did not send one. */
export function driveViewLink(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

/** The canonical Drive URL for a folder, when the API did not send one. */
export function driveFolderLink(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}
