/**
 * Whether a send's run is ready, checked before the send takes the turn.
 * Admitted first, the sender acknowledged a message no run would read, and a
 * sender with no turn-stream listener (quick chat) recorded it as sent
 * (issues/bugs/2026-10-15-quick-chat-sent-when-run-never-starts.md).
 *
 * With no live run it is the preflight `startRun` makes (login, or provider
 * setup for a third-party model); a confirmed login is cached, so the common
 * case costs no probe. A live third-party run keeps the provider env it started
 * with, so its model is re-checked: a removed model or revoked key stops here.
 */

import { preflightChatBackend } from "../../../agent/auth-preflight.js";
import { liveProviderRefusal } from "../../../provider-env/core.js";
import type { ChatBackend, ChatBackendStartOptions } from "../../../../services/claude-chat/core.js";
import { resolveSessionModel } from "../model.js";

interface ErrorEmitter {
  emit(event: "error", error: Error): boolean;
  listenerCount(event: "error"): number;
}

/**
 * True when the send may take the turn. Otherwise the refusal goes to
 * `onRefused` for the sender's answer, and to the session's "error" listeners
 * when it has any: a queued drain has none, and an unheard "error" would throw
 * instead of returning false, losing the queued input.
 */
export async function sendReadiness(args: {
  boxRoot: string;
  backend: Pick<ChatBackend, "requiresClaudeAuth" | "requiresCodexAuth">;
  explicitModel: string | null;
  /** The live run's model; null when no run is live. */
  liveModel: string | null;
  /** The next run's start options; null when a run is live. */
  startOptions: ChatBackendStartOptions | null;
  session: ErrorEmitter;
  onRefused: ((reason: string) => void) | undefined;
}): Promise<boolean> {
  const refuse = (error: Error): boolean => {
    args.onRefused?.(error.message);
    if (args.session.listenerCount("error") > 0) args.session.emit("error", error);
    return true;
  };
  if (args.startOptions === null) {
    const refusal = await liveProviderRefusal({ boxRoot: args.boxRoot, model: args.liveModel });
    return refusal === null ? true : !refuse(refusal);
  }
  const engine = args.startOptions.engine;
  const { model } = await resolveSessionModel(args.boxRoot, { engine: engine ?? "claude", explicit: args.explicitModel });
  return preflightChatBackend({ backend: args.backend, session: { emit: (_event, error) => refuse(error) }, engine, model: model ?? undefined, boxRoot: args.boxRoot });
}
