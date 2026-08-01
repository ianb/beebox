/**
 * The two badge counts the app nav renders on EVERY page: pending questions
 * and on-plate todos.
 *
 * The nav mounts globally, so its status query is the one server-side cost
 * every single page load pays — it must stay cheap. That's why this reads the
 * questions directory's frontmatter directly instead of going through
 * `getSystemState`, which additionally runs `git status`, a `git log`, a full
 * inbox scan, and a full card *load* (schema validation, body parse) of every
 * question — all of it discarded for a count of one field.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getBoxDir } from "../lib/paths.js";
import { errnoCode } from "../lib/error-guards.js";
import { loadCardFrontmatter } from "./frontmatter-field.js";
import { countOnPlateTodos } from "./todo/count.js";

export interface NavCounts {
  /** Question cards still awaiting an answer (`status: pending`). */
  pendingQuestions: number;
  /** Open todos on the plate now — `escalated` (past due) plus `on-plate`. */
  onPlateTodos: number;
}

async function countPendingQuestions(boxRoot: string): Promise<number> {
  const dir = getBoxDir(boxRoot, "questions");
  let names: string[];
  try {
    names = await fs.readdir(dir, { recursive: true });
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`nav-counts: could not read ${dir}, counting zero pending questions:`, e);
    }
    return 0;
  }

  const frontmatters = await Promise.all(
    names
      .filter((name) => name.endsWith(".card"))
      .map((name) => loadCardFrontmatter(path.join(dir, name))),
  );
  // A question whose frontmatter won't parse is not countable as pending; it
  // surfaces as an invalid card through `status.questions` / `cb validate`.
  return frontmatters.filter((fm) => fm !== null && fm["status"] === "pending").length;
}

/** Both nav badge counts, computed concurrently. */
export async function getNavCounts(boxRoot: string): Promise<NavCounts> {
  const [pendingQuestions, onPlateTodos] = await Promise.all([
    countPendingQuestions(boxRoot),
    countOnPlateTodos(boxRoot),
  ]);
  return { pendingQuestions, onPlateTodos };
}
