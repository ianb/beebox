/**
 * Enumerate a box's browser-task cards with their derived state: which are
 * due, which have never run, how many batches wait. Backs the tRPC list and
 * the dashboard's "browser tasks due" card.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseCardText, cardFields } from "../card-io.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { BrowserTaskSchema, BROWSER_TASK_INBOX_DIR } from "../../schemas/browser-task.js";
import { attachDirFor } from "../../shared/attach-path.js";
import { browserTaskState, type BrowserTaskState } from "../../shared/browser-task-state.js";
import { errnoCode } from "../../lib/error-guards.js";

export interface BrowserTaskListItem {
  /** Box-relative card path. */
  path: string;
  title: string;
  source: string;
  status: "open" | "closed";
  state: BrowserTaskState;
  inboxCount: number;
  runCount: number;
}

const CONTENT_DIR = "_content";
const SUFFIX = ".browser-task.card";

async function walkTaskCards(root: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(root, { recursive: true });
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return [];
    throw e;
  }
  return entries.filter((rel) => rel.endsWith(SUFFIX) && !rel.split(path.sep).some((seg) => seg.startsWith("."))).toSorted();
}

async function countDirs(dir: string): Promise<number> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).length;
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return 0;
    throw e;
  }
}

export async function listBrowserTasks(boxRoot: string, nowMs: number): Promise<BrowserTaskListItem[]> {
  const schemas = await createCardSchemaMap(boxRoot);
  const contentRoot = path.join(boxRoot, CONTENT_DIR);
  const items: BrowserTaskListItem[] = [];
  for (const rel of await walkTaskCards(contentRoot)) {
    const cardRel = path.join(CONTENT_DIR, rel).split(path.sep).join("/");
    const abs = path.join(boxRoot, cardRel);
    let text: string;
    try {
      text = await fs.readFile(abs, "utf8");
    } catch (e) {
      if (errnoCode(e) === "ENOENT") continue;
      throw e;
    }
    let fields;
    try {
      fields = cardFields(parseCardText(text, { source: cardRel, schemas }), BrowserTaskSchema);
    } catch (e) {
      // A card that fails to parse is reported by `bbx validate`; the list
      // is a dashboard glance, not a second validator.
      console.warn(`[browser-task] skipping unparsable card ${cardRel}:`, e);
      continue;
    }
    const inboxCount = await countDirs(path.join(boxRoot, attachDirFor(cardRel), BROWSER_TASK_INBOX_DIR));
    items.push({
      path: cardRel,
      title: typeof fields["title"] === "string" ? fields["title"] : path.basename(cardRel, SUFFIX),
      source: fields.source,
      status: fields.status,
      state: browserTaskState({ status: fields.status, lastUpload: fields["last-upload"], rescanAfter: fields["rescan-after"] }, nowMs),
      inboxCount,
      runCount: fields.runs?.length ?? 0,
    });
  }
  return items;
}
