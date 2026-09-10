/**
 * Track E addendum: re-key Claude Code's per-cwd transcript storage
 * (`~/.claude/projects/<encoded-cwd>/`, `transcript-paths.ts`) after the
 * one-root migration moves a box's operating cwd from `<packageRoot>/content`
 * (and any landmark subdirectory under it) to `<packageRoot>` itself (and the
 * corresponding v3 subdirectory). Without this, every existing chat/wakeup
 * transcript becomes unreachable — `getSessionLogPath` encodes the CURRENT
 * cwd, so a session recorded under the old encoding is orphaned the moment
 * the box's cwd changes.
 *
 * Mirrors `beebox/deploy/migrate-to-beebox-user.sh`'s `remap_claude_projects`
 * (written for the whole-machine Bee Box home-directory migration,
 * `git log -S claude/projects`) — same rename-or-merge shape, adapted to a
 * per-box, per-cwd-pair move instead of a single global home-prefix rewrite.
 *
 * `claudeProjectsRoot()` already honors `BBX_CLAUDE_PROJECTS_DIR`
 * (`transcript-paths.ts`), so a doctest can point this whole module at a
 * fixture directory instead of the real `~/.claude/projects` — nothing here
 * needs its own override.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { claudeProjectsRoot, encodeProjectDir } from "../chat/session/transcript-paths.js";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";

export interface CwdRemap {
  oldCwd: string;
  newCwd: string;
}

export interface RenamedProjectDir {
  oldDir: string;
  newDir: string;
}

class ClaudeTranscriptConflictError extends Error {
  constructor(params: { from: string; to: string }) {
    super(
      `Claude transcript conflict: ${params.from} and ${params.to} both exist with different content — reconcile by hand.`,
    );
    this.name = "ClaudeTranscriptConflictError";
  }
}

async function pathExists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true, () => false);
}

/**
 * Move one encoded `~/.claude/projects/<dir>` directory from `oldCwd`'s key
 * to `newCwd`'s. A straight rename when the destination doesn't exist yet; a
 * per-file merge when it does (a retried migration, or an unrelated cwd that
 * happens to encode to the same key) — content-identical collisions are
 * deduped, a genuine conflict is left in place rather than picked between.
 * Returns `null` when there was nothing to move (no transcripts under the
 * old key).
 *
 * Best-effort by design: this rewrites bookkeeping OUTSIDE the box (global,
 * per-machine Claude Code state), the same standing `one-root-manifests.ts`
 * gives `hub.json`/`boxes.json` — a failure here degrades chat-history
 * discovery, not the box's own data, so callers log and continue rather than
 * fail the migration over it.
 */
async function renameClaudeProjectDir(params: CwdRemap): Promise<RenamedProjectDir | null> {
  const root = claudeProjectsRoot();
  const oldDir = path.join(root, encodeProjectDir(params.oldCwd));
  const newDir = path.join(root, encodeProjectDir(params.newCwd));
  if (oldDir === newDir) return null;
  if (!(await pathExists(oldDir))) return null;

  if (!(await pathExists(newDir))) {
    await fs.rename(oldDir, newDir);
    return { oldDir, newDir };
  }

  for (const child of await fs.readdir(oldDir)) {
    const from = path.join(oldDir, child);
    const to = path.join(newDir, child);
    if (!(await pathExists(to))) {
      await fs.rename(from, to);
      continue;
    }
    const [a, b] = await Promise.all([fs.readFile(from), fs.readFile(to)]);
    if (Buffer.compare(a, b) === 0) {
      await fs.unlink(from);
      continue;
    }
    throw new ClaudeTranscriptConflictError({ from, to });
  }
  await fs.rmdir(oldDir).catch((e: unknown) => {
    // Non-empty (a conflicting child was deliberately left behind above) or
    // already gone — either way, not fatal to the rename itself.
    console.warn(`one-root: could not remove emptied Claude project dir ${oldDir}: ${errorMessage(e)}`);
  });
  return { oldDir, newDir };
}

/**
 * Re-key every `~/.claude/projects/` directory implicated by one box's
 * `oldCwd -> newCwd` pairs (the box root, plus one per distinct landmark
 * `contextDir` the chat-session-history rewrite found). Never throws for an
 * individual pair's failure — logs it (`console.error`: a human needs to
 * investigate a stranded transcript dir) and moves on to the rest, since this
 * runs only after the box's own migration commit has already landed.
 */
export async function migrateClaudeProjectDirs(pairs: CwdRemap[]): Promise<RenamedProjectDir[]> {
  const renamed: RenamedProjectDir[] = [];
  for (const pair of pairs) {
    try {
      const result = await renameClaudeProjectDir(pair);
      if (result !== null) renamed.push(result);
    } catch (e) {
      if (errnoCode(e) === "ENOENT") continue;
      console.error(
        `one-root migration: failed to re-key Claude transcript dir for ${pair.oldCwd} -> ${pair.newCwd}: ${errorMessage(e)}`,
      );
    }
  }
  return renamed;
}
