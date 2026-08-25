/** Typed Codex SDK boundary shared by batch agents and interactive chat. */

import {
  Codex,
  type Input,
  type Thread,
  type ThreadEvent,
  type ThreadItem,
  type ThreadOptions,
  type Usage,
} from "@openai/codex-sdk";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { CODEX_BOX_SANDBOX } from "./codex-sandbox.js";
import { toError } from "../lib/error-guards.js";
import { declaredPresent } from "../lib/declared-present.js";
import type { ChatContentBlock } from "./claude-chat-types.js";

export type CodexSdkItem = ThreadItem;
export type CodexSdkEvent = ThreadEvent;
export type CodexSdkTokenUsage = Usage;

export interface CodexSdkSessionOptions {
  cwd: string;
  systemPrompt: string;
  model?: string | undefined;
  resumeSessionId?: string | undefined;
  additionalDirectories?: string[] | undefined;
  env?: Record<string, string | undefined> | undefined;
  turnTimeoutMs?: number | undefined;
}

export interface CodexSdkTurnResult {
  sessionId: string;
  output: string;
  resultText: string;
  durationMs: number;
  status: "completed" | "interrupted" | "failed";
  error: string | null;
  usage: Usage | null;
  items: ThreadItem[];
}

export interface CodexSdkTurnOptions {
  input: string | ChatContentBlock[];
  outputSchema?: Record<string, unknown> | undefined;
  signal?: AbortSignal | undefined;
  onSessionId?: ((id: string) => void) | undefined;
  onEvent?: ((event: ThreadEvent) => void) | undefined;
}

export interface CodexSdkSessionLike {
  readonly id: string | null;
  run(options: CodexSdkTurnOptions): Promise<CodexSdkTurnResult>;
}

export type CodexSdkSessionFactory = (options: CodexSdkSessionOptions) => CodexSdkSessionLike;

class CodexImageInputError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("Could not fetch Codex image input");
    this.name = "CodexImageInputError";
    this.status = status;
  }
}

class CodexSdkMissingThreadIdError extends Error {
  constructor() {
    super("Codex SDK stream did not provide a thread ID");
    this.name = "CodexSdkMissingThreadIdError";
  }
}

/**
 * The SDK's thread factory returned nothing. Its types declare a `Thread` is
 * always returned, so this is a claim the runtime broke; the class exists so
 * that break surfaces under its own name instead of as a `TypeError` from the
 * first property read on the missing thread.
 */
class CodexSdkNoThreadError extends Error {
  constructor(resumed: boolean) {
    super(`Codex SDK returned no thread from ${resumed ? "resumeThread" : "startThread"}`);
    this.name = "CodexSdkNoThreadError";
  }
}

class CodexSdkTurnTimeoutError extends Error {
  constructor() {
    super("Codex SDK turn did not complete before the timeout");
    this.name = "CodexSdkTurnTimeoutError";
  }
}

function abortOutcome(options: {
  timedOut: boolean;
  interrupted: boolean;
}): Pick<CodexSdkTurnResult, "status" | "error"> | null {
  if (options.timedOut) {
    return { status: "failed", error: new CodexSdkTurnTimeoutError().message };
  }
  if (options.interrupted) {
    return { status: "interrupted", error: "Codex turn was interrupted" };
  }
  return null;
}

/**
 * Resolve a throw out of the event stream. Aborts map to their outcome. When
 * the stream already carried the semantic failure (a `turn.failed` or `error`
 * event), the SDK's process-exit throw that follows is only stderr startup
 * chatter ("Reading prompt from stdin...") — keep the informative message.
 * Anything else rethrows.
 */
function settleStreamThrow(options: {
  cause: unknown;
  timedOut: boolean;
  interrupted: boolean;
  capturedError: string | null;
  status: CodexSdkTurnResult["status"];
}): Pick<CodexSdkTurnResult, "status" | "error"> {
  const aborted = abortOutcome({ timedOut: options.timedOut, interrupted: options.interrupted });
  if (aborted !== null) return aborted;
  if (options.capturedError !== null && options.status !== "completed") {
    return { status: "failed", error: options.capturedError };
  }
  throw toError(options.cause);
}

/**
 * The message a `turn.failed` event carries. The event's declared type always
 * has an `error` object, so this covers the case where it arrives without one:
 * the turn still failed, and saying so beats a `TypeError` raised while reading
 * the reason.
 */
function failedTurnMessage(event: Extract<ThreadEvent, { type: "turn.failed" }>): string {
  const failure = declaredPresent(event.error);
  if (failure === null) return "Codex SDK reported turn.failed with no error detail";
  return declaredPresent(failure.message) ?? "Codex SDK reported turn.failed with an empty error message";
}

export function codexSdkThreadOptions(options: CodexSdkSessionOptions): ThreadOptions {
  return {
    workingDirectory: options.cwd,
    sandboxMode: CODEX_BOX_SANDBOX,
    approvalPolicy: "never",
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.additionalDirectories === undefined ? {} : { additionalDirectories: options.additionalDirectories }),
  };
}

