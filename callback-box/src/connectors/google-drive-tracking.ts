/** Google Drive card discovery shared by sync and `cb drive status`. */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import { parseFrontmatterObject } from "../cards/frontmatter.js";
import { isRecord } from "../lib/is-record.js";
import { getBoxDir } from "../lib/paths.js";
import { invariant } from "../lib/invariant.js";
import { getAllDriveHandlers } from "./drive-types.js";

const DRIVE_CARD_IGNORE = [
  "node_modules/**",
  ".git/**",
  "tmp/**",
  ".callback-box/**",
  "procedure/runs/**",
];

export interface TrackedDriveCard {
  driveId: string;
  absPath: string;
  relPath: string;
  content: string;
}

/** Two or more live cards claiming one Drive ID — an ambiguous working copy. */
export interface DuplicateDriveClaim {
  driveId: string;
  relPaths: string[];
}

export interface DriveCardTracking {
  /** Cards with an unambiguous Drive ID. Duplicates are NOT included. */
  liveCards: TrackedDriveCard[];
  trashedDriveIds: Set<string>;
  /** Drive IDs claimed by more than one live card; none of them are synced. */
  duplicates: DuplicateDriveClaim[];
  /**
   * Card paths (box-relative) whose Drive ID could not be determined — the file
   * could not be read, or it carries no parseable `drive-id`. A card in this
   * list may be a trash tombstone whose retained ID we cannot see, so folder
   * discovery must not run while it is non-empty.
   */
  unreadable: string[];
}

/**
 * Read a card's Drive ID: the current YAML frontmatter form first, the legacy
 * XML attribute form as a fallback.
 *
 * The frontmatter goes through the real YAML parser rather than a line regex —
 * `drive-id: 'sheet-1'` and a trailing `# comment` are both valid YAML that a
 * regex reads as part of the ID, and a wrong ID is worse than no ID here: it
 * silently drops out of the tombstone set and lets folder discovery recreate a
 * deleted card. A card whose frontmatter is unparseable, or whose `drive-id`
 * is not a non-empty string, reads as no ID at all (callers fail closed).
 */
export function driveIdFromCardContent(content: string): string | null {
  const fields = parseFrontmatterObject(content);
  const yamlValue = fields?.["drive-id"];
  if (typeof yamlValue === "string" && yamlValue !== "") return yamlValue;
  if (fields !== null) return null;
  const xmlMatch = /drive-id="([^"]+)"/.exec(content);
  if (!xmlMatch) return null;
  invariant(xmlMatch[1] !== undefined, "capture group 1 is non-optional in xmlMatch");
  return xmlMatch[1];
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== "..";
}

