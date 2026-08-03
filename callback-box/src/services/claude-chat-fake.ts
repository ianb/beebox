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
 * The fake emits only the SDK-message fields `ChatSession`'s handler actually
 * reads; `SDKMessage` is the SDK's large discriminated union, so a full literal
 * would be test noise. This centralizes the single unavoidable cast for every
 * `emit*` helper rather than repeating it per call site.
 */
function fakeSdkMessage(fields: Record<string, unknown>): SDKMessage {
  // eslint-disable-next-line no-restricted-syntax -- test-only: minimal SDKMessage carrying just the fields the chat handler consumes (see fn comment)
  return fields as unknown as SDKMessage;
}

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
  /** How many times `prewarm()` has been called. */
  prewarmCount: number;
  /** How many times `closeWarm()` has been called. */
  closeWarmCount: number;
  /**
   * When true (default), each `prewarm()` installs its warm slot
   * synchronously. Set false to hold warm-ups in flight so a test can
   * interleave `closeWarm()` and then settle via `settleWarm()`, exercising
   * the epoch-abandon path the real backend implements.
   */
  autoSettleWarm: boolean;
  /**
   * Settle the oldest in-flight `prewarm()` (only meaningful while
   * `autoSettleWarm` is false). Installs a warm slot unless `closeWarm()` ran
   * since that prewarm began — mirroring the real backend's epoch check.
   * Returns whether a slot was installed.
   */
  settleWarm(): boolean;
  /**
   * When set, the next `start()` throws this instead of opening a run, then
   * clears itself. Models an SDK subprocess spawn that fails outright — the
   * `EBADF` at the heart of
   * `issues/bugs/2026-08-03-intermittent-spawn-ebadf-sdk-chat-run.md` — so a
   * test can exercise run-start failure without an unspawnable environment.
   */
  failNextStart: Error | null;
  /** Stable, human-readable snapshot of warm-pool state for doctests. */
  describe(): string;
}

export function createFakeChatBackend(): FakeChatBackend {
  const runs: FakeChatBackendRun[] = [];
  let warmHeld = false;
  // Bumped by closeWarm() so an in-flight prewarm settling afterward abandons
  // its slot instead of installing it (the epoch check the real backend runs).
  let warmEpoch = 0;
  // Epoch captured at the start of each in-flight prewarm awaiting settleWarm().
  const pendingWarms: number[] = [];
  const backend: FakeChatBackend = {
    runs,
    prewarmCount: 0,
    closeWarmCount: 0,
    autoSettleWarm: true,
    failNextStart: null,
    lastRun() {
      return runs[runs.length - 1] ?? null;
    },
    async prewarm(_opts: ChatBackendStartOptions): Promise<void> {
      backend.prewarmCount += 1;
      if (backend.autoSettleWarm) warmHeld = true;
      else pendingWarms.push(warmEpoch);
    },
    closeWarm(): void {
      backend.closeWarmCount += 1;
      warmEpoch += 1;
      warmHeld = false;
    },
    hasWarm(): boolean {
      return warmHeld || pendingWarms.length > 0;
    },
    settleWarm(): boolean {
      const epochAtStart = pendingWarms.shift();
      if (epochAtStart === undefined) return false;
      if (epochAtStart !== warmEpoch) return false; // abandoned by closeWarm
      warmHeld = true;
      return true;
    },
    describe(): string {
      return [
        `warmHeld: ${warmHeld}`,
        `warming: ${pendingWarms.length > 0}`,
        `prewarmCount: ${backend.prewarmCount}`,
        `closeWarmCount: ${backend.closeWarmCount}`,
      ].join("\n");
    },
    start(opts: ChatBackendStartOptions): FakeChatBackendRun {
      const failure = backend.failNextStart;
      if (failure !== null) {
        backend.failNextStart = null;
        throw failure;
      }
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
          run.emitMessage(fakeSdkMessage({
            type: "system",
            subtype: "init",
            session_id: sessionId,
            // The remaining fields aren't used by ChatSession's handler.
          }));
        },
        emitAssistantText(text: string): void {
          run.emitMessage(fakeSdkMessage({
            type: "assistant",
            message: { role: "assistant", content: [{ type: "text", text }] },
            session_id: opts.resumeSessionId ?? "",
            parent_tool_use_id: null,
          }));
        },
        emitResult(resultOpts?: { isError?: boolean; result?: string }): void {
          run.emitMessage(fakeSdkMessage({
            type: "result",
            subtype: resultOpts?.isError ? "error_during_execution" : "success",
            is_error: resultOpts?.isError ?? false,
            result: resultOpts?.result ?? "",
            duration_ms: 0,
            duration_api_ms: 0,
            num_turns: 1,
            stop_reason: "end_turn",
            total_cost_usd: 0,
            usage: {},
            modelUsage: {},
            permission_denials: [],
            session_id: opts.resumeSessionId ?? "",
          }));
        },
      };

      runs.push(run);
      return run;
    },
  };
  return backend;
}
