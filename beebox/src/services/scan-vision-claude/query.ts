/**
 * One hermetic Claude Agent SDK call with a structured-output schema, shared
 * by the scan batch (`core.ts`) and the upright check
 * (`upright.ts`).
 */

import type { SDKUserMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { query as ClaudeQuery } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { resolveClaudeCodeBinary } from "../../core/sdk-binary-path.js";
import { boxSessionSettings } from "../../core/agent/box-session-settings.js";
import { buildScriptEnv } from "../../core/script-env/core.js";
import { providerEnvAdditions } from "../../core/provider-env/core.js";
import { dropUndefined } from "../../lib/drop-undefined.js";
import { errorMessage } from "../../shared/error-guards.js";
import { isRecord } from "../../shared/is-record.js";
import type { ScanVisionImageInput } from "../../core/describe-images/image-input.js";
import type { BatchUsage } from "../../core/describe-images/gemini.js";
import { ScanVisionBatchError } from "../scan-vision.js";

const MAX_TURNS = 8;

export type ClaudeQueryFunction = typeof ClaudeQuery;

export interface ScanImage { data: string; mediaType: ScanVisionImageInput["mediaType"] }
export type SdkContent = Exclude<SDKUserMessage["message"]["content"], string>;

/** Drop the vacuous MAX_SAFE_INTEGER bounds `z.toJSONSchema` puts on `z.int()`
 *  — structured-output dialects commonly reject numeric range constraints. */
function stripIntBounds(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) stripIntBounds(item);
    return;
  }
  if (!isRecord(node)) return;
  const record = node;
  if (record["type"] === "integer") {
    delete record["minimum"];
    delete record["maximum"];
  }
  for (const value of Object.values(record)) stripIntBounds(value);
}

/** A Zod schema as the JSON Schema the SDK's `outputFormat` accepts. */
export function toWireSchema(zodSchema: z.ZodType): Record<string, unknown> {
  const schema = z.toJSONSchema(zodSchema);
  // The CLI validates --json-schema with a draft-07 ajv; the 2020-12 `$schema`
  // marker z.toJSONSchema emits makes it reject the whole schema ("no schema
  // with key or ref"). The structure is draft-07-compatible, so drop the marker.
  delete schema["$schema"];
  stripIntBounds(schema);
  return schema;
}

/** The query stream ended without ever yielding a result message. */
class ClaudeScanNoResultError extends ScanVisionBatchError {
  constructor() {
    super("Claude scan query ended without a result message", { retry: "fatal" });
    this.name = "ClaudeScanNoResultError";
  }
}

/** The SDK subprocess itself could not run (spawn/auth-level failure). */
class ClaudeScanSubprocessError extends ScanVisionBatchError {
  constructor({ detail, cause }: { detail: string; cause: unknown }) {
    super(`Claude scan subprocess failed: ${detail}`, { retry: "fatal", cause });
    this.name = "ClaudeScanSubprocessError";
  }
}

export function toBatchUsage(result: SDKResultMessage): BatchUsage {
  const usage = result.usage;
  return {
    prompt: usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens,
    // The SDK reports no separate thinking count; it is folded into output.
    output: usage.output_tokens,
    thinking: 0,
  };
}

/** One hermetic SDK call; throws `ScanVisionBatchError` (`fatal`) when the
 *  subprocess itself cannot run (spawn/auth-level failures). */
export async function runClaudeQuery({
  boxRoot,
  content,
  model,
  schema,
  query: queryOverride,
}: {
  boxRoot: string;
  content: SdkContent;
  model: string;
  schema: Record<string, unknown>;
  query?: ClaudeQueryFunction | undefined;
}): Promise<SDKResultMessage> {
  // CLAUDECODE is unset so the SDK can run nested inside Claude Code;
  // buildScriptEnv strips ANTHROPIC_API_KEY to force subscription auth
  // (same conventions as core/agent/run.ts).
  const env = dropUndefined(await buildScriptEnv(boxRoot, { CLAUDECODE: undefined }));
  // First-party additions, as every other spawn path: the box's long-lived
  // token when it has one, and its telemetry choice (review round 6, codex
  // gpt-6-sol, 2026-10-25: the preflight accepted a token-granted box and this
  // call then ran without the token).
  await providerEnvAdditions({ boxRoot, model: null, purpose: "scan-vision", env });
  const binaryPath = resolveClaudeCodeBinary();

  const userMessage: SDKUserMessage = {
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
    session_id: "",
  };
  async function* prompt(): AsyncGenerator<SDKUserMessage> {
    yield userMessage;
  }

  try {
    // Dynamic — see `core/agent/stream.ts`: keeps the Agent SDK out of the
    // startup graph of every `bbx` invocation that never asks for vision.
    const query = queryOverride ?? (await import("@anthropic-ai/claude-agent-sdk")).query;
    const q = query({
      prompt: prompt(),
      options: {
        model,
        maxTurns: MAX_TURNS,
        cwd: boxRoot,
        env,
        tools: [],
        ...boxSessionSettings({ boxRoot, loadBoxContext: false }),
        // Composed by beebox; the CLI must not expand `@path` mentions in it.
        verbatimPrompts: true,
        systemPrompt: { type: "preset", preset: "claude_code" },
        outputFormat: { type: "json_schema", schema },
        ...(binaryPath === null ? {} : { pathToClaudeCodeExecutable: binaryPath }),
      },
    });
    let result: SDKResultMessage | null = null;
    for await (const msg of q) {
      if (msg.type === "result") result = msg;
    }
    if (result === null) {
      throw new ClaudeScanNoResultError();
    }
    return result;
  } catch (e) {
    if (e instanceof ScanVisionBatchError) throw e;
    // A throw from query() iteration is process-level (spawn failure, missing
    // or broken binary, dead subprocess) — the provider is broken, not the page.
    throw new ClaudeScanSubprocessError({ detail: errorMessage(e), cause: e });
  }
}
