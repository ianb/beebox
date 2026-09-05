/**
 * Transcript path helpers — the pure filesystem layer for Claude Code
 * session logs.
 *
 * Claude Code stores session transcripts as JSONL files at:
 *   ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
 *
 * These helpers live in a dependency-free module (node builtins only) so
 * both the CLI session library and `chat/session/history.ts` can share
 * them without an import cycle: history.ts owns `listSessionRoots`, which
 * reads history AND encodes cwds — if the encoders lived in the CLI layer,
 * history.ts → cli/lib/session.ts → history.ts would close a value cycle.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { errnoCode } from "../../../lib/error-guards.js";
import { containWithinBox } from "../../../lib/box-containment.js";

/**
 * Encode a cwd into Claude Code's `~/.claude/projects/<dir>` key. Claude
 * Code replaces every non-alphanumeric character with `-`, not just `/`
 * — so paths with `_`, `.`, spaces, etc. all collapse to the same shape.
 * Match that here, otherwise `getSessionLogPath` mis-resolves for any
 * cwd containing non-`/` separators (e.g. landmark-session audits).
 *
 * Verified against the Claude Code 2.1.246 binary (`replace(/[^a-zA-Z0-9]/g,
 * "-")`) on 2026-08-25. Every entry in a real store that keeps `_`/`.` was a
 * symlink our own tooling planted, never a transcript dir. Not mirrored: since
 * 2.1.239 a name over 200 characters is cut and suffixed `-<hash>`; no box
 * path comes near that (longest observed: 152), so it is left as a known gap.
 */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^\dA-Za-z]/g, "-");
}

/**
 * Root of Claude Code's per-project transcript storage. Honors the
 * `BBX_CLAUDE_PROJECTS_DIR` env override so doctests (and unusual
 * installs) can point session discovery at a fixture directory instead
 * of the real `~/.claude/projects`.
 */
export function claudeProjectsRoot(): string {
  const override = process.env["BBX_CLAUDE_PROJECTS_DIR"];
  if (override) return override;
  return path.join(os.homedir(), ".claude", "projects");
}

/**
 * The SDK cwd for a session bound to `contextDir`, contained to the box.
 *
 * `contextDir` is a string read off the box's session-history file that gets
 * joined into a path — and it is now joined on behalf of an HTTP request
 * (`webapp/routes/api-session-media.ts` serves a photo out of the resolved
 * transcript). A row naming `../../elsewhere` would point the encoder outside
 * this box, so the join is contained like every other box-path resolution
 * here. An escaping row falls back to the box root rather than being clamped
 * into something plausible: the transcript is then simply not found. Only
 * reachable by something that can already write inside the box — depth, not a
 * live hole.
 */
export function containedSessionCwd(boxRoot: string, contextDir: string | undefined): string {
  if (contextDir === undefined || contextDir === "") return boxRoot;
  const contained = containWithinBox(boxRoot, path.join(boxRoot, contextDir));
  if (contained === null) {
    console.warn(`[chat-history] contextDir ${contextDir} escapes the box; reading from the box root instead`);
    return boxRoot;
  }
  return path.join(boxRoot, contained);
}

/**
 * Get the path to a Claude Code session log file. `cwd` is whatever
 * was passed as the SDK's `cwd` for the run — usually the box root,
 * but a landmark-bound chat or audit uses a subdirectory.
 */
export function getSessionLogPath(cwd: string, sessionId: string): string {
  const claudeDir = path.join(claudeProjectsRoot(), encodeProjectDir(cwd));
  return path.join(claudeDir, `${sessionId}.jsonl`);
}

/**
 * Get the Claude Code projects directory for a given SDK cwd.
 */
export function getSessionDir(cwd: string): string {
  return path.join(claudeProjectsRoot(), encodeProjectDir(cwd));
}

