/**
 * The native session store: per-engine reads of a chat's transcript where the
 * engine keeps it (`docs/plans/pi-box-engine.md`, Track 5).
 *
 * Each engine owns its transcript format and location — Claude Code's JSONL
 * under `~/.claude/projects/`, Codex's threads behind its app-server — and
 * beebox reads it in place rather than keeping a copy. A caller that asks one
 * of these three questions looks the engine up in {@link SESSION_STORES}
 * instead of branching on it, so a new engine is one more entry, and the
 * compiler names the table when it is missing.
 *
 * "Absent" is an answer, not an error, in every member: `false`, `null`, or a
 * `null` history. Any other failure (an unreadable file, a dead app-server)
 * throws. Deletion is not here: it is ordered orchestration with recovery
 * (`delete/apply/core.ts`), not a read.
 */

import * as fs from "node:fs/promises";
import { errnoCode } from "../../../shared/error-guards.js";
import { EngineNotImplementedError, type AgentEngine } from "../../../shared/agent-models.js";
import { parseSessionLog, type SessionEntry, type SessionLogSlice } from "../../../cli/lib/session.js";
import { resolveSessionLogPath } from "./history.js";
import {
  codexSessionExists,
  readCodexSessionHistoryIfPresent,
  readCodexSessionUpdatedAt,
} from "./codex-transcript/core.js";
import { CodexHistoryRpcError } from "../../../services/codex-history-server.js";

/** A bounded window of a transcript, with the exact count of the whole. */
export interface NativeHistory {
  entries: SessionEntry[];
  total: number;
}

export interface NativeSessionStore {
  /** Whether this machine's store holds the session. */
  exists(boxRoot: string, sessionId: string): Promise<boolean>;
  /** When the session was last written, or `null` when the store has none. */
  updatedAt(boxRoot: string, sessionId: string): Promise<Date | null>;
  /** The `slice` of the session's history, or `null` when the store has none. */
  readHistory(boxRoot: string, args: { sessionId: string; slice: SessionLogSlice }): Promise<NativeHistory | null>;
}

/** `null` for ENOENT, the one failure that means "no transcript here". */
async function unlessMissing<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return null;
    throw error;
  }
}

const claudeStore: NativeSessionStore = {
  async exists(boxRoot, sessionId) {
    const logPath = await resolveSessionLogPath(boxRoot, sessionId);
    return (await unlessMissing(fs.access(logPath).then(() => true))) ?? false;
  },
  async updatedAt(boxRoot, sessionId) {
    const logPath = await resolveSessionLogPath(boxRoot, sessionId);
    return (await unlessMissing(fs.stat(logPath)))?.mtime ?? null;
  },
  async readHistory(boxRoot, { sessionId, slice }) {
    const logPath = await resolveSessionLogPath(boxRoot, sessionId);
    return unlessMissing(parseSessionLog({ logPath, slice }).then(({ entries, total }) => ({ entries, total })));
  },
};

const codexStore: NativeSessionStore = {
  exists: codexSessionExists,
  async updatedAt(boxRoot, sessionId) {
    try {
      return await readCodexSessionUpdatedAt(boxRoot, sessionId);
    } catch (error) {
      if (error instanceof CodexHistoryRpcError && error.isNotFound) return null;
      throw error;
    }
  },
  readHistory: (boxRoot, { sessionId, slice }) => readCodexSessionHistoryIfPresent({ boxRoot, sessionId, slice }),
};

function notImplemented(engine: AgentEngine): NativeSessionStore {
  const refuse = (operation: string) => () => Promise.reject(new EngineNotImplementedError(engine, operation));
  return {
    exists: refuse("checking a chat transcript"),
    updatedAt: refuse("checking a chat transcript"),
    readHistory: refuse("reading chat history"),
  };
}

export const SESSION_STORES: Record<AgentEngine, NativeSessionStore> = {
  claude: claudeStore,
  codex: codexStore,
  pi: notImplemented("pi"),
};
