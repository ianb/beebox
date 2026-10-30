/**
 * Interactive box chat through an in-process pi session
 * (docs/implemented-plans/pi-box-engine.md, Track 6), shaped like the Codex chat backend.
 * Each finished assistant message carries its pi session entry id as `uuid`,
 * the id the pi session store reads back, so the turn's durability wait and an
 * immediate history read find it. Usage needs no step here: `syncUsage` reads
 * pi's session file.
 */

import { randomUUID } from "node:crypto";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { createAsyncIterableQueue } from "../claude-chat-queue.js";
import type {
  ChatBackend,
  ChatBackendRun,
  ChatBackendStartOptions,
  ChatContentBlock,
  NativeChatBackendMessage,
} from "../claude-chat-types.js";
import type { ChatMessage, ChatMessageContent, ChatResultPhase } from "../../core/chat/message-types.js";
import { noReplyError, watchPiRun, type PiOutcome, type PiRunWatch } from "../../core/agent/pi-run/outcome.js";
import { openPiSession, type PiSessionDeps } from "../../core/agent/pi-run/session/core.js";
import { watchPiValidation, type PiAgentEvent } from "../../core/agent/pi-run/validate.js";
import { piModelMissing } from "../../core/provider-env/openrouter-chat.js";
import type { HookValidationResult } from "../../cli/validate-hook/command.js";
import { BBX_CHAT_SESSION_ID_ENV } from "../../core/chat/session/id-file.js";
import { findBoxRoot } from "../../lib/paths/core.js";
import { errorMessage } from "../../shared/error-guards.js";
import { invariant } from "../../shared/invariant.js";

type AssistantMessage = Extract<PiAgentEvent, { type: "message_end" }>["message"] & { role: "assistant" };

/** An image sent to a model whose listed input modalities have none. */
export class PiImagesRefusedError extends Error {
  constructor(model: string | undefined) {
    super(`${model ?? "This model"} does not accept images`);
    this.name = "PiImagesRefusedError";
  }
}

function failure({ phase, sessionId, error }: { phase: ChatResultPhase; sessionId: string; error: unknown }): ChatMessage {
  return {
    type: "result", subtype: "failed", session_id: sessionId, is_error: true, phase, duration_ms: 0, num_turns: 0, result: errorMessage(error),
  };
}

/** Text and tool calls, as the pi session store shows them; thinking is dropped there too. */
function assistantContent(message: AssistantMessage): ChatMessageContent[] {
  return message.content.flatMap((block): ChatMessageContent[] => {
    if (block.type === "text") return block.text === "" ? [] : [{ type: "text", text: block.text }];
    if (block.type === "toolCall") return [{ type: "tool_use", id: block.id, name: block.name, input: block.arguments }];
    return [];
  });
}

/** A user turn as pi's prompt takes it. Refuses images the model cannot read, before any model call. */
function piInput(session: AgentSession, content: ChatContentBlock[]): { text: string; images: ImageContent[] } {
  const images = content.flatMap((block): ImageContent[] => {
    if (block.type !== "image") return [];
    const { type, data, media_type: mimeType } = block.source;
    invariant(type === "base64" && data !== undefined && mimeType !== undefined, "chat images reach a backend as base64 data");
    return [{ type: "image", data, mimeType }];
  });
  if (images.length > 0 && session.model?.input.includes("image") !== true) throw new PiImagesRefusedError(session.model?.id);
  return { text: content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n"), images };
}

/** `noReply` is `noReplyError` for the turn: a completed turn whose last message has no text ends in error. */
function turnResult(
  { outcome, validated, noReply }: { outcome: PiOutcome; validated: HookValidationResult; noReply: string | null },
  facts: { sessionId: string; durationMs: number; costUsd: number },
): ChatMessage {
  const invalid = validated.hasErrors ? `Bee Box validation failed:\n${validated.feedback ?? "Unknown validation error"}` : null;
  const error = outcome.state === "failed" || outcome.state === "limit" ? outcome.error : outcome.state === "completed" ? noReply : null;
  const detail = [error, invalid].filter((part): part is string => part !== null).join("\n\n");
  const subtype = invalid !== null || error !== null ? "failed" : outcome.state;
  return {
    type: "result",
    subtype,
    session_id: facts.sessionId,
    is_error: subtype !== "completed",
    duration_ms: facts.durationMs,
    num_turns: 1,
    // pi's estimate from listed prices, kept by `adaptBackendMessage` because it is not Claude's.
    total_cost_usd: facts.costUsd,
    ...(detail === "" ? {} : { result: detail }),
  };
}

/**
 * `sessionId` is known before pi opens, new or resumed, so the shell gets it as
 * `BBX_CHAT_SESSION_ID` from the first turn and needs no post-spawn id file.
 */
async function openChatSession(
  opts: ChatBackendStartOptions,
  { sessionId, deps }: { sessionId: string; deps: PiSessionDeps | undefined },
): Promise<AgentSession> {
  const boxRoot = opts.boxRoot ?? await findBoxRoot(opts.cwd);
  invariant(boxRoot !== null, "a pi chat runs in a box");
  if (opts.model === undefined) throw piModelMissing();
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(opts.env).flatMap(([name, value]) => (value === undefined ? [] : [[name, value]]))),
    [BBX_CHAT_SESSION_ID_ENV]: sessionId,
  };
  const opened = await openPiSession({
    boxRoot,
    model: opts.model,
    purpose: "chat-start",
    systemPrompt: opts.systemPrompt,
    env,
    tools: opts.tools,
    // A landmark chat resumes from its landmark: pi finds a session by id only under the cwd it was created in.
    cwd: opts.cwd,
    resumeSessionId: opts.resumeSessionId,
    newSessionId: sessionId,
  }, deps);
  invariant(opened.kind === "session", "a chat opens a pi session, never a dry run");
  return opened.session;
}

