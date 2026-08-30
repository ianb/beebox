/**
 * System state inspection.
 *
 * Provides utilities for querying the current state of the Bee Box,
 * used by both the CLI and webapp.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getBoxDir, parseCardName, requireBoxRoot } from "../lib/paths.js";
import { getStatus, getLog, type GitStatus, type GitLogEntry } from "../lib/git.js";
import { loadCardFile } from "./card-io.js";
import { buildLoadContext } from "./load-context.js";
import type { LoadCardContext } from "./card-io.js";
import { getBoxMetadata } from "./box/index.js";
import { errnoCode } from "../lib/error-guards.js";

class InvalidBoxError extends Error {
  constructor() {
    super("Invalid Bee Box: missing marker file");
    this.name = "InvalidBoxError";
  }
}

export interface CardInfo {
  path: string;
  relativePath: string;
  name: string;
  type: string;
  status?: string | undefined;
  /** Subdirectory within the parent dir (e.g., "email" for inbox/email/) */
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
  /** Built once per scan and threaded through the recursion — see {@link scanCards}. */
  ctx: LoadCardContext;
}

/**
 * Scan a directory for card files, including subdirectories.
 *
 * The load context is built by the caller rather than here: this recurses per
 * subdirectory, and rebuilding the context at every level re-resolved the
 * box's schemas over and over for a scan that only ever needs one.
 *
 * @param params - Parameters object
 * @returns Array of card info
 */
async function scanCards(params: ScanCardsParams): Promise<CardInfo[]> {
  const { dir, boxRoot, subdir, ctx } = params;
  const cards: CardInfo[] = [];

  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`Could not read card directory ${dir}, treating as empty:`, e);
    }
    return cards;
  }

  for (const entry of entries) {
    const name = entry.name;
    const fullPath = path.join(dir, name);

    if (entry.isDirectory() && !name.startsWith(".")) {
      const subdirCards = await scanCards({ dir: fullPath, boxRoot, subdir: name, ctx });
      cards.push(...subdirCards);
      continue;
    }

    if (!name.endsWith(".card")) continue;

    const parsed = parseCardName(name);
    if (!parsed) continue;

    try {
      const loaded = await loadCardFile(fullPath, ctx);
      cards.push({
        path: fullPath,
        relativePath: path.relative(boxRoot, fullPath),
        name: parsed.name,
        type: parsed.type,
        status: typeof loaded.fields["status"] === "string" ? loaded.fields["status"] : undefined,
        subdir,
      });
    } catch (e) {
      console.warn(`Could not load card ${fullPath}, listing as unknown:`, e);
      cards.push({
        path: fullPath,
        relativePath: path.relative(boxRoot, fullPath),
        name: parsed.name,
        type: parsed.type,
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
    throw new InvalidBoxError();
  }

  const ctx = await buildLoadContext(root);
  const [git, inbox, questions, recentActivity] = await Promise.all([
    getStatus(root),
    scanCards({ dir: getBoxDir(root, "inbox"), boxRoot: root, ctx }),
    scanCards({ dir: getBoxDir(root, "questions"), boxRoot: root, ctx }),
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

