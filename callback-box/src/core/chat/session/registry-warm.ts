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

const log = makeLog("ChatSessionRegistry");

/**
 * Compute the start options a fresh session would use, without starting one.
 * The probe session is a throwaway: it never spawns, it only resolves the
 * system prompt, landmark binding, and env.
 */
export async function probeStartOptions(opts: {
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
  return probe.buildBackendStartOptions();
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
