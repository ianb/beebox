/** Interactive box chat through the official Codex SDK. */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createAsyncIterableQueue } from "./claude-chat-queue.js";
import type {
  ChatBackend,
  ChatBackendRun,
  ChatBackendStartOptions,
  NativeChatBackendMessage,
} from "./claude-chat-types.js";
import { ensureCodexPluginInstalled } from "../core/agent/ensure-codex-plugin.js";
import { noteEngineUnavailability } from "../core/agent/engine-unavailability-apply.js";
import { expandClaudeIncludes } from "../core/agent-context-includes.js";
import { getBoxShape } from "../lib/box-shape.js";
import { findBoxRoot } from "../lib/paths.js";
import { validateHookPathsResult } from "../cli/commands/validate-hook.js";
import {
  appendCodexTurnUsage,
  codexUsageDelta,
  totalCodexSessionUsage,
} from "../core/codex-usage.js";
import { codexSdkItemId, codexSdkToolChatMessage } from "./codex-tool-activity.js";
import { declaredPresent } from "../lib/declared-present.js";
import {
  codexSdkUsage,
  createCodexSdkSession,
  type CodexSdkEvent,
  type CodexSdkItem,
  type CodexSdkSessionFactory,
  type CodexSdkSessionLike,
} from "./codex-sdk-session.js";
import type { ChatResultPhase } from "../core/chat/message-types.js";