/**
 * Whether `filePath` is a background-task output file that belongs to the
 * box at `boxRoot` — the fail-closed shape check behind `GET
 * /api/task-output` (`webapp/routes/api.ts`).
 *
 * Claude Code writes a background task's output under its OWN tmp root
 * (distinct from `claudeProjectsRoot()`), shaped exactly like:
 *
 *   /private/tmp/claude-<uid>/<encoded agent cwd>/<session-id>/tasks/<id>.output
 *
 * (`/tmp/...` on hosts where `/tmp` isn't a `/private/tmp` symlink.) The
 * `<encoded agent cwd>` segment is `encodeProjectDir` of whatever cwd the
 * agent process ran with — the box root itself, or a landmark-bound
 * subdirectory of it, which `encodeProjectDir`'s all-non-alnum-to-`-`
 * encoding turns into `encodeProjectDir(boxRoot)` followed by a literal
 * `-` and more encoded characters (a `/` in the real path becomes that
 * same `-`). So this box's own segment is an EXACT match or a `-`-prefixed
 * extension of it — never a bare string-prefix match, which would also
 * accept an unrelated box whose encoded root happens to start with the
 * same characters.
 *
 * Pure path-string logic only — no filesystem access, so it's safe to call
 * before any `stat`/`realpath` (and the caller re-checks it AFTER
 * `realpath`, so a symlink inside an otherwise-valid path can't point the
 * read at another box's task output).
 */
export function isTaskOutputPathForBox({ boxRoot, filePath }: { boxRoot: string; filePath: string }): boolean {
  const resolved = path.resolve(filePath);
  const tmpRoot = ["/private/tmp/", "/tmp/"].find((root) => resolved.startsWith(root));
  if (!tmpRoot) return false;

  // Segments after the tmp root: <uid-dir>/<encoded-cwd>/<session-id>/tasks/<file>
  const rest = resolved.slice(tmpRoot.length).split(path.sep);
  const [uidDir, encodedCwd, sessionId, tasksSegment, ...fileSegments] = rest;
  if (uidDir === undefined || !uidDir.startsWith("claude-")) return false;
  if (encodedCwd === undefined || encodedCwd === "") return false;
  if (sessionId === undefined || sessionId === "") return false;
  if (tasksSegment !== "tasks") return false;
  // Exactly one segment after `tasks/` — a plain output file, not a nested path.
  if (fileSegments.length !== 1 || fileSegments[0] === "") return false;

  const encodedBoxRoot = encodeProjectDir(boxRoot);
  return encodedCwd === encodedBoxRoot || encodedCwd.startsWith(`${encodedBoxRoot}-`);
}

/** One session JSONL discovered on disk in a single encoded project dir. */
export interface SessionFileInfo {
  sessionId: string;
  mtime: Date;
  path: string;
}

/**
 * List the session JSONL files in one encoded project directory, sorted
 * newest-first. A missing directory (box/landmark never had a Claude Code
 * run) is the common case — treated as "no sessions". This is the
 * per-directory primitive; `listSessions` (cli/lib/session.ts) aggregates
 * it across every context root a box has.
 */
export async function listSessionFilesInDir(dir: string): Promise<SessionFileInfo[]> {
  let files: string[];
  try {
    files = await fs.promises.readdir(dir);
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.debug("listSessionFilesInDir: could not read session dir, treating as empty:", e);
    }
    return [];
  }

  const sessions: SessionFileInfo[] = [];
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const sessionId = file.replace(/\.jsonl$/, "");
    const filePath = path.join(dir, file);
    try {
      const stat = await fs.promises.stat(filePath);
      sessions.push({ sessionId, mtime: stat.mtime, path: filePath });
    } catch (e) {
      // File vanished between readdir and stat (concurrent cleanup) — skip
      // it rather than fail the whole listing, but note the anomaly.
      if (errnoCode(e) !== "ENOENT") {
        console.debug(`listSessionFilesInDir: could not stat ${filePath}, skipping:`, e);
      }
      continue;
    }
  }

  sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return sessions;
}

/**
 * Whether a session's transcript already exists, for a caller that knows the
 * chat's landmark binding without consulting history.
 *
 * `resolveSessionLogPath` reads the binding from `chat-session-history`, which
 * a coined session does not have an entry in until its first run — so for that
 * session it would answer for the box-root path and miss a landmark chat's
 * transcript entirely. Passing the binding in is what makes the answer correct
 * during the window that matters.
 */
export async function transcriptExistsForContext(
  boxRoot: string,
  opts: { sessionId: string; contextDir: string | null },
): Promise<boolean> {
  const dir = opts.contextDir === null || opts.contextDir === "" ? boxRoot : path.join(boxRoot, opts.contextDir);
  try {
    await fs.promises.access(getSessionLogPath(dir, opts.sessionId));
    return true;
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw e;
    return false;
  }
}
