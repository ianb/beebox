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
import { expandClaudeIncludes } from "../core/agent-context-includes.js";
import { getBoxShape } from "../lib/box-shape.js";
import { findBoxRoot } from "../lib/paths.js";
import { validateHookPathsResult } from "../cli/commands/validate-hook.js";
import {
  appendCodexTurnUsage,
  codexUsageDelta,
  totalCodexSessionUsage,
} from "../core/codex-usage.js";
import { codexSdkToolChatMessage } from "./codex-tool-activity.js";
import {
  codexSdkUsage,
  createCodexSdkSession,
  type CodexSdkSessionFactory,
  type CodexSdkSessionLike,
} from "./codex-sdk-session.js";

function event(message: NativeChatBackendMessage["message"]): NativeChatBackendMessage {
  return { provider: "codex", message };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    queue.push(event({
      type: "result",
      subtype: "failed",
      session_id: sessionId,
      is_error: true,
      duration_ms: 0,
      num_turns: 0,
      result: errorText(error),
    }));
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
            if (nativeEvent.type !== "item.completed") return;
            const { item } = nativeEvent;
            if (item.type === "agent_message") {
              queue.push(event({
                type: "assistant",
                session_id: sessionId,
                uuid: item.id,
                message: { role: "assistant", content: [{ type: "text", text: item.text }] },
              }));
            } else {
              const message = codexSdkToolChatMessage(item, sessionId);
              if (message !== null) queue.push(event(message));
            }
            if (item.type === "file_change" && item.status === "completed") {
              for (const change of item.changes) changedPaths.add(change.path);
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
        const failure = [
          completed.error,
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
        queue.push(event({
          type: "result",
          subtype: "failed",
          session_id: sessionId,
          is_error: true,
          duration_ms: 0,
          num_turns: 0,
          result: errorText(error),
        }));
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
