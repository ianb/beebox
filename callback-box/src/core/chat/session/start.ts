/**
 * Backend-start-options computation for ChatSession.
 *
 * Resolves the system prompt, the landmark context directory, and the env
 * for a fresh SDK run. Pulled out of `chat-session.ts` so that file stays
 * under the line budget. The context-dir cache lives on the ChatSession
 * instance; these helpers take its current value in and hand the resolved
 * value back, leaving the instance to store it.
 */

import { makeLog } from "./log.js";
import * as path from "node:path";
import { getDirectoryForSession } from "./history.js";
import { buildTimezoneContext } from "../../box/config.js";
import { buildScriptEnv } from "../../script-env.js";
import { composeSendSnapshot, type HealthGate } from "../../session-context.js";
import { renderActivityChildren } from "../card-activity.js";
import {
  CHAT_SYSTEM_PROMPT,
  NARRATION_OVERLAY,
  buildLandmarkSessionNote,
} from "./prompts.js";
import {
  buildContentBlocks,
  toBackendContent,
  type ChatSendInput,
} from "./messages.js";
import type { FeatureStore } from "./features.js";
import type { ChatBackendStartOptions, ChatContentBlock } from "../../../services/claude-chat.js";
import type { ChatSessionOptions } from "./options.js";

const log = makeLog("ChatSession");

/** The pieces of ChatSession state these helpers read or update. */
interface StartContext {
  boxRoot: string;
  options: ChatSessionOptions;
  /** Current landmark-binding cache: `undefined` unresolved, `null` none. */
  resolvedContextDir: string | null | undefined;
}

/**
 * Resolve the system prompt for a new run. Uses the options override
 * if provided; otherwise falls back to the main-chat default
 * (CHAT_SYSTEM_PROMPT + tzContext + NARRATION_OVERLAY).
 *
 * NARRATION_OVERLAY is always included — its rules are gated in the
 * prose on what the agent reads in the per-turn <chat-app> snapshot,
 * so toggling narration mid-session works without a subprocess restart.
 */
async function resolveSystemPrompt(ctx: StartContext): Promise<string> {
  if (ctx.options.systemPrompt !== undefined) {
    return ctx.options.systemPrompt(ctx.boxRoot);
  }
  const tzContext = await buildTimezoneContext(ctx.boxRoot);
  return CHAT_SYSTEM_PROMPT + tzContext + NARRATION_OVERLAY;
}

/**
 * Resolve the directory this chat is bound to, or null if none.
 * Explicit `options.contextDir` wins. Otherwise we only consult
 * `chat-session-history` when the session was constructed with a known
 * id (a resume) — for fresh-new sessions a binding can't predate the id
 * assignment, so there's nothing to look up and we skip the I/O. The
 * resolved value is returned for the caller to cache on the instance.
 */
async function resolveContextDir(ctx: StartContext): Promise<string | null> {
  if (ctx.options.contextDir !== undefined) return ctx.options.contextDir;
  if (ctx.resolvedContextDir !== undefined) return ctx.resolvedContextDir;
  if (ctx.options.initialSessionId === undefined) return null;
  try {
    return await getDirectoryForSession(ctx.boxRoot, ctx.options.initialSessionId);
  } catch (e) {
    log("context-dir", `Lookup failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/**
 * Decide the landmark context dir for a start, preferring the synchronous
 * paths (explicit option, already-cached value, or known-no-binding for a
 * fresh session) so the common case adds no microtask hop — tests rely on a
 * stable tick count between send/drain. Falls back to the async lookup.
 */
async function pickContextDir(ctx: StartContext): Promise<string | null> {
  if (ctx.options.contextDir !== undefined) return ctx.options.contextDir;
  if (ctx.resolvedContextDir !== undefined) return ctx.resolvedContextDir;
  if (ctx.options.initialSessionId === undefined) return null;
  return resolveContextDir(ctx);
}

/**
 * Compute the `ChatBackendStartOptions` for a fresh run (no resume id, no
 * model override) and the landmark binding it resolved to. The caller
 * stores `resolvedContextDir` back on the instance cache.
 */
export async function buildBackendStartOptions(
  ctx: StartContext,
): Promise<{ startOpts: ChatBackendStartOptions; resolvedContextDir: string | null }> {
  const baseSystemPrompt = await resolveSystemPrompt(ctx);
  const contextDir = await pickContextDir(ctx);
  const systemPrompt = contextDir
    ? baseSystemPrompt + buildLandmarkSessionNote(contextDir)
    : baseSystemPrompt;
  const cwd = contextDir ? path.join(ctx.boxRoot, contextDir) : ctx.boxRoot;
  const baseEnv = await buildScriptEnv(ctx.boxRoot, {
    CLAUDECODE: undefined,
  });
  const env: Record<string, string | undefined> = {
    ...baseEnv,
    ...(ctx.options.extraEnv ?? {}),
  };
  const startOpts: ChatBackendStartOptions = {
    cwd,
    systemPrompt,
    includePartialMessages: ctx.options.includePartialMessages === true,
    env,
  };
  if (contextDir) {
    startOpts.additionalDirectories = [ctx.boxRoot];
  }
  return { startOpts, resolvedContextDir: contextDir };
}

/**
 * Build the backend content blocks for one user turn: prepend the chat-app
 * snapshot (feature flags, wall-clock time, and situational context —
 * box-local time always; last-activity and calendar only on the first
 * message of a brand-new conversation, when `sessionStart` is true), then
 * expand `[imageN]` tokens into image blocks. Pulled out of
 * `ChatSession.send` for the line budget.
 */
export async function composeTurnContent(
  boxRoot: string,
  { rawInput, features, sessionStart, healthGate }: {
    rawInput: ChatSendInput;
    features: FeatureStore;
    sessionStart: boolean;
    healthGate?: HealthGate;
  },
): Promise<ChatContentBlock[]> {
  await features.ensureLoaded();
  // Omit-when-empty: `undefined` (not `""`) drops the attribute, since the
  // snapshot pipeline renders empty strings. `card-activity` collapses to
  // `undefined` when nothing survives the canonical join.
  const openCard = rawInput.openCard !== undefined && rawInput.openCard !== ""
    ? rawInput.openCard
    : undefined;
  const activityChildren = renderActivityChildren({
    kinds: rawInput.cardActivity ?? [],
    details: rawInput.cardState ?? {},
    ...(openCard !== undefined ? { openCard } : {}),
  });
  const snapshot = await composeSendSnapshot(boxRoot, {
    features: features.snapshot(),
    sessionStart,
    ...(rawInput.channel !== undefined ? { channel: rawInput.channel } : {}),
    ...(openCard !== undefined ? { openCard } : {}),
    ...(activityChildren !== "" ? { activityChildren } : {}),
    ...(healthGate !== undefined ? { healthGate } : {}),
  });
  const input: ChatSendInput = {
    ...rawInput,
    text: `${snapshot}\n${rawInput.text}`,
  };
  const content = buildContentBlocks(input);
  const imgCount = (input.images ?? []).length;
  log("send", `Sending message (${input.text.length} chars, ${imgCount} image(s), ${content.length} block(s))`);
  return toBackendContent(content);
}