/** Relay text deltas and finished assistant messages. Registered after pi's own listener, which writes the entry. */
function relay(session: AgentSession, { push, partials }: { push: (message: ChatMessage) => void; partials: boolean }) {
  return (event: PiAgentEvent): void => {
    if (event.type === "message_update" && partials && event.assistantMessageEvent.type === "text_delta") {
      const { contentIndex, delta } = event.assistantMessageEvent;
      push({
        type: "stream_event", session_id: session.sessionId, parent_tool_use_id: null,
        event: { type: "content_block_delta", index: contentIndex, delta: { type: "text_delta", text: delta } },
      });
    } else if (event.type === "message_end" && event.message.role === "assistant") {
      const content = assistantContent(event.message);
      const uuid = session.sessionManager.getLeafId();
      if (content.length === 0) return;
      push({
        type: "assistant", session_id: session.sessionId, ...(uuid === null ? {} : { uuid }),
        message: { role: "assistant", content, model: event.message.model },
      });
    }
  };
}

function createRun(opts: ChatBackendStartOptions, deps: PiSessionDeps | undefined): ChatBackendRun {
  const queue = createAsyncIterableQueue<NativeChatBackendMessage>();
  const push = (message: ChatMessage): void => queue.push({ provider: "pi", message });
  let live: AgentSession | null = null;
  let active: PiRunWatch | null = null;
  let unsubscribe = (): void => {};
  const id = opts.resumeSessionId ?? randomUUID();
  const sessionId = (): string => live?.sessionId ?? id;
  const opening = openChatSession(opts, { sessionId: id, deps }).then((session) => {
    live = session;
    unsubscribe = session.agent.subscribe(relay(session, { push, partials: opts.includePartialMessages === true }));
    push({ type: "system", subtype: "init", session_id: session.sessionId });
    return session;
  }, (error: unknown) => {
    push(failure({ phase: "session-start", sessionId: sessionId(), error }));
    return null;
  });

  const turn = async (session: AgentSession, content: ChatContentBlock[]): Promise<void> => {
    const { text, images } = piInput(session, content);
    push({ type: "user", session_id: session.sessionId, message: { role: "user", content } });
    const started = Date.now();
    const watch = watchPiRun(session, { maxTurns: Number.POSITIVE_INFINITY });
    const validation = watchPiValidation(session, opts.cwd);
    active = watch;
    try {
      await session.prompt(text, { images }).catch((error: unknown) => watch.fail(errorMessage(error)));
      push(turnResult(
        { outcome: watch.outcome(), validated: await validation.settle(), noReply: noReplyError(session) },
        { sessionId: session.sessionId, durationMs: Date.now() - started, costUsd: watch.costUsd() },
      ));
    } finally {
      active = null;
      validation.dispose();
      watch.dispose();
    }
  };
  let chain: Promise<unknown> = opening;

  const run: ChatBackendRun = {
    closed: false,
    messages: queue.iterable,
    // Ignores `clientComposed`: pi does not expand `@path` mentions in prompt text.
    // A send during a turn is its own turn after it, with its own result, as on
    // Codex; pi's `followUp` would fold it into the running prompt's one result.
    send(content): void {
      if (run.closed) return;
      chain = chain.then(async () => {
        const session = await opening;
        if (session !== null) await turn(session, content);
      }).catch((error: unknown) => push(failure({ phase: "turn", sessionId: sessionId(), error })));
    },
    async interrupt(): Promise<void> {
      active?.interrupt();
    },
    async close(): Promise<void> {
      if (run.closed) return;
      await chain;
      unsubscribe();
      live?.dispose();
      run.closed = true;
      queue.end();
    },
  };
  return run;
}

/** `deps` replaces pi's model runtime in tests, with pi's `faux` provider. */
export function createPiChatBackend(deps?: PiSessionDeps): ChatBackend {
  return { start: (options) => createRun(options, deps) };
}
