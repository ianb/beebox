/**
 * Fake chat backend — a scriptable `ChatBackend` for tests. Tests push SDK
 * messages onto the stream via `emit*` helpers and inspect `sent` for
 * whatever the caller pushed in via `send()`. No SDK call, no subprocess.
 *
 * The interface and the real implementation live in `claude-chat.ts`, which
 * re-exports these symbols so the public surface is one module.
 */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createAsyncIterableQueue } from "./claude-chat-queue.js";
import type {
  ChatBackend,
  ChatBackendRun,
  ChatBackendStartOptions,
  ChatContentBlock,
} from "./claude-chat-types.js";

/**
 * A fake `ChatBackendRun` driven from test code. Tests push SDK messages
 * onto the stream via `emit*` helpers and inspect `sent` for whatever the
 * caller pushed in via `send()`.
 */
export interface FakeChatBackendRun extends ChatBackendRun {
  /** What `start()` was called with. */
  startOptions: ChatBackendStartOptions;
  /** Each `send()` call appended in order, captured as content arrays. */
  sent: ChatContentBlock[][];
  /** Push a raw SDK message onto the messages stream. */
  emitMessage(msg: SDKMessage): void;
  /** Push a `system/init` message with a session_id. */
  emitSessionInit(sessionId: string): void;
  /** Push a plain assistant text turn. */
  emitAssistantText(text: string): void;
  /** Push an end-of-turn `result` message. */
  emitResult(opts?: { isError?: boolean; result?: string }): void;
  /** Whether `interrupt()` was called. */
  interrupted: boolean;
}

export interface FakeChatBackend extends ChatBackend {
  /** All runs the fake has produced, in order. */
  runs: FakeChatBackendRun[];
  /** The most recent run, or null. */
  lastRun(): FakeChatBackendRun | null;
}

export function createFakeChatBackend(): FakeChatBackend {
  const runs: FakeChatBackendRun[] = [];
  return {
    runs,
    lastRun() {
      return runs[runs.length - 1] ?? null;
    },
    start(opts: ChatBackendStartOptions): FakeChatBackendRun {
      const messageQueue = createAsyncIterableQueue<SDKMessage>();
      const sent: ChatContentBlock[][] = [];

      const run: FakeChatBackendRun = {
        startOptions: opts,
        sent,
        interrupted: false,
        closed: false,
        messages: messageQueue.iterable,
        send(content: ChatContentBlock[]): void {
          if (run.closed) return;
          sent.push(content);
        },
        async interrupt(): Promise<void> {
          run.interrupted = true;
        },
        async close(): Promise<void> {
          if (run.closed) return;
          run.closed = true;
          messageQueue.end();
        },
        emitMessage(msg: SDKMessage): void {
          messageQueue.push(msg);
        },
        emitSessionInit(sessionId: string): void {
          run.emitMessage({
            type: "system",
            subtype: "init",
            session_id: sessionId,
            // The remaining fields aren't used by ChatSession's handler.
          } as unknown as SDKMessage);
        },
        emitAssistantText(text: string): void {
          run.emitMessage({
            type: "assistant",
            message: { role: "assistant", content: [{ type: "text", text }] },
            session_id: opts.resumeSessionId ?? "",
            parent_tool_use_id: null,
          } as unknown as SDKMessage);
        },
        emitResult(resultOpts?: { isError?: boolean; result?: string }): void {
          run.emitMessage({
            type: "result",
            subtype: resultOpts?.isError ? "error_during_execution" : "success",
            is_error: resultOpts?.isError ?? false,
            result: resultOpts?.result ?? "",
            duration_ms: 0,
            duration_api_ms: 0,
            num_turns: 1,
            stop_reason: "end_turn",
            total_cost_usd: 0,
            usage: {} as unknown,
            modelUsage: {},
            permission_denials: [],
            session_id: opts.resumeSessionId ?? "",
          } as unknown as SDKMessage);
        },
      };

      runs.push(run);
      return run;
    },
  };
}
