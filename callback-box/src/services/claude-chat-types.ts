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
import type { AgentEngine } from "../core/box/config.js";
import type { ChatMessage } from "../core/chat/message-types.js";

/** A provider-normalized event emitted by a non-Claude chat backend. */
export interface NativeChatBackendMessage {
  provider: "codex";
  message: ChatMessage;
}

export type ChatBackendMessage = SDKMessage | NativeChatBackendMessage;

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
  /** Native harness selected for this chat's complete lifetime. */
  engine?: AgentEngine;
  /** Working directory for the underlying SDK subprocess. */
  cwd: string;
  /**
   * Extra directories the agent can read/write beyond `cwd`. Equivalent to
   * the Claude CLI's `--add-dir`. Landmark sessions set `cwd` to the landmark
   * dir and add the box root here. Codex box turns run with full access because
   * its narrower sandbox force-mounts `.git` read-only, so the field is
   * intentionally redundant for that provider.
   */
  additionalDirectories?: string[] | undefined;
  /** Appended to the `claude_code` system-prompt preset. */
  systemPrompt: string;
  /** If set, resumes the given SDK session; otherwise a fresh session. */
  resumeSessionId?: string | undefined;
  /** Pin to a specific model; omit for SDK default. */
  model?: string | undefined;
  /**
   * The built-in tools available to the session (the SDK's `tools` option).
   * Omit for the SDK default (all of them). This is availability, not
   * permission: `allowedTools` only pre-approves permission prompts, which
   * `bypassPermissions` never raises, so it would not restrict anything. Box
   * chat sessions leave this unset; the field-test operator sets it so its
   * "browser only" boundary is enforced by the SDK, not only by instruction.
   */
  tools?: string[] | undefined;
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
  messages: AsyncIterable<ChatBackendMessage>;
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
  /**
   * True only for the real SDK-backed implementation, whose `start()` spawns a
   * Claude Code subprocess and therefore needs an active Claude login. The chat
   * session runs its auth preflight only when this is set, so fakes (which
   * never touch the SDK) skip it. Absent/`false` on every fake.
   */
  requiresClaudeAuth?: boolean | undefined;
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
