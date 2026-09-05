/**
 * Filesystem persistence and queue-combining helpers for ChatSession.
 *
 * These are leaf functions with no reference to the ChatSession instance —
 * the model/session-id pointer files are plain JSON read/written under
 * `boxRoot`, and `combineQueuedInputs` is a pure transform over queued
 * sends. Split out of `chat-session.ts` to keep that file under the
 * line budget; nothing here is part of the module's public surface.
 */

import { makeLog } from "./log.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { acquireChatActiveLock, releaseChatActiveLock } from "../../schedule/state.js";
import type { ChatImage, ChatMessage, ChatSendInput } from "./messages.js";
import type { ChatChannel } from "../../../shared/chat-channel.js";
import { unionActivityKinds, mergeCardStateDetails } from "../card-activity.js";
import { errorMessage } from "../../../lib/error-guards.js";
import { isRecord } from "../../card-io.js";
import { chatModelForEngine } from "../../../shared/chat-models.js";
import type { AgentEngine } from "../../box/config.js";
import { composerToken } from "../../../shared/composer-tokens.js";

const log = makeLog("ChatSession");

/**
 * Acquire the chat-active lock for the duration of an SDK run so housekeeping
 * processes (e.g. `bbx tick`) can detect a chat is mid-response and defer
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
    log("error", `Failed to acquire chat-active lock: ${errorMessage(e)}`);
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
    log("error", `Failed to release chat-active lock: ${errorMessage(e)}`);
  }
}

/** Per-session model override used by the web chat registry. */
export function chatModelFileForSession(sessionId: string): string {
  return `.beebox/chat-models/${encodeURIComponent(sessionId)}.json`;
}

/**
 * Read the persisted model override for a session, or null if absent or
 * unreadable. `modelFile` is relative to `boxRoot`.
 */
export function loadCurrentModel(boxRoot: string, modelFile: string): string | null {
  const filePath = path.join(boxRoot, modelFile);
  try {
    if (fs.existsSync(filePath)) {
      const data: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return isRecord(data) && typeof data.model === "string" ? data.model : null;
    }
  } catch (e) {
    log("model", `Failed to load model file: ${e}`);
  }
  return null;
}

/** Read a model override only when it belongs to the session's engine. */
export function loadCurrentModelForEngine(
  boxRoot: string,
  { modelFile, engine }: { modelFile: string; engine: AgentEngine },
): string | null {
  return chatModelForEngine(engine, loadCurrentModel(boxRoot, modelFile));
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
      const data: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return isRecord(data) && typeof data.sessionId === "string" ? data.sessionId : null;
    }
  } catch (e) {
    log("session", `Failed to load session file: ${e}`);
  }
  return null;
}

/**
 * Persist the session-id pointer. No-op when persistence is opted out
 * (`sessionFile === null`).
 */
/**
 * Capture the session id the SDK assigns on the first message of a run, if the
 * session doesn't already have one. Persists it and fires the optional
 * callback; returns the newly assigned id, or null when nothing changed. Pulled
 * out of ChatSession.handleMessage so that method stays a thin dispatcher.
 */
export function captureAssignedSessionId(opts: {
  msg: ChatMessage;
  current: string | null;
  sessionFile: string | null;
  boxRoot: string;
  onAssigned?: ((id: string) => void | Promise<void>) | undefined;
}): string | null {
  const { msg, current, sessionFile, boxRoot, onAssigned } = opts;
  if (current !== null) return null;
  if (msg.type === "unknown" || !msg.session_id) return null;
  const sessionId = msg.session_id;
  saveSessionId(boxRoot, { sessionFile, sessionId });
  if (onAssigned !== undefined) {
    void Promise.resolve(onAssigned(sessionId)).catch((e: unknown) => {
      log("session", `onSessionIdAssigned error: ${e instanceof Error ? e.message : String(e)}`);
    });
  }
  return sessionId;
}

function saveSessionId(
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
 * tokens from different messages don't collide. The latest queued `channel`
 * and `openCard` win — they reflect where the user is now — but
 * `cardActivity` is **unioned** across the batch: an earlier queued
 * message's "scrolled"/"modified" must survive into the combined turn, not
 * be clobbered by a later send that reported different activity.
 */
export function combineQueuedInputs(queued: ChatSendInput[]): ChatSendInput {
  const combinedImages: ChatImage[] = [];
  const combinedTextParts: string[] = [];
  let channel: ChatChannel | undefined;
  let openCard: string | undefined;
  let idOffset = 0;
  for (const q of queued) {
    if (q.channel !== undefined) channel = q.channel;
    if (q.openCard !== undefined) openCard = q.openCard;
    const imgs = q.images ?? [];
    let text = q.text;
    if (imgs.length > 0 && idOffset > 0) {
      // Renumber `[imageN]` tokens in this message's text and the image ids
      // to avoid collisions with previously-queued messages.
      text = text.replace(/\[image#?(\d+)]/g, (_m, n: string) => {
        const id = parseInt(n, 10);
        return composerToken("image", id + idOffset);
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
  const cardActivity = unionActivityKinds(queued.map((q) => q.cardActivity));
  const cardState = mergeCardStateDetails(queued.map((q) => q.cardState));
  return {
    text: combinedTextParts.join("\n\n"),
    images: combinedImages,
    ...(channel !== undefined ? { channel } : {}),
    ...(openCard !== undefined ? { openCard } : {}),
    ...(cardActivity.length > 0 ? { cardActivity } : {}),
    ...(Object.keys(cardState).length > 0 ? { cardState } : {}),
  };
}
