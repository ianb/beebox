/**
 * Claude chat backend — wraps `@anthropic-ai/claude-agent-sdk`'s `query()`
 * for long-lived bidirectional chat sessions. The chat session pushes user
 * messages and consumes SDK message events, one turn after another, against
 * a single SDK query handle.
 *
 * Real implementation calls `query()` and adapts SDKMessage events into a
 * stream the chat session iterates.
 *
 * Fake implementation lets tests script messages onto the stream and
 * inspect what was sent.
 *
 * The interface stays narrow: start a run, push user content, iterate
 * messages, interrupt or close. Renaming/replacing of session id and
 * resume semantics live one level up in `ChatSession`.
 */

import {
  query,
  startup,
  type Options,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type WarmQuery,
} from "@anthropic-ai/claude-agent-sdk";
import { cardValidatorHook } from "../core/sdk-hooks.js";
import { resolveClaudeCodeBinary } from "../core/sdk-binary-path.js";

// ─── Backend interface ───────────────────────────────────────────────────────

/** Content blocks accepted by `ChatBackendRun.send()`. */
export type ChatContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64" | "url";
        media_type?: string;
        data?: string;
        url?: string;
      };
    };

export interface ChatBackendStartOptions {
  /** Working directory for the underlying SDK subprocess. */
  cwd: string;
  /**
   * Extra directories the agent can read/write beyond `cwd`. Equivalent to
   * the CLI's `--add-dir`. Landmark sessions set `cwd` to the landmark dir
   * and add the box root here so the agent retains full box access.
   */
  additionalDirectories?: string[] | undefined;
  /** Appended to the `claude_code` system-prompt preset. */
  systemPrompt: string;
  /** If set, resumes the given SDK session; otherwise a fresh session. */
  resumeSessionId?: string | undefined;
  /** Pin to a specific model; omit for SDK default. */
  model?: string | undefined;
  /**
   * If true, the SDK emits `stream_event` (`SDKPartialAssistantMessage`)
   * messages as the model streams its response. Off by default to keep
   * the message rate low.
   */
  includePartialMessages?: boolean | undefined;
  /** Subprocess env. Keys with undefined values are dropped. */
  env: Record<string, string | undefined>;
}

export interface ChatBackendRun {
  /** Push a user message into the running query. */
  send(content: ChatContentBlock[]): void;
  /** Async iterable of SDK message events. Iterate exactly once per run. */
  messages: AsyncIterable<SDKMessage>;
  /** Interrupt the in-progress turn, if any. */
  interrupt(): Promise<void>;
  /**
   * End the conversation gracefully — the messages iterator will return.
   * Idempotent.
   */
  close(): Promise<void>;
  /** True after the messages iterator has returned (close or end-of-query). */
  closed: boolean;
}

export interface ChatBackend {
  start(opts: ChatBackendStartOptions): ChatBackendRun;
  /**
   * Pre-warm a Claude subprocess against `opts` so the next `start()` with
   * compatible options skips spawn + initialize latency. Compatibility means:
   * same `cwd`, same `systemPrompt`, no `resumeSessionId`,
   * and matching `includePartialMessages`/`model`. The warm slot is
   * single-use; the backend re-warms automatically after consumption.
   *
   * Idempotent (only one slot is held at a time). Optional — fakes don't
   * have to implement it.
   */
  prewarm?(opts: ChatBackendStartOptions): Promise<void>;
}

// ─── Real implementation ─────────────────────────────────────────────────────

function dropUndefined(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * A queue-based async iterable: producers push items via `push()`, the
 * iterable yields them in order, and `end()` terminates iteration.
 */
function createAsyncIterableQueue<T>(): {
  push(item: T): void;
  end(): void;
  iterable: AsyncIterable<T>;
} {
  const queue: T[] = [];
  const waiters: Array<(v: IteratorResult<T>) => void> = [];
  let ended = false;

  function push(item: T): void {
    if (ended) return;
    const w = waiters.shift();
    if (w !== undefined) {
      w({ value: item, done: false });
    } else {
      queue.push(item);
    }
  }

  function end(): void {
    if (ended) return;
    ended = true;
    while (waiters.length > 0) {
      const w = waiters.shift();
      if (w !== undefined) w({ value: undefined as unknown as T, done: true });
    }
  }

  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next(): Promise<IteratorResult<T>> {
          if (queue.length > 0) {
            const value = queue.shift() as T;
            return Promise.resolve({ value, done: false });
          }
          if (ended) {
            return Promise.resolve({ value: undefined as unknown as T, done: true });
          }
          return new Promise((resolve) => {
            waiters.push(resolve);
          });
        },
      };
    },
  };

  return { push, end, iterable };
}

/**
 * Build SDK Options from a ChatBackendStartOptions for either `query()` or
 * `startup()` calls. Pulled out so the warm-pool path uses the same shape.
 */
