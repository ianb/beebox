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
import { mapInBatches } from "../lib/map-batched.js";
import { loadCardFrontmatter } from "./frontmatter-field.js";
import { countOnPlateTodos } from "./todo/count.js";

export interface NavCounts {
  /** Question cards still awaiting an answer (`status: pending`). */
  pendingQuestions: number;
  /** Open todos on the plate now — `escalated` (past due) plus `on-plate`. */
  onPlateTodos: number;
}

/** Question cards read at once — see {@link mapInBatches}. */
const READ_CONCURRENCY = 64;

/**
 * Counts a question as pending on its raw `status` field, without a full
 * schema-validating load. That means a question card whose frontmatter is
 * otherwise invalid still counts if it says `status: pending` — which is the
 * behavior we want (a broken card the boxholder must fix is exactly the one
 * that shouldn't silently vanish from the badge, the same rule
 * `status.questions` follows for its `invalid` rows). `status.status` shares
 * this count rather than deriving its own, so the two can't disagree.
 */
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

  const frontmatters = await mapInBatches(
    names.filter((name) => name.endsWith(".card")),
    { size: READ_CONCURRENCY, map: (name) => loadCardFrontmatter(path.join(dir, name)) },
  );
  // A question whose frontmatter won't parse at all can't claim to be pending;
  // it surfaces as an invalid card through `status.questions` / `cb validate`.
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
