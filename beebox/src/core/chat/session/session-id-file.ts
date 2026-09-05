/**
 * Per-subprocess session-id handoff for `bbx chat screenshot` (and any other
 * `bbx chat` command that needs to target *this* live chat conversation).
 *
 * The problem this solves: a chat agent runs `bbx chat screenshot` mid-turn,
 * and the command must know the SDK session id of the conversation it is
 * running inside. For a *resumed* session that id is known at spawn and rides
 * the subprocess env as `BBX_CHAT_SESSION_ID` (see `start.ts` / `thread.ts`).
 * For a *brand-new* conversation the SDK only assigns the id after the
 * subprocess is already running, so it can't be baked into the spawn env —
 * and the same long-lived subprocess serves every later turn, so the env can
 * never be repaired.
 *
 * The fix is a file, not an env value: at spawn the backend mints a unique
 * path and passes it as `BBX_CHAT_SESSION_ID_FILE`; the moment the SDK emits
 * the session id, the backend writes it into that file (see
 * `services/claude-chat.ts`). The CLI reads the file when the env id is
 * absent. The path is **per subprocess** (never a shared box-wide file) so
 * two concurrent new conversations each resolve to their own id — a shared
 * file would be exactly the "most-active session" guessing the see-as-the-user
 * plan forbids.
 *
 * Why the backend and not the ChatSession owns the write: with chat prewarm on
 * (`bbx serve` sets `prewarmChat: true`), a new-session send consumes a
 * pre-warmed subprocess whose env was baked at prewarm time — the consuming
 * session's own env never reaches that subprocess. Only the backend, which
 * mints the subprocess, can hand it a path it will actually see.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { isRecord } from "../../../lib/is-record.js";
import { sleep } from "../../../lib/sleep.js";

/** Env var carrying the session id directly, when known at spawn (resumes). */
export const BBX_CHAT_SESSION_ID_ENV = "BBX_CHAT_SESSION_ID";

/**
 * Env var carrying the path of the per-subprocess file the backend writes the
 * SDK session id into once it is assigned. Set for fresh (non-resume) spawns
 * whose id isn't known until after the subprocess starts.
 */
export const BBX_CHAT_SESSION_ID_FILE_ENV = "BBX_CHAT_SESSION_ID_FILE";

/** How long `resolveChatSessionId` polls the file before giving up. */
const DEFAULT_WAIT_MS = 2000;
/** Poll interval while waiting for the id file to appear. */
const POLL_INTERVAL_MS = 100;

/**
 * Allocate a unique, not-yet-created path for a subprocess's session-id file.
 * Pure — returns a path string and touches no disk; the file springs into
 * existence only when `writeSessionIdFile` runs, so an unconsumed/aborted
 * spawn leaves nothing behind.
 */
export function allocateSessionIdFilePath(): string {
  return path.join(os.tmpdir(), `bbx-chat-session-${randomBytes(12).toString("hex")}.id`);
}

/**
 * Write `sessionId` into the file at `filePath`, replacing any prior value.
 * Writes to a sibling temp path and renames so a concurrent reader never
 * observes a half-written id.
 */
export function writeSessionIdFile(filePath: string, sessionId: string): void {
  const tmp = `${filePath}.${randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, sessionId, "utf8");
  fs.renameSync(tmp, filePath);
}

/**
 * Read the session id from `filePath`, or null when the file is absent or
 * empty (the pre-assignment window). A read error other than "not found" is
 * surfaced as a warning and treated as "no id yet" — the caller degrades to
 * "no session" rather than acting on a corrupt read.
 */
export function readSessionIdFile(filePath: string): string | null {
  try {
    const id = fs.readFileSync(filePath, "utf8").trim();
    return id.length > 0 ? id : null;
  } catch (e) {
    if (isRecord(e) && e.code === "ENOENT") return null;
    console.warn(`[session-id-file] could not read ${filePath}:`, e);
    return null;
  }
}

/** Remove a session-id file, ignoring a not-yet-created / already-gone path. */
export function cleanupSessionIdFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (e) {
    if (isRecord(e) && e.code === "ENOENT") return;
    console.warn(`[session-id-file] could not remove ${filePath}:`, e);
  }
}

/**
 * Resolve the current chat session's id for a `bbx chat` command running inside
 * a chat subprocess. Prefers the directly-set env var (resumes); otherwise
 * reads the backend-written id file named by `BBX_CHAT_SESSION_ID_FILE`,
 * briefly polling it to cover the race where the agent invokes `bbx` on the
 * very first turn before the SDK has returned the session id. Returns null
 * when no session context is present or the id never arrives within the wait.
 */
export async function resolveChatSessionId(opts?: { waitMs?: number }): Promise<string | null> {
  const direct = process.env[BBX_CHAT_SESSION_ID_ENV];
  if (direct !== undefined && direct.length > 0) return direct;

  const filePath = process.env[BBX_CHAT_SESSION_ID_FILE_ENV];
  if (filePath === undefined || filePath.length === 0) return null;

  const waitMs = opts?.waitMs ?? DEFAULT_WAIT_MS;
  const deadline = Date.now() + waitMs;
  for (;;) {
    const id = readSessionIdFile(filePath);
    if (id !== null) return id;
    if (Date.now() >= deadline) return null;
    await sleep(POLL_INTERVAL_MS);
  }
}
