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
import { splitCardContent } from "../../exports/cards.js";
import { isRecord } from "../../shared/is-record.js";
import { createGlinkTemplate, type GlinkOriginType } from "../../schemas/glink.js";
import { createGfolderTemplate } from "../../schemas/gfolder.js";
import type { DriveFile } from "../../services/google-drive/core.js";
import type { FolderProblemCounts } from "./folder-types.js";

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

/**
 * The card's `drive:` map, as a fresh copy the caller can edit and put back
 * (`parts.fields["drive"] = drive`); empty when the card has none.
 */
function driveMap(parts: CardParts): Record<string, unknown> {
  const drive = parts.fields["drive"];
  return isRecord(drive) ? { ...drive } : {};
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
  /**
   * Children the pass could not account for. A pass that listed the folder
   * knows both numbers and stamps them (writing neither when both are zero, so
   * a healthy mount stays quiet); a pass that never got a listing passes null
   * and the last known counts stay put rather than being reset to zero.
   */
  problems: FolderProblemCounts | null;
}

/** Re-stamp a folder card's Drive metadata and last-sync outcome. */
export async function stampGfolderCard(cardPath: string, stamp: FolderStamp): Promise<void> {
  const parts = await readCardParts(cardPath);
  if (stamp.link !== null) parts.fields["drive"] = { ...driveMap(parts), link: stamp.link };
  if (stamp.name !== null) parts.fields["title"] = stamp.name;
  parts.fields["last-sync"] = stamp.lastSync;
  if (stamp.problems !== null) {
    stampCount(parts.fields, { key: "not-in-folder", count: stamp.problems.notInFolder });
    stampCount(parts.fields, { key: "unknown", count: stamp.problems.unknown });
  }
  // `error` present is how the card says the sync failed, so a failure with
  // no message still writes one.
  if (stamp.error === null) delete parts.fields["error"];
  else parts.fields["error"] = stamp.error === "" ? "Sync failed without a message" : stamp.error;
  await writeCardParts(cardPath, parts);
}

/** A count worth reporting is written; zero removes the field entirely. */
function stampCount(fields: Record<string, unknown>, entry: { key: string; count: number }): void {
  if (entry.count === 0) delete fields[entry.key];
  else fields[entry.key] = entry.count;
}

/**
 * Re-stamp a pointer's Drive metadata. The body — purpose notes someone wrote
 * — and `origin` are left exactly as they are; a pointer whose body the
 * connector rewrote would lose the only thing it is really for.
 */
export async function stampGlinkCard(cardPath: string, file: DriveFile): Promise<boolean> {
  const parts = await readCardParts(cardPath);
  const before = JSON.stringify(parts.fields);
  const drive = driveMap(parts);
  if (file.webViewLink !== undefined) drive["link"] = file.webViewLink;
  drive["mime"] = file.mimeType;
  parts.fields["drive"] = drive;
  parts.fields["title"] = file.name;
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
function driveViewLink(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

/** The canonical Drive URL for a folder, when the API did not send one. */
export function driveFolderLink(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}