function event(message: NativeChatBackendMessage["message"]): NativeChatBackendMessage {
  return { provider: "codex", message };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const FAILURE_PREFIX: Record<ChatResultPhase, string> = {
  "session-start": "Could not start codex session",
  turn: "Codex turn threw before completing",
};

/**
 * The result frame a codex run emits when a step of its promise chain rejects.
 * The phase — and the prefix built from it — say which step threw, so a reader
 * can tell "no session was ever created" from "a session ran and the turn did
 * not finish"; both otherwise arrive as `num_turns=0 duration_ms=0`.
 *
 * The stack goes to the console because the frame carries a message only. A
 * thrown `TypeError` reaches the user as its bare message, which names a
 * property and no location; without the stack the throw site is unrecoverable.
 */
export function codexFailureEvent(
  { phase, sessionId, error }: { phase: ChatResultPhase; sessionId: string; error: unknown },
): NativeChatBackendMessage {
  const trace = error instanceof Error
    ? error.stack ?? `${error.name}: ${error.message} (no stack)`
    : `non-Error throw: ${String(error)}`;
  console.error(`[codex-chat] ${phase} failure: ${errorText(error)}\n${trace}`);
  return event({
    type: "result",
    subtype: "failed",
    session_id: sessionId,
    is_error: true,
    phase,
    duration_ms: 0,
    num_turns: 0,
    result: `${FAILURE_PREFIX[phase]}: ${errorText(error)}`,
  });
}

/**
 * Read the item off an `item.completed` event. The SDK's types promise the
 * field is always populated; this catches a stream that yields the event
 * without it, so a missing item is reported as a named, dropped event rather
 * than escaping the turn as a property-access `TypeError`.
 */
function completedItem(nativeEvent: CodexSdkEvent): CodexSdkItem | null {
  if (nativeEvent.type !== "item.completed") return null;
  const item = declaredPresent(nativeEvent.item);
  if (item === null) {
    console.warn("[codex-chat] codex SDK emitted item.completed with no item; dropping the event");
    return null;
  }
  return item;
}

function createRun(opts: ChatBackendStartOptions, createSession: CodexSdkSessionFactory): ChatBackendRun {
  const queue = createAsyncIterableQueue<NativeChatBackendMessage>();
  let session: CodexSdkSessionLike | null = null;
  let sessionId = opts.resumeSessionId ?? "";
  let boxRoot: string | null = null;
  let activeController: AbortController | null = null;
  let initializationError: unknown = null;
  let chain = ensureCodexPluginInstalled().then(async () => {
    boxRoot = await findBoxRoot(opts.cwd);
    const included = boxRoot === null ? "" : await expandClaudeIncludes({
      claudePath: join(boxRoot, "CLAUDE.md"),
      packageRoot: (await getBoxShape(boxRoot)).packageRoot,
    });
    session = createSession({
      cwd: opts.cwd,
      systemPrompt: [opts.systemPrompt, included].filter(Boolean).join("\n\n"),
      model: opts.model,
      resumeSessionId: opts.resumeSessionId,
      additionalDirectories: opts.additionalDirectories,
      env: opts.env,
    });
    if (session.id !== null) {
      sessionId = session.id;
      queue.push(event({ type: "system", subtype: "init", session_id: sessionId }));
    }
  }).catch((error: unknown) => {
    initializationError = error;
    queue.push(codexFailureEvent({ phase: "session-start", sessionId, error }));
  });
  const run: ChatBackendRun = {
    closed: false,
    messages: queue.iterable,
    send(content): void {
      if (run.closed) return;
      chain = chain.then(async () => {
        if (initializationError !== null || session === null) return;
        let userPushed = false;
        const pushUser = (): void => {
          if (userPushed) return;
          userPushed = true;
          queue.push(event({ type: "user", session_id: sessionId, message: { role: "user", content } }));
        };
        if (sessionId !== "") pushUser();
        const changedPaths = new Set<string>();
        activeController = new AbortController();
        const completed = await session.run({
          input: content,
          signal: activeController.signal,
          onSessionId(id) {
            sessionId = id;
            queue.push(event({ type: "system", subtype: "init", session_id: id }));
            pushUser();
          },
          onEvent(nativeEvent) {
            const item = completedItem(nativeEvent);
            if (item === null) return;
            if (item.type === "agent_message") {
              const uuid = codexSdkItemId(item);
              queue.push(event({
                type: "assistant",
                session_id: sessionId,
                ...(uuid === null ? {} : { uuid }),
                message: { role: "assistant", content: [{ type: "text", text: item.text }] },
              }));
            } else {
              const message = codexSdkToolChatMessage(item, sessionId);
              if (message !== null) queue.push(event(message));
            }
            if (item.type === "file_change" && item.status === "completed") {
              const changes = declaredPresent(item.changes);
              if (changes === null) {
                console.warn("[codex-chat] codex SDK emitted a completed file_change with no changes list");
              } else {
                for (const change of changes) changedPaths.add(change.path);
              }
            }
          },
        });
        activeController = null;
        sessionId = completed.sessionId;
        const validation = await validateHookPathsResult([...changedPaths]);
        if (validation.feedback !== null && !validation.hasErrors) {
          console.warn(`[CodexChat:validation-warning] ${validation.feedback}`);
        }
        if (completed.usage !== null && boxRoot !== null) {
          try {
            const previous = await totalCodexSessionUsage(boxRoot, sessionId);
            await appendCodexTurnUsage(boxRoot, {
              sessionId,
              turnId: randomUUID(),
              task: "web-chat",
              timestamp: new Date().toISOString(),
              model: opts.model ?? "codex-default",
              usage: codexUsageDelta(codexSdkUsage(completed.usage), previous),
            });
          } catch (error) {
            console.warn(`[CodexChat:usage] Could not record token usage: ${errorText(error)}`);
          }
        }
        let turnError = completed.error;
        if (turnError !== null && boxRoot !== null) {
          const described = await noteEngineUnavailability({
            provider: "codex",
            message: turnError,
            boxRoot,
          });
          if (described !== null) turnError = described;
        }
        const failure = [
          turnError,
          validation.hasErrors ? `Callback Box validation failed:\n${validation.feedback ?? "Unknown validation error"}` : null,
        ].filter((detail): detail is string => detail !== null).join("\n\n");
        queue.push(event({
          type: "result",
          subtype: validation.hasErrors ? "failed" : completed.status,
          session_id: sessionId,
          is_error: completed.status !== "completed" || validation.hasErrors,
          duration_ms: completed.durationMs,
          num_turns: 1,
          ...(failure === "" ? {} : { result: failure }),
        }));
      }).catch((error: unknown) => {
        activeController = null;
        queue.push(codexFailureEvent({ phase: "turn", sessionId, error }));
      });
    },
    async interrupt(): Promise<void> {
      activeController?.abort();
    },
    async close(): Promise<void> {
      if (run.closed) return;
      await chain;
      run.closed = true;
      queue.end();
    },
  };
  return run;
}

export function createCodexChatBackend(createSession?: CodexSdkSessionFactory): ChatBackend {
  const factory = createSession ?? createCodexSdkSession;
  return { start: (options) => createRun(options, factory) };
}
