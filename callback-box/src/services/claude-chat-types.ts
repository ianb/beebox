/**
 * Shared types for the Claude chat backend — the narrow interface the chat
 * session drives (start a run, push user content, iterate messages, interrupt
 * or close) plus the content blocks and start options.
 *
 * Kept in a leaf module so the real implementation (`claude-chat.ts`) and the
 * fake (`claude-chat-fake.ts`) can both depend on it without forming a value
 * cycle. `claude-chat.ts` re-exports everything here so the public surface
 * stays a single module.
 */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

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
  /**
   * Close the held warm slot, if any, and abandon any in-flight warm-up: if a
   * `startup()` is still resolving, its eventual `WarmQuery` must NOT be
   * installed — it's closed the moment it lands (via an epoch check). Until
   * that abandoned warm-up settles, `hasWarm()` still reports true, so no
   * overlapping warm-up gets spawned; the backend ends up cold either way.
   *
   * Idempotent and cheap when there's nothing to close. Optional — fakes and
   * backends without a warm pool don't have to implement it.
   */
  closeWarm?(): void;
  /**
   * Whether a warm slot is currently held OR a warm-up is in flight. Callers
   * use this to avoid stampeding re-`prewarm()` calls when the backend is
   * already warm or warming. Optional — absent means "no warm pool".
   */
  hasWarm?(): boolean;
}
