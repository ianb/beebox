/**
 * Attach a CODING_FEEDBACK entry to the session that wrote it.
 *
 * Order: explicit flags, then the harness's exported session id
 * (`CLAUDE_CODE_SESSION_ID` for Claude Code, `CODEX_THREAD_ID` for Codex),
 * then the most recently modified transcript whose recorded cwd is this
 * checkout. Transcript content is never read beyond the cwd metadata that
 * matching needs (`bin/lib/transcripts.ts`).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { SessionNotFoundError, TranscriptNotFoundError } from "./coding-feedback-errors.ts";
import type { Engine, SessionAttachment } from "./coding-feedback.ts";
import {
  claudeProjectDirs, claudeProjectName, claudeTranscriptCwd, codexDayDirs, codexSessionMeta, inRepo, str,
} from "./transcripts.ts";

const SESSION_ENV: Record<Engine, string> = { claude: "CLAUDE_CODE_SESSION_ID", codex: "CODEX_THREAD_ID" };

export interface ResolveInput {
  home: string;
  env: Record<string, string | undefined>;
  /** Spellings of this checkout's root (as given and realpath'd). */
  checkoutRoots: string[];
  engine?: Engine;
  session?: string;
  transcript?: string;
  now: Date;
}

interface Found {
  engine: Engine;
  sessionId: string;
  transcriptPath: string | null;
}

const claudeRoot = (home: string): string => path.join(home, ".claude", "projects");
const codexRoot = (home: string): string => path.join(home, ".codex", "sessions");

function mtimeOf(file: string | null): number {
  if (!file) return -1;
  try {
    return fs.statSync(file).mtimeMs;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return -1;
    throw error;
  }
}

function listJsonl(dir: string): string[] {
  return fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(dir, f));
}

/** Codex rollouts, newest day first. */
function codexRollouts(home: string): string[] {
  return codexDayDirs(codexRoot(home)).toReversed().flatMap((d) => listJsonl(d.dir));
}

/** The transcript file for a known session id, or null when none is on disk. */
function transcriptForSession(home: string, session: { engine: Engine; sessionId: string }): string | null {
  const { engine, sessionId } = session;
  if (engine === "claude") {
    for (const dir of claudeProjectDirs(claudeRoot(home))) {
      const file = path.join(dir, `${sessionId}.jsonl`);
      if (fs.existsSync(file)) return file;
    }
    return null;
  }
  return codexRollouts(home).find((f) => path.basename(f).endsWith(`-${sessionId}.jsonl`)) ?? null;
}

function sessionIdFromPath(engine: Engine, file: string): string {
  const base = path.basename(file, ".jsonl");
  if (engine === "claude") return base;
  return /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u.exec(base)?.[1] ?? base;
}

function fromFlags(input: ResolveInput): Found | null {
  if (input.transcript !== undefined) {
    const transcriptPath = path.resolve(input.transcript);
    if (!fs.existsSync(transcriptPath)) throw new TranscriptNotFoundError(transcriptPath);
    const engine = input.engine ?? (transcriptPath.includes(`${path.sep}.codex${path.sep}`) ? "codex" : "claude");
    return { engine, sessionId: input.session ?? sessionIdFromPath(engine, transcriptPath), transcriptPath };
  }
  if (input.session === undefined) return null;
  const engines: Engine[] = input.engine ? [input.engine] : ["claude", "codex"];
  for (const engine of engines) {
    const transcriptPath = transcriptForSession(input.home, { engine, sessionId: input.session });
    if (transcriptPath) return { engine, sessionId: input.session, transcriptPath };
  }
  if (!input.engine) throw new SessionNotFoundError(input.session);
  return { engine: input.engine, sessionId: input.session, transcriptPath: null };
}

/**
 * Both variables are set when one harness runs inside the other (a Codex
 * reviewer launched from Claude inherits `CLAUDE_CODE_SESSION_ID`). The live
 * session is the one whose transcript was written most recently.
 */
function fromEnv(input: ResolveInput): Found | null {
  const engines: Engine[] = input.engine ? [input.engine] : ["claude", "codex"];
  const found: Found[] = [];
  for (const engine of engines) {
    const sessionId = input.env[SESSION_ENV[engine]];
    if (!sessionId) continue;
    found.push({ engine, sessionId, transcriptPath: transcriptForSession(input.home, { engine, sessionId }) });
  }
  return found.toSorted((a, b) => mtimeOf(b.transcriptPath) - mtimeOf(a.transcriptPath))[0] ?? null;
}

async function newestClaude(input: ResolveInput): Promise<Found | null> {
  const names = input.checkoutRoots.map(claudeProjectName);
  const dirs = claudeProjectDirs(claudeRoot(input.home))
    .filter((dir) => names.some((n) => path.basename(dir) === n || path.basename(dir).startsWith(`${n}-`)));
  const files = dirs.flatMap(listJsonl).toSorted((a, b) => mtimeOf(b) - mtimeOf(a));
  for (const file of files) {
    if (inRepo(await claudeTranscriptCwd(file), input.checkoutRoots)) {
      return { engine: "claude", sessionId: sessionIdFromPath("claude", file), transcriptPath: file };
    }
  }
  return null;
}

async function newestCodex(input: ResolveInput): Promise<Found | null> {
  const files = codexRollouts(input.home).toSorted((a, b) => mtimeOf(b) - mtimeOf(a));
  for (const file of files) {
    const meta = await codexSessionMeta(file);
    // Subagent rollouts belong to a parent thread; attach to the thread itself.
    if (!meta || meta.thread_source === "subagent" || !inRepo(str(meta.cwd), input.checkoutRoots)) continue;
    return { engine: "codex", sessionId: str(meta.id) || sessionIdFromPath("codex", file), transcriptPath: file };
  }
  return null;
}

async function fromMtime(input: ResolveInput): Promise<Found | null> {
  const candidates: Found[] = [];
  if (input.engine !== "codex") candidates.push(...[await newestClaude(input)].filter((f) => f !== null));
  if (input.engine !== "claude") candidates.push(...[await newestCodex(input)].filter((f) => f !== null));
  return candidates.toSorted((a, b) => mtimeOf(b.transcriptPath) - mtimeOf(a.transcriptPath))[0] ?? null;
}

export async function resolveSession(input: ResolveInput): Promise<SessionAttachment> {
  const resolvedAt = input.now.toISOString();
  const attach = (found: Found, resolvedBy: SessionAttachment["resolvedBy"]): SessionAttachment => ({ ...found, resolvedBy, resolvedAt });
  const flagged = fromFlags(input);
  if (flagged) return attach(flagged, "flag");
  const env = fromEnv(input);
  if (env) return attach(env, "env");
  const newest = await fromMtime(input);
  if (newest) return attach(newest, "mtime");
  return { engine: input.engine ?? null, sessionId: null, transcriptPath: null, resolvedBy: "none", resolvedAt };
}
