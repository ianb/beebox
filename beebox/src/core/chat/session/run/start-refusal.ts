/**
 * Whether a chat run could start now. A send checks this before it takes the
 * turn: admitted first, the sender acknowledged a message no run would read,
 * and a sender with no turn-stream listener (quick chat) recorded it as sent
 * (issues/bugs/2026-10-15-quick-chat-sent-when-run-never-starts.md). It is the
 * same preflight `startRun` makes; a confirmed login is cached, so the common
 * case costs no probe.
 */

import { preflightChatBackend } from "../../../agent/auth-preflight.js";
import type { ChatBackend, ChatBackendStartOptions } from "../../../../services/claude-chat/core.js";
import { resolveSessionModel } from "../model.js";

/**
 * True when a run could start now. Otherwise the refusal (no login, no provider
 * setup) is emitted as "error" on the session, as `startRun` would, and its
 * message goes to `onRefused` for the sender's answer.
 */
export async function runCanStart(args: {
  boxRoot: string;
  backend: Pick<ChatBackend, "requiresClaudeAuth" | "requiresCodexAuth">;
  explicitModel: string | null;
  startOptions: ChatBackendStartOptions;
  session: { emit(event: "error", error: Error): boolean };
  onRefused: ((reason: string) => void) | undefined;
}): Promise<boolean> {
  const engine = args.startOptions.engine;
  const { model } = await resolveSessionModel(args.boxRoot, { engine: engine ?? "claude", explicit: args.explicitModel });
  const session = { emit: (event: "error", error: Error): boolean => { args.onRefused?.(error.message); return args.session.emit(event, error); } };
  return preflightChatBackend({ backend: args.backend, session, engine, model: model ?? undefined, boxRoot: args.boxRoot });
}
