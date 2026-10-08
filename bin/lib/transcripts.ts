/**
 * Where local agent transcripts live and how to read their metadata. Shared
 * by `bin/skill-usage.ts` (which scans their content) and
 * `bin/coding-feedback.ts` (which only attaches a note to one).
 *
 * - Claude Code: `~/.claude/projects/<encoded cwd>/<sessionId>.jsonl`; the
 *   directory name is the session's starting cwd with every
 *   non-alphanumeric character replaced by `-`. Subagent transcripts sit
 *   under `<sessionId>/subagents/`. Each line carries `cwd` and `sessionId`.
 *   The running session exports `CLAUDE_CODE_SESSION_ID` to its commands.
 * - Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-<local time>-<threadId>.jsonl`;
 *   the first line is `session_meta` with `cwd`, `id`, and `thread_source`.
 *   The running thread exports `CODEX_THREAD_ID` to its commands.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

export type Json = Record<string, unknown>;

export function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** True when `cwd` is one of `roots` or below one. */
export function inRepo(cwd: string, roots: string[]): boolean {
  return roots.some((root) => cwd === root || cwd.startsWith(`${root}/`));
}

/** Parsed JSONL records; torn lines (a transcript still being written) are skipped. */
export async function* readJsonl(file: string): AsyncGenerator<Json> {
  const input = fs.createReadStream(file);
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
      if (isRecord(parsed)) yield parsed;
    }
  } finally {
    // An early return (a metadata reader stops at its first match) must not
    // leave the file descriptor open.
    rl.close();
    input.destroy();
  }
}

/** Claude's project-directory name for a cwd. */
export function claudeProjectName(cwd: string): string {
  return cwd.replaceAll(/[^\dA-Za-z]/g, "-");
}

/** Every Claude project directory once (renamed checkouts are symlinked aliases). */
export function claudeProjectDirs(projectsRoot: string): string[] {
  const seen = new Set<string>();
  for (const entry of fs.existsSync(projectsRoot) ? fs.readdirSync(projectsRoot) : []) {
    let real: string;
    try {
      real = fs.realpathSync(path.join(projectsRoot, entry));
    } catch (error) {
      if (error instanceof Error) continue;
      throw error;
    }
    if (fs.statSync(real).isDirectory()) seen.add(real);
  }
  return [...seen];
}

/** Codex day directories (`sessions/YYYY/MM/DD`) with their `YYYY-MM-DD` date, oldest first. */
export function codexDayDirs(sessionsRoot: string): { date: string; dir: string }[] {
  /** Numbered subdirectories only; `.DS_Store` and stray files are not dates. */
  const numbered = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && /^\d+$/.test(e.name)).map((e) => e.name).toSorted();
  const days: { date: string; dir: string }[] = [];
  for (const y of fs.existsSync(sessionsRoot) ? numbered(sessionsRoot) : []) {
    for (const m of numbered(path.join(sessionsRoot, y))) {
      for (const d of numbered(path.join(sessionsRoot, y, m))) days.push({ date: `${y}-${m}-${d}`, dir: path.join(sessionsRoot, y, m, d) });
    }
  }
  return days;
}

/** The first `cwd` a Claude transcript records; reads lines only until one carries it. */
export async function claudeTranscriptCwd(file: string): Promise<string> {
  for await (const o of readJsonl(file)) {
    const cwd = str(o.cwd);
    if (cwd) return cwd;
  }
  return "";
}

/** A Codex rollout's `session_meta` payload (its first line), or null. */
export async function codexSessionMeta(file: string): Promise<Json | null> {
  for await (const o of readJsonl(file)) {
    return o.type === "session_meta" && isRecord(o.payload) ? o.payload : null;
  }
  return null;
}
