/**
 * System state inspection.
 *
 * Provides utilities for querying the current state of the callback box,
 * used by both the CLI and webapp.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getBoxDir, parseCardName, requireBoxRoot } from "../cli/lib/paths.js";
import { getStatus, getLog, type GitStatus, type GitLogEntry } from "../cli/lib/git.js";
import { loadCardFile } from "./card-io.js";
import { createCardSchemaMap, getAllSchemas } from "../schemas/registry.js";
import { getBoxMetadata } from "./box.js";
import type { ElementSchema } from "cardworks";

export interface CardInfo {
  path: string;
  relativePath: string;
  name: string;
  type: string;
  tagName: string;
  status?: string | undefined;
  /** Subdirectory within the parent dir (e.g., "news" for inbox/news/) */
  subdir?: string | undefined;
}

export interface SystemState {
  boxRoot: string;
  boxVersion: string;
  created: string;
  git: GitStatus;
  inbox: CardInfo[];
  questions: CardInfo[];
  recentActivity: GitLogEntry[];
}

/**
 * Parameters for scanCards
 */
interface ScanCardsParams {
  dir: string;
  boxRoot: string;
  subdir?: string;
}

/**
 * Scan a directory for card files, including subdirectories.
 *
 * @param params - Parameters object
 * @returns Array of card info
 */
async function scanCards(params: ScanCardsParams): Promise<CardInfo[]> {
  const { dir, boxRoot, subdir } = params;
  const cards: CardInfo[] = [];
  const cardSchemas = createCardSchemaMap();
  const elementSchemasArr = await getAllSchemas(boxRoot);
  const elementSchemas = new Map<string, ElementSchema>();
  for (const s of elementSchemasArr) elementSchemas.set(s.tagName, s);

  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return cards;
  }

  for (const entry of entries) {
    const name = entry.name;
    const fullPath = path.join(dir, name);

    if (entry.isDirectory() && !name.startsWith(".")) {
      const subdirCards = await scanCards({ dir: fullPath, boxRoot, subdir: name });
      cards.push(...subdirCards);
      continue;
    }

    if (!name.endsWith(".card")) continue;

    const parsed = parseCardName(name);
    if (!parsed) continue;

    try {
      const loaded = await loadCardFile(fullPath, { cardSchemas, elementSchemas });
      if (loaded.kind === "frontmatter") {
        cards.push({
          path: fullPath,
          relativePath: path.relative(boxRoot, fullPath),
          name: parsed.name,
          type: parsed.type,
          tagName: loaded.schema.type,
          status: typeof loaded.fields["status"] === "string" ? loaded.fields["status"] : undefined,
          subdir,
        });
      } else {
        cards.push({
          path: fullPath,
          relativePath: path.relative(boxRoot, fullPath),
          name: parsed.name,
          type: parsed.type,
          tagName: loaded.element.tagName,
          status: loaded.element.attrs["status"],
          subdir,
        });
      }
    } catch {
      cards.push({
        path: fullPath,
        relativePath: path.relative(boxRoot, fullPath),
        name: parsed.name,
        type: parsed.type,
        tagName: "unknown",
        status: undefined,
        subdir,
      });
    }
  }

  return cards;
}

/**
 * Get the current system state.
 *
 * @param boxRoot - Optional box root (will be auto-detected if not provided)
 * @returns The system state
 */
export async function getSystemState(boxRoot?: string): Promise<SystemState> {
  const root = boxRoot ?? await requireBoxRoot();
  const metadata = await getBoxMetadata(root);

  if (!metadata) {
    throw new Error("Invalid callback box: missing marker file");
  }

  const [git, inbox, questions, recentActivity] = await Promise.all([
    getStatus(root),
    scanCards({ dir: getBoxDir(root, "inbox"), boxRoot: root }),
    scanCards({ dir: getBoxDir(root, "questions"), boxRoot: root }),
    getLog(root, 10),
  ]);

  return {
    boxRoot: root,
    boxVersion: metadata.version,
    created: metadata.created,
    git,
    inbox,
    questions,
    recentActivity,
  };
}

