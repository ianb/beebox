/**
 * Which procedure runs are live: the at-rest gate `bbx tick` and procedure GC
 * consult before touching the box. Split out of `state.ts`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../../shared/error-guards.js";
import { getBoxDir } from "../../lib/paths/core.js";

/**
 * A run card whose mtime is older than this is treated as orphaned —
 * the engine has no signal handler, so when a procedure process is
 * killed (script-timeout, OOM, crash) the run card never gets an
 * outcome. Anything actively running updates the
 * card on every step boundary, and `bbx tick` kills scripts after 10
 * minutes regardless. One hour leaves headroom for unusually long
 * agent steps without letting a months-old corpse block housekeeping.
 */
const STALE_RUN_CARD_AGE_MS = 60 * 60 * 1000;

/**
 * Return the names of any procedure runs that have no outcome yet (they
 * have not finished) AND whose run card has been touched recently. Used
 * to gate housekeeping/tick activity so the system can be "fully at rest"
 * before scheduled work fires.
 *
 * Reads `_bookkeeping/procedure/runs/<runDir>/run.procedure-run.card` and
 * looks for the top-level `outcome:` frontmatter field via regex — full parsing
 * is overkill here and would couple this helper to the schemas package. Stale
 * cards (older than STALE_RUN_CARD_AGE_MS) are skipped so an orphaned card
 * from a long-dead procedure doesn't permanently block the at-rest gate.
 */
export async function loadRunningProcedures(boxRoot: string): Promise<string[]> {
  const runsDir = getBoxDir(boxRoot, "procedureRuns");
  let entries: string[];
  try {
    // Excludes the init-seeded `.gitkeep` (and any other stray file) — only
    // an actual run directory can hold a run card.
    const dirents = await fs.readdir(runsDir, { withFileTypes: true });
    entries = dirents.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`Could not read procedure runs directory ${runsDir}:`, e);
    }
    return [];
  }
  const now = Date.now();
  const running: string[] = [];
  for (const entry of entries) {
    const cardPath = path.join(runsDir, entry, "run.procedure-run.card");
    let mtimeMs: number;
    let content: string;
    try {
      const stat = await fs.stat(cardPath);
      mtimeMs = stat.mtimeMs;
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") {
        console.warn(`Could not stat run card ${cardPath}, skipping:`, e);
      }
      continue;
    }
    if (now - mtimeMs > STALE_RUN_CARD_AGE_MS) continue;
    try {
      content = await fs.readFile(cardPath, "utf-8");
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") {
        console.warn(`Could not read run card ${cardPath}, skipping:`, e);
      }
      continue;
    }
    // A run card (top-level `procedure:`) with no top-level `outcome:` has
    // not finished. Step fields are indented, so the start-of-line anchor
    // skips them.
    if (/^procedure:/m.test(content) && !/^outcome:/m.test(content)) {
      running.push(entry);
    }
  }
  return running;
}
