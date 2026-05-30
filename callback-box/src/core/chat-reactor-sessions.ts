/**
 * Chat Reactor Sessions - Persist Claude Code session IDs per chat thread.
 *
 * Enables session reuse across reactor invocations so subsequent messages
 * in the same chat thread resume the existing session (skipping startup
 * and the Read-before-Edit gate).
 *
 * Stored in `.callback-box/chat-sessions.json`, keyed by thread ref path.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

const SESSIONS_FILE = ".callback-box/chat-sessions.json";

/** Max messages before rotating to a fresh session */
const MAX_MESSAGES = 50;
/** Max age in ms before rotating (24 hours) */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface ChatSessionRecord {
  sessionId: string;
  createdAt: string;
  lastUsedAt: string;
  messageCount: number;
}

type SessionStore = Record<string, ChatSessionRecord>;

export async function loadChatSessions(boxRoot: string): Promise<SessionStore> {
  const filePath = path.join(boxRoot, SESSIONS_FILE);
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data) as SessionStore;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not load chat sessions from ${filePath}, starting empty:`, e);
    }
    return {};
  }
}

export async function saveChatSessions(boxRoot: string, store: SessionStore): Promise<void> {
  const filePath = path.join(boxRoot, SESSIONS_FILE);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(store, null, 2));
}

/**
 * Get or create a session for a chat thread.
 * Returns { sessionId, resume } where resume=true means an existing session.
 * Rotates the session if it's stale or has too many messages.
 */
export function getOrCreateSession(
  store: SessionStore,
  threadRef: string,
): { sessionId: string; resume: boolean } {
  const existing = store[threadRef];
  const now = Date.now();

  if (existing) {
    const age = now - new Date(existing.lastUsedAt).getTime();
    if (existing.messageCount < MAX_MESSAGES && age < MAX_AGE_MS) {
      return { sessionId: existing.sessionId, resume: true };
    }
    // Stale or full — rotate
  }

  // Create new session
  const sessionId = randomUUID();
  store[threadRef] = {
    sessionId,
    createdAt: new Date(now).toISOString(),
    lastUsedAt: new Date(now).toISOString(),
    messageCount: 0,
  };
  return { sessionId, resume: false };
}

/**
 * Mark a session as used after a successful agent run.
 */
export function markSessionUsed(store: SessionStore, threadRef: string): void {
  const record = store[threadRef];
  if (record) {
    record.lastUsedAt = new Date().toISOString();
    record.messageCount++;
  }
}

/**
 * Delete a session record (e.g., after failure).
 */
export function resetSession(store: SessionStore, threadRef: string): void {
  delete store[threadRef];
}

/**
 * Delete all session records.
 */
export function resetAllSessions(store: SessionStore): void {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
}
