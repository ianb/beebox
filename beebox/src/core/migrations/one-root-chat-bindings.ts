/**
 * Track E addendum (finding 5a): rewrite `.beebox/chat-session-history.json`'s
 * per-session `contextDir` (a box-relative landmark directory, v2 form —
 * e.g. `"store/recipes"`) through the same v2→v3 mapping every card ref goes
 * through. JSON-aware (parse/mutate/reserialize), not a text substitution —
 * a `store/recipes` SUBSTRING could otherwise collide with something
 * unrelated. Split out of `one-root-run.ts` purely to keep that file under
 * the repo's 300-line budget.
 *
 * Also returns the box's Claude Code transcript cwd pairs (box root always,
 * plus one per distinct mapped `contextDir`) so the caller can re-key
 * `~/.claude/projects/` AFTER the box's own commit lands
 * (`one-root-claude-projects.ts`'s `migrateClaudeProjectDirs`) — those
 * directories are keyed by the cwd the SDK ran with, which is about to
 * change.
 *
 * `.beebox/chat-thread-sessions.json` (and its sibling `chat-sessions.json`)
 * are NOT rewritten here: they're keyed by connector `threadRef` (a
 * Telegram/etc. thread id), not a box-relative path — nothing in their
 * schema (`SessionRecordSchema`, `chat/session/pool.ts`) carries a
 * `contextDir` to map.
 *
 * Finding 3 (round 4 hardening): the original bytes used to come back only
 * in this function's RETURN value — so a caller that assigns
 * `originalHistoryBytes = result.originalRaw` after `await`ing this function
 * never runs that assignment if the write below throws (a truncating failed
 * write, say), leaving rollback's restore slot at its initial `null` even
 * though the pre-write bytes were sitting in local scope the whole time.
 * `originalBytesOut` is the caller-owned journal-style fix (same pattern as
 * `one-root-move-plan.ts`'s `executeMoves` journal): mutated in place the
 * MOMENT the bytes are read, before any write is attempted, so the caller's
 * `catch` sees the true original regardless of whether this function later
 * throws. The write itself now goes through {@link writeFileAtomic} (temp +
 * rename) so a crash mid-write can never truncate the file in the first
 * place — the caller-owned capture is the belt to that atomic write's
 * suspenders, covering a rejection from any cause (disk full, EACCES, …),
 * not just a torn write.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../../lib/error-guards.js";
import { isRecord } from "../../lib/is-record.js";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import { mapV2Path } from "./one-root-mapping.js";
import type { CwdRemap } from "./one-root-claude-projects.js";

export async function rewriteChatBindings(params: {
  packageRoot: string;
  contentRoot: string;
  /** Caller-owned output slot for the pre-write bytes — see the module doc
   * comment's Finding 3. `.value` stays `null` when there's no history file
   * to begin with (ENOENT); otherwise it is set to the bytes read, BEFORE
   * any write is attempted. */
  originalBytesOut: { value: string | null };
}): Promise<{ cwdPairs: CwdRemap[] }> {
  const historyPath = path.join(params.packageRoot, ".beebox", "chat-session-history.json");
  const cwdPairs: CwdRemap[] = [{ oldCwd: params.contentRoot, newCwd: params.packageRoot }];

  let raw: string;
  try {
    raw = await fs.readFile(historyPath, "utf-8");
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw e;
    return { cwdPairs };
  }
  params.originalBytesOut.value = raw;
  if (raw.trim() === "") return { cwdPairs };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (_e) {
    // Malformed history file: not this migration's job to repair — leave it
    // untouched. A stale v2-form binding just won't resolve to a transcript.
    return { cwdPairs };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed["sessions"])) return { cwdPairs };

  let changed = false;
  for (const session of parsed["sessions"]) {
    if (!isRecord(session)) continue;
    const contextDir = session["contextDir"];
    if (typeof contextDir !== "string" || contextDir === "") continue;
    const mapped = mapV2Path(contextDir);
    if (mapped.kind !== "move") continue; // an unmappable binding is left as written, same as any other stale ref
    cwdPairs.push({
      oldCwd: path.join(params.contentRoot, contextDir),
      newCwd: path.join(params.packageRoot, mapped.newPath),
    });
    session["contextDir"] = mapped.newPath;
    changed = true;
  }
  if (changed) await writeFileAtomic(historyPath, { content: JSON.stringify(parsed, null, 2) });
  return { cwdPairs };
}
