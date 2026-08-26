/**
 * Warm-slot management for the chat registry.
 *
 * A chat's first message pays subprocess spawn + harness initialize latency —
 * measured at roughly 0.6–2.0s of the time-to-first-token. Pre-warming a
 * subprocess against the options the next start would use removes it.
 *
 * Split from `registry.ts` for that file's line budget, and because this is
 * where per-chat (coined-id) warming lands: a warm subprocess has its session
 * id baked in at spawn, so a slot can only ever serve the chat it was warmed
 * for.
 */

import { makeLog } from "./log.js";
import { ChatSession, type ChatSessionOptions } from "./index.js";
import type { ChatBackend, ChatBackendStartOptions } from "../../../services/claude-chat.js";
import { resolveSessionModel } from "./model.js";

const log = makeLog("ChatSessionRegistry");

/**
 * Compute the start options a fresh session would use, without starting one.
 * The probe session is a throwaway: it never spawns, it only resolves the
 * system prompt, landmark binding, and env.
 */
async function probeStartOptions(opts: {
  boxRoot: string;
  backend: ChatBackend;
  baseOptions: ChatSessionOptions;
  coinedSessionId?: string | undefined;
  contextDir?: string | undefined;
}): Promise<ChatBackendStartOptions> {
  const probe = new ChatSession(opts.boxRoot, {
    ...opts.baseOptions,
    backend: opts.backend,
    sessionFile: null,
    skipBootstrap: true,
    ...(opts.coinedSessionId !== undefined
      ? { coinedSessionId: opts.coinedSessionId, initialSessionId: opts.coinedSessionId }
      : {}),
    ...(opts.contextDir !== undefined ? { contextDir: opts.contextDir } : {}),
  });
  const start = await probe.buildBackendStartOptions();
  // The model is not part of `buildBackendStartOptions` — `startRun` adds it
  // when it opens the run — but `warmCompatible` compares it. Without this the
  // warm slot of any box with a pinned model is discarded on every send, and
  // the prewarm silently buys nothing. A prewarmed chat has made no choice of
  // its own yet, so it follows the box default by definition.
  const resolved = await resolveSessionModel(opts.boxRoot, { engine: start.engine ?? "claude", explicit: null });
  return resolved.model === null ? start : { ...start, model: resolved.model };
}

/**
 * Warm a subprocess for one specific chat. A warm slot bakes its session id in
 * at spawn, so a reservation is the only moment a chat's own warm start can be
 * arranged — and it is better targeted than the speculative slot it shares a
 * budget with, because this chat is open on someone's screen.
 *
 * Fire-and-forget: warming is best-effort, and a chat that misses it just
 * cold-spawns on its first message.
 */
export function prewarmReservedChat(opts: {
  boxRoot: string;
  backend: ChatBackend;
  baseOptions: ChatSessionOptions;
  sessionId: string;
  contextDir: string | null;
}): void {
  void prewarmBackend({
    boxRoot: opts.boxRoot,
    backend: opts.backend,
    baseOptions: opts.baseOptions,
    coinedSessionId: opts.sessionId,
    ...(opts.contextDir !== null ? { contextDir: opts.contextDir } : {}),
  });
}

/**
 * Pre-warm a subprocess. Best-effort: a failure is logged and the next send
 * falls back to a cold spawn.
 */
export async function prewarmBackend(opts: {
  boxRoot: string;
  backend: ChatBackend;
  baseOptions: ChatSessionOptions;
  coinedSessionId?: string | undefined;
  contextDir?: string | undefined;
}): Promise<void> {
  if (opts.backend.prewarm === undefined) return;
  try {
    await opts.backend.prewarm(await probeStartOptions(opts));
  } catch (e) {
    log("prewarm", `Prewarm failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
