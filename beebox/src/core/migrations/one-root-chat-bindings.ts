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
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../../lib/error-guards.js";
import { isRecord } from "../../lib/is-record.js";
import { mapV2Path } from "./one-root-mapping.js";
import type { CwdRemap } from "./one-root-claude-projects.js";

export async function rewriteChatBindings(params: {
  packageRoot: string;
  contentRoot: string;
}): Promise<{ originalRaw: string | null; cwdPairs: CwdRemap[] }> {
  const historyPath = path.join(params.packageRoot, ".beebox", "chat-session-history.json");
  const cwdPairs: CwdRemap[] = [{ oldCwd: params.contentRoot, newCwd: params.packageRoot }];

  let raw: string;
  try {
    raw = await fs.readFile(historyPath, "utf-8");
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw e;
    return { originalRaw: null, cwdPairs };
  }
  if (raw.trim() === "") return { originalRaw: raw, cwdPairs };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (_e) {
    // Malformed history file: not this migration's job to repair — leave it
    // untouched. A stale v2-form binding just won't resolve to a transcript.
    return { originalRaw: raw, cwdPairs };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed["sessions"])) return { originalRaw: raw, cwdPairs };

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
  if (changed) await fs.writeFile(historyPath, JSON.stringify(parsed, null, 2));
  return { originalRaw: raw, cwdPairs };
}