/** Find live Drive cards and the Drive IDs retained as trash tombstones. */
export async function findDriveCardTracking(boxRoot: string): Promise<DriveCardTracking> {
  const matches = new Set<string>();
  for (const handler of getAllDriveHandlers()) {
    const paths = await glob(`**/*.${handler.cardType}.card`, {
      cwd: boxRoot,
      absolute: true,
      nodir: true,
      ignore: DRIVE_CARD_IGNORE,
    });
    for (const cardPath of paths) matches.add(cardPath);
  }

  const trashDir = getBoxDir(boxRoot, "trash");
  const byDriveId = new Map<string, TrackedDriveCard[]>();
  const trashedDriveIds = new Set<string>();
  const unreadable: string[] = [];
  for (const absPath of [...matches].toSorted()) {
    const relPath = path.relative(boxRoot, absPath);
    let content: string;
    try {
      content = await fs.readFile(absPath, "utf-8");
    } catch (_error: unknown) {
      // Includes ENOENT: a card that vanished between the glob and this read
      // was moved or deleted concurrently (a `cb rm` mid-sync moves it to
      // trash), and its trash destination may postdate the glob too — so the
      // ID would be in neither set and folder discovery could recreate the
      // card that was just trashed. Any unread card is ambiguity, not absence.
      unreadable.push(relPath);
      continue;
    }
    const driveId = driveIdFromCardContent(content);
    if (driveId === null) {
      unreadable.push(relPath);
      continue;
    }
    if (isWithin(trashDir, absPath)) {
      trashedDriveIds.add(driveId);
      continue;
    }
    const card: TrackedDriveCard = { driveId, absPath, relPath, content };
    const existing = byDriveId.get(driveId);
    if (existing) existing.push(card);
    else byDriveId.set(driveId, [card]);
  }

  const liveCards: TrackedDriveCard[] = [];
  const duplicates: DuplicateDriveClaim[] = [];
  for (const [driveId, cards] of byDriveId) {
    const first = cards[0];
    if (cards.length === 1 && first !== undefined) {
      liveCards.push(first);
      continue;
    }
    // Neither copy is authoritative: the transient hashes are keyed by Drive
    // ID alone, so syncing either one can push its stale attachments over the
    // other's edit. Drop both from the working set and let callers report it.
    duplicates.push({ driveId, relPaths: cards.map((card) => card.relPath) });
  }
  liveCards.sort((a, b) => a.relPath.localeCompare(b.relPath));
  duplicates.sort((a, b) => a.driveId.localeCompare(b.driveId));
  return { liveCards, trashedDriveIds, duplicates, unreadable };
}

/** Health fields `cb drive status` prints, from a YAML or legacy XML card. */
export interface DriveCardSummary {
  title: string | null;
  modified: string | null;
  status: string | null;
  tabs: string[];
  lossy: Array<{ type: string; count: number }>;
}

function xmlSummary(content: string): DriveCardSummary {
  const titleMatch = /<title>([^<]+)<\/title>/.exec(content);
  const modifiedMatch = /<modified>([^<]+)<\/modified>/.exec(content);
  const statusMatch = /\bstatus="([^"]+)"/.exec(content);
  const tabs = [...content.matchAll(/<sheet-tab[^>]*\btitle="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((title): title is string => title !== undefined);
  const lossy: Array<{ type: string; count: number }> = [];
  for (const match of content.matchAll(/<item type="([^"]+)" count="([^"]+)"/g)) {
    const [, type, rawCount] = match;
    if (type === undefined || rawCount === undefined) continue;
    const count = Number.parseInt(rawCount, 10);
    lossy.push({ type, count: Number.isNaN(count) ? 0 : count });
  }
  return {
    title: titleMatch?.[1] ?? null,
    modified: modifiedMatch?.[1] ?? null,
    status: statusMatch?.[1] ?? null,
    tabs,
    lossy,
  };
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Read a Drive card's health fields without the schema machinery.
 *
 * Current cards (`schemas/gsheet.tsx`, `schemas/gdoc.tsx`) are YAML
 * frontmatter; the legacy XML element form is still on disk in older boxes, so
 * it stays as a fallback. Frontmatter wins when present.
 */
export function driveCardSummary(content: string): DriveCardSummary {
  const fields = parseFrontmatterObject(content);
  if (fields === null) return xmlSummary(content);

  const tabs: string[] = [];
  const sheets = fields["sheets"];
  if (Array.isArray(sheets)) {
    for (const sheet of sheets) {
      if (!isRecord(sheet)) continue;
      const title = optionalString(sheet["title"]);
      if (title !== null) tabs.push(title);
    }
  }

  const lossy: Array<{ type: string; count: number }> = [];
  const lossyField = fields["lossy"];
  if (Array.isArray(lossyField)) {
    for (const item of lossyField) {
      if (!isRecord(item)) continue;
      const type = optionalString(item["type"]);
      const count = item["count"];
      if (type === null || typeof count !== "number") continue;
      lossy.push({ type, count });
    }
  }

  return {
    title: optionalString(fields["title"]),
    modified: optionalString(fields["modified"]),
    status: optionalString(fields["status"]),
    tabs,
    lossy,
  };
}
