/**
 * Filesystem persistence and queue-combining helpers for ChatSession.
 *
 * These are leaf functions with no reference to the ChatSession instance —
 * the model/session-id pointer files are plain JSON read/written under
 * `boxRoot`, and `combineQueuedInputs` is a pure transform over queued
 * sends. Split out of `chat-session.ts` to keep that file under the
 * line budget; nothing here is part of the module's public surface.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { acquireChatActiveLock, releaseChatActiveLock } from "./schedule-state.js";
import { resolveSessionLogPath } from "./chat-session-history.js";
import { parseSessionLog, type SessionEntry } from "../cli/lib/session.js";
import { effectiveTailSize } from "./chat-session-messages.js";
import type { ChatImage, ChatSendInput } from "./chat-session-messages.js";

export interface SessionHistory {
  sessionId: string | null;
  entries: SessionEntry[];
  total: number;
}

/**
 * Load conversation history from the session log for `sessionId`, applying
 * the tail / minimum-user-message trimming. Returns an empty result when the
 * session has no id yet or no log on disk.
 */
export async function loadSessionHistory(
  boxRoot: string,
  { sessionId, params }: {
    sessionId: string | null;
    params?: { tail?: number; minRealUserMessages?: number } | undefined;
  },
): Promise<SessionHistory> {
  if (!sessionId) {
    return { sessionId: null, entries: [], total: 0 };
  }
  const logPath = await resolveSessionLogPath(boxRoot, sessionId);
  if (!fs.existsSync(logPath)) {
    return { sessionId, entries: [], total: 0 };
  }
  const { entries, total } = await parseSessionLog({ logPath });
  const effectiveTail = effectiveTailSize(entries, params);
  if (effectiveTail !== null && effectiveTail < entries.length) {
    return { sessionId, entries: entries.slice(entries.length - effectiveTail), total };
  }
  return { sessionId, entries, total };
}

function log(context: string, ...args: unknown[]): void {
  console.log(`[ChatSession:${context}]`, ...args);
}

/**
 * Acquire the chat-active lock for the duration of an SDK run so housekeeping
 * processes (e.g. `cb tick`) can detect a chat is mid-response and defer
 * commits that would race with agent writes. Returns the lock path, or null
 * if acquisition failed (logged, non-fatal — the run proceeds unlocked).
 */
export async function acquireRunLock(
  { boxRoot, sessionId }: { boxRoot: string; sessionId: string | null },
): Promise<string | null> {
  try {
    const lockId = randomBytes(8).toString("hex");
    return await acquireChatActiveLock({ boxRoot, lockId, sessionId });
  } catch (e) {
    log("error", `Failed to acquire chat-active lock: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Release a chat-active lock acquired by `acquireRunLock`. Failures are
 * logged and swallowed.
 */
export async function releaseRunLock(lockPath: string): Promise<void> {
  try {
    await releaseChatActiveLock(lockPath);
  } catch (e) {
    log("error", `Failed to release chat-active lock: ${(e as Error).message}`);
  }
}

/**
 * Read the persisted model override for a session, or null if absent or
 * unreadable. `modelFile` is relative to `boxRoot`.
 */
export function loadCurrentModel(boxRoot: string, modelFile: string): string | null {
  const filePath = path.join(boxRoot, modelFile);
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
        model: string | null;
      };
      return data.model ?? null;
    }
  } catch (e) {
    log("model", `Failed to load model file: ${e}`);
  }
  return null;
}

/**
 * Persist (or, for `null`, delete) the model override. `modelFile` is
 * relative to `boxRoot`.
 */
export function saveCurrentModel(
  boxRoot: string,
  { modelFile, model }: { modelFile: string; model: string | null },
): void {
  const filePath = path.join(boxRoot, modelFile);
  const dir = path.dirname(filePath);
  try {
    if (model === null) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return;
    }
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      filePath,
      JSON.stringify({ model, savedAt: new Date().toISOString() })
    );
  } catch (e) {
    log("model", `Failed to save model file: ${e}`);
  }
}

/**
 * Read the persisted session-id pointer, or null if persistence is opted
 * out (`sessionFile === null`) or the file is absent/unreadable.
 */
export function loadSessionId(boxRoot: string, sessionFile: string | null): string | null {
  if (sessionFile === null) return null;
  const filePath = path.join(boxRoot, sessionFile);
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
        sessionId: string;
      };
      return data.sessionId;
    }
  } catch (e) {
    log("session", `Failed to load session file: ${e}`);
  }
  return null;
}

/**
 * Persist a newly-assigned session id and fire the optional bookkeeping
 * callback (errors logged, non-fatal). Wraps the two side effects the
 * session runs the first time the SDK hands back an id.
 */
export function onSessionIdAssigned(
  boxRoot: string,
  { sessionFile, sessionId, callback }: {
    sessionFile: string | null;
    sessionId: string;
    callback?: ((sessionId: string) => Promise<void> | void) | undefined;
  },
): void {
  log("session", `Got session ID: ${sessionId}`);
  saveSessionId(boxRoot, { sessionFile, sessionId });
  if (callback !== undefined) {
    void Promise.resolve(callback(sessionId)).catch((e: unknown) => {
      log("session", `onSessionIdAssigned error: ${e instanceof Error ? e.message : String(e)}`);
    });
  }
}

/**
 * Persist the session-id pointer. No-op when persistence is opted out
 * (`sessionFile === null`).
 */
export function saveSessionId(
  boxRoot: string,
  { sessionFile, sessionId }: { sessionFile: string | null; sessionId: string },
): void {
  if (sessionFile === null) return;
  const filePath = path.join(boxRoot, sessionFile);
  const dir = path.dirname(filePath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        sessionId,
        savedAt: new Date().toISOString(),
      })
    );
    log("session", `Saved session ID: ${sessionId}`);
  } catch (e) {
    log("session", `Failed to save session file: ${e}`);
  }
}

/**
 * Delete the session-id pointer file. No-op when persistence is opted out.
 */
export function deleteSessionFile(boxRoot: string, sessionFile: string | null): void {
  if (sessionFile === null) return;
  const filePath = path.join(boxRoot, sessionFile);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      log("reset", "Deleted session file");
    }
  } catch (e) {
    log("reset", `Failed to delete session file: ${e}`);
  }
}

/**
 * Combine several queued sends into one turn: text joined with blank lines,
 * image attachments concatenated with per-message id offsets so `[imageN]`
 * tokens from different messages don't collide.
 */
export function combineQueuedInputs(queued: ChatSendInput[]): ChatSendInput {
  const combinedImages: ChatImage[] = [];
  const combinedTextParts: string[] = [];
  let idOffset = 0;
  for (const q of queued) {
    const imgs = q.images ?? [];
    let text = q.text;
    if (imgs.length > 0 && idOffset > 0) {
      // Renumber `[imageN]` tokens in this message's text and the image ids
      // to avoid collisions with previously-queued messages.
      text = text.replace(/\[image(\d+)]/g, (_m, n: string) => {
        const id = parseInt(n, 10);
        return `[image${id + idOffset}]`;
      });
      for (const img of imgs) {
        combinedImages.push({ ...img, id: img.id + idOffset });
      }
    } else {
      for (const img of imgs) combinedImages.push(img);
    }
    combinedTextParts.push(text);
    idOffset += imgs.length;
  }
  return { text: combinedTextParts.join("\n\n"), images: combinedImages };
}