function definedEnv(env: Record<string, string | undefined> | undefined): Record<string, string> | undefined {
  if (env === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

async function materializeInput(
  input: string | ChatContentBlock[],
): Promise<{ input: Input; cleanup(): Promise<void> }> {
  if (typeof input === "string") return { input, cleanup: async () => {} };
  const sdkInput: Input = [];
  let tempDir: string | null = null;
  for (const block of input) {
    if (block.type === "text") {
      sdkInput.push({ type: "text", text: block.text });
      continue;
    }
    tempDir ??= await fs.mkdtemp(path.join(os.tmpdir(), "callback-box-codex-image-"));
    const index = sdkInput.length;
    const extension = block.source.media_type?.split("/")[1]?.replace(/[^\dA-Za-z]/g, "") || "png";
    const imagePath = path.join(tempDir, `image-${String(index)}.${extension}`);
    if (block.source.type === "url") {
      const response = await fetch(block.source.url ?? "");
      if (!response.ok) throw new CodexImageInputError(response.status);
      await fs.writeFile(imagePath, Buffer.from(await response.arrayBuffer()));
    } else {
      await fs.writeFile(imagePath, Buffer.from(block.source.data ?? "", "base64"));
    }
    sdkInput.push({ type: "local_image", path: imagePath });
  }
  return {
    input: sdkInput,
    cleanup: async () => {
      if (tempDir !== null) await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}

/** One native Codex thread. The SDK owns CLI spawning, protocol parsing, and resume. */
class CodexSdkSession {
  private readonly thread: Thread;
  private readonly turnTimeoutMs: number;

  constructor(options: CodexSdkSessionOptions) {
    const env = definedEnv(options.env);
    const codex = new Codex({
      config: { developer_instructions: options.systemPrompt },
      ...(env === undefined ? {} : { env }),
      // TODO(env-migration): test/diagnostic binary override; move into the typed env boundary.
      ...(process.env.CB_CODEX_BINARY === undefined ? {} : { codexPathOverride: process.env.CB_CODEX_BINARY }),
    });
    const threadOptions = codexSdkThreadOptions(options);
    const started = declaredPresent(options.resumeSessionId === undefined
      ? codex.startThread(threadOptions)
      : codex.resumeThread(options.resumeSessionId, threadOptions));
    if (started === null) throw new CodexSdkNoThreadError(options.resumeSessionId !== undefined);
    this.thread = started;
    this.turnTimeoutMs = options.turnTimeoutMs ?? 600_000;
  }

  get id(): string | null {
    return this.thread.id;
  }

  async run(options: CodexSdkTurnOptions): Promise<CodexSdkTurnResult> {
    const materialized = await materializeInput(options.input);
    const startedAt = performance.now();
    const output: string[] = [];
    const items: ThreadItem[] = [];
    let usage: Usage | null = null;
    let status: CodexSdkTurnResult["status"] = "failed";
    let error: string | null = null;
    let sessionId = this.thread.id ?? "";
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), this.turnTimeoutMs);
    timeout.unref();
    const signal = options.signal === undefined
      ? timeoutController.signal
      : AbortSignal.any([options.signal, timeoutController.signal]);
    try {
      const streamed = await this.thread.runStreamed(materialized.input, {
        ...(options.outputSchema === undefined ? {} : { outputSchema: options.outputSchema }),
        signal,
      });
      for await (const event of streamed.events) {
        options.onEvent?.(event);
        if (event.type === "thread.started") {
          sessionId = event.thread_id;
          options.onSessionId?.(sessionId);
        } else if (event.type === "item.completed") {
          const item = declaredPresent(event.item);
          if (item === null) {
            console.warn("[codex-sdk-session] codex SDK emitted item.completed with no item; dropping the event");
          } else {
            items.push(item);
            if (item.type === "agent_message") output.push(item.text);
          }
        } else if (event.type === "turn.completed") {
          usage = declaredPresent(event.usage);
          status = "completed";
        } else if (event.type === "turn.failed") {
          error = failedTurnMessage(event);
        } else if (event.type === "error") {
          error = event.message;
        }
      }
      const aborted = status === "completed" ? null : abortOutcome({
        timedOut: timeoutController.signal.aborted,
        interrupted: options.signal?.aborted === true,
      });
      if (aborted !== null) {
        ({ status, error } = aborted);
      }
    } catch (cause) {
      ({ status, error } = settleStreamThrow({
        cause,
        timedOut: timeoutController.signal.aborted,
        interrupted: options.signal?.aborted === true,
        capturedError: error,
        status,
      }));
    } finally {
      clearTimeout(timeout);
      await materialized.cleanup();
    }
    sessionId = this.thread.id ?? sessionId;
    if (sessionId === "") throw new CodexSdkMissingThreadIdError();
    if (status === "failed" && error === null) error = "Codex SDK stream ended without a completion event";
    const resultText = output.toReversed().find((text) => text !== "") ?? "";
    return {
      sessionId,
      output: output.join("\n"),
      resultText,
      durationMs: Math.round(performance.now() - startedAt),
      status,
      error,
      usage,
      items,
    };
  }
}

export const createCodexSdkSession: CodexSdkSessionFactory = (options) => new CodexSdkSession(options);

export function codexSdkUsage(usage: Usage): {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
} {
  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    cacheWriteInputTokens: usage.cache_write_input_tokens,
    outputTokens: usage.output_tokens,
    reasoningOutputTokens: usage.reasoning_output_tokens,
  };
}