function buildQueryOptions(opts: ChatBackendStartOptions): Options {
  const queryOptions: Options = {
    cwd: opts.cwd,
    env: dropUndefined(opts.env),
    permissionMode: "bypassPermissions",
    systemPrompt: {
      type: "preset" as const,
      preset: "claude_code" as const,
      append: opts.systemPrompt,
    },
  };
  if (opts.additionalDirectories && opts.additionalDirectories.length > 0) {
    queryOptions.additionalDirectories = opts.additionalDirectories;
  }
  const binaryPath = resolveClaudeCodeBinary();
  if (binaryPath !== null) {
    queryOptions.pathToClaudeCodeExecutable = binaryPath;
  }
  if (opts.resumeSessionId !== undefined) {
    queryOptions.resume = opts.resumeSessionId;
  }
  if (opts.model !== undefined) {
    queryOptions.model = opts.model;
  }
  queryOptions.hooks = { PostToolUse: [cardValidatorHook()] };
  if (opts.includePartialMessages === true) {
    queryOptions.includePartialMessages = true;
  }
  return queryOptions;
}

/**
 * Whether a `start()` call's options are compatible with a pre-warmed slot.
 * The warm subprocess has its options baked in, so we only consume it if
 * everything that affects the subprocess (cwd, system prompt, model,
 * partial-messages, no resume) matches.
 */
function warmCompatible(
  warm: ChatBackendStartOptions,
  next: ChatBackendStartOptions,
): boolean {
  if (next.resumeSessionId !== undefined) return false;
  if (warm.cwd !== next.cwd) return false;
  if (warm.systemPrompt !== next.systemPrompt) return false;
  if ((warm.model ?? null) !== (next.model ?? null)) return false;
  if (warm.includePartialMessages !== next.includePartialMessages) return false;
  const wd = warm.additionalDirectories ?? [];
  const nd = next.additionalDirectories ?? [];
  if (wd.length !== nd.length) return false;
  for (const [i, dir] of wd.entries()) {
    if (dir !== nd[i]) return false;
  }
  return true;
}

export function createChatBackend(): ChatBackend {
  let warmSlot: { warmQuery: WarmQuery; opts: ChatBackendStartOptions } | null = null;
  let warming: Promise<void> | null = null;

  function startWarming(opts: ChatBackendStartOptions): Promise<void> {
    if (warming !== null) return warming;
    if (warmSlot !== null) return Promise.resolve();
    warming = (async (): Promise<void> => {
      try {
        const wq = await startup({ options: buildQueryOptions(opts) });
        warmSlot = { warmQuery: wq, opts };
      } catch (e) {
        // Warming is best-effort; the next start() will fall back to a cold spawn.
        console.warn("Chat backend warm-up failed, will cold-spawn on next start:", e);
      } finally {
        warming = null;
      }
    })();
    return warming;
  }

  function buildRunFromQuery(params: {
    q: Query;
    opts: ChatBackendStartOptions;
    inputQueue: ReturnType<typeof createAsyncIterableQueue<SDKUserMessage>>;
    messageQueue: ReturnType<typeof createAsyncIterableQueue<SDKMessage>>;
  }): ChatBackendRun {
    const { q, opts, inputQueue, messageQueue } = params;
    const run: ChatBackendRun = {
      closed: false,
      messages: messageQueue.iterable,
      send(content: ChatContentBlock[]): void {
        if (run.closed) return;
        inputQueue.push({
          type: "user",
          message: { role: "user", content },
          session_id: opts.resumeSessionId ?? "",
          parent_tool_use_id: null,
        } as SDKUserMessage);
      },
      async interrupt(): Promise<void> {
        if (run.closed) return;
        await q.interrupt();
      },
      async close(): Promise<void> {
        if (run.closed) return;
        inputQueue.end();
        await pump.catch(() => {
          // Errors already surface via the messages iterator.
        });
      },
    };

    const pump = (async (): Promise<void> => {
      try {
        for await (const msg of q) {
          messageQueue.push(msg);
        }
      } finally {
        messageQueue.end();
        run.closed = true;
      }
    })();
    pump.catch(() => {
      // messageQueue.end() already ran in the finally.
    });

    return run;
  }

  return {
    async prewarm(opts: ChatBackendStartOptions): Promise<void> {
      await startWarming(opts);
    },
    start(opts: ChatBackendStartOptions): ChatBackendRun {
      const inputQueue = createAsyncIterableQueue<SDKUserMessage>();
      const messageQueue = createAsyncIterableQueue<SDKMessage>();

      // Try to consume the warm slot if it matches.
      if (warmSlot !== null && warmCompatible(warmSlot.opts, opts)) {
        const consumed = warmSlot;
        warmSlot = null;
        const q = consumed.warmQuery.query(inputQueue.iterable);
        // Re-warm in the background using the same options we just consumed.
        void startWarming(consumed.opts);
        return buildRunFromQuery({ q, opts, inputQueue, messageQueue });
      }

      // Cold path: drop a stale warm slot if its options don't match this
      // start (we'd never use it for a different cwd/prompt). Caller can
      // re-prewarm later if they want another slot.
      if (warmSlot !== null) {
        warmSlot.warmQuery.close();
        warmSlot = null;
      }

      const q: Query = query({
        prompt: inputQueue.iterable,
        options: buildQueryOptions(opts),
      });
      return buildRunFromQuery({ q, opts, inputQueue, messageQueue });
    },
  };
}

// ─── Fake implementation ─────────────────────────────────────────────────────

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
