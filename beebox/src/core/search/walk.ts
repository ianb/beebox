/**
 * Card-file walker for the search index.
 *
 * Enumerates every `*.card` file under a box (including inside `.attach/`
 * scopes — email messages live there) with the stat data the manifest diff
 * needs. Trash and machine directories are excluded.
 */

import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { isInsideAttachScope } from "../../shared/attach-path.js";
import { cardTypeFromName } from "../../shared/card-name.js";
import { errnoCode } from "../../lib/error-guards.js";

/** Directories never descended into. `store/trash` is handled by path. */
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".beebox",
  ".claude", // agent rules/settings — machine config, not box content
  ".scan-archive",
  ".scan-api",
]);

const TRASH_PREFIX = "store/trash";

/** Generated agent docs — regenerable instruction text, not box content. */
const GENERATED_DOCS_PREFIX = "docs/generated";

export interface CardStat {
  mtimeMs: number;
  size: number;
}

/**
 * Stat-walk all searchable files: every `*.card`, plus standalone `*.md`
 * outside attach scopes (attach-scope content belongs to its owning card —
 * gdoc snapshots index via the card; email bodies stay quarantined).
 * Keys are box-relative paths (forward slashes).
 */
export async function walkCardFiles(boxRoot: string): Promise<Map<string, CardStat>> {
  const out = new Map<string, CardStat>();

  async function walk(absDir: string, relDir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch (e) {
      // Deleted-mid-walk or unreadable directories contribute no cards;
      // anything other than a plain disappearance is worth a log line.
      if (errnoCode(e) !== "ENOENT") {
        console.warn(`search walk: could not read ${absDir}, skipping:`, e);
      }
      return;
    }
    for (const entry of entries) {
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (rel === TRASH_PREFIX) continue;
        await walk(path.join(absDir, entry.name), rel);
        continue;
      }
      if (!entry.isFile()) continue;
      const isCard = entry.name.endsWith(".card");
      const isMarkdown =
        entry.name.endsWith(".md")
        && !isInsideAttachScope(rel)
        && !rel.startsWith(`${GENERATED_DOCS_PREFIX}/`);
      if (!isCard && !isMarkdown) continue;
      try {
        const st = await fs.stat(path.join(absDir, entry.name));
        out.set(rel, { mtimeMs: st.mtimeMs, size: st.size });
      } catch (_e) {
        // Race with a delete between readdir and stat — the file is gone;
        // the manifest diff will treat it as removed next round.
      }
    }
  }

  await walk(boxRoot, "");
  return out;
}

/**
 * Card type from a card filename (nominal, positional, or job form), or
 * undefined when the name doesn't follow the convention. Delegates to the
 * canonical grammar so search kinds match schema registration (job cards
 * now resolve to `<kind>-job` instead of the literal `job` — invisible in
 * practice since all job schemas are `searchable: false`).
 */
export function cardTypeFromPath(relPath: string): string | undefined {
  return cardTypeFromName(relPath);
}
