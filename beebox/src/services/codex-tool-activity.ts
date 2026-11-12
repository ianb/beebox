/** Normalize Codex app-server activity into beebox's shared tool-call shape. */

import { z } from "zod";
import type { CodexSdkItem } from "./codex-sdk-session/core.js";
import type { ChatMessageAssistant, ChatMessageContent } from "../core/chat/message-types.js";
import type { SessionContentBlock } from "../cli/lib/session-content.js";
import { isRecord } from "../shared/is-record.js";
import { declaredPresent } from "../lib/declared-present.js";

const changeSchema = z.looseObject({
  path: z.string(),
  kind: z.unknown().optional(),
});

/**
 * Codex's own parse of a command (app-server `CommandAction`; the rollout's
 * `parsed_cmd`, whose `list_files` is spelled `listFiles` here). Its `command`
 * copy is dropped: the step already carries the command.
 */
const commandActionSchema = z.discriminatedUnion("type", [
  z.looseObject({ type: z.literal("read"), name: z.string(), path: z.string() }),
  z.looseObject({ type: z.literal("search"), query: z.string().nullable().optional(), path: z.string().nullable().optional() }),
  z.looseObject({ type: z.enum(["listFiles", "list_files"]), path: z.string().nullable().optional() }),
  z.looseObject({ type: z.literal("unknown") }),
]);

/** A Codex command action as a Bash step's `input.actions` carries it. */
export type CodexCommandAction =
  | { type: "read"; name: string; path: string }
  | { type: "search"; query: string | null; path: string | null }
  | { type: "listFiles"; path: string | null }
  | { type: "unknown" };

/**
 * Codex's command actions in the step's shape, or null when absent or
 * unreadable. One malformed action drops them all, so the step falls back to
 * its command rather than describing part of it.
 */
export function codexCommandActions(raw: unknown): CodexCommandAction[] | null {
  const parsed = z.array(commandActionSchema).min(1).safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.map((action): CodexCommandAction => {
    switch (action.type) {
      case "read":
        return { type: "read", name: action.name, path: action.path };
      case "search":
        return { type: "search", query: action.query ?? null, path: action.path ?? null };
      case "listFiles":
      case "list_files":
        return { type: "listFiles", path: action.path ?? null };
      case "unknown":
        return { type: "unknown" };
    }
  });
}

const codexToolItemSchema = z.discriminatedUnion("type", [
  z.looseObject({
    id: z.string(),
    type: z.literal("commandExecution"),
    command: z.string(),
    commandActions: z.unknown().optional(),
  }),
  z.looseObject({
    id: z.string(),
    type: z.literal("fileChange"),
    status: z.string(),
    changes: z.array(changeSchema),
  }),
  z.looseObject({
    id: z.string(),
    type: z.literal("webSearch"),
    query: z.string().optional(),
    action: z.unknown().optional(),
  }),
  z.looseObject({
    id: z.string(),
    type: z.literal("mcpToolCall"),
    server: z.string().optional(),
    tool: z.string().optional(),
    arguments: z.unknown().optional(),
  }),
  z.looseObject({
    id: z.string(),
    type: z.literal("dynamicToolCall"),
    tool: z.string().optional(),
    arguments: z.unknown().optional(),
  }),
  z.looseObject({
    id: z.string(),
    type: z.literal("subAgentActivity"),
    kind: z.string(),
    agentPath: z.string().optional(),
    agentThreadId: z.string().optional(),
  }),
]);

export interface CodexToolContent extends ChatMessageContent {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

const TOOL_ITEM_TYPES = new Set<string>(codexToolItemSchema.options.map((option) => option.shape.type.value));

const collabToolCallSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal("collab_tool_call"),
  tool: z.string(),
  receiver_thread_ids: z.array(z.string()).optional(),
  prompt: z.string().nullable().optional(),
  agents_states: z.record(z.string(), z.unknown()).optional(),
  status: z.string(),
});

function record(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : { arguments: value };
  } catch (_error) {
    return { arguments: value };
  }
}

/**
 * The command a Codex `command_execution` shows. Codex reports the shell
 * invocation it ran, `<path>/bash -lc '<cmd>'`, where Claude reports the
 * command alone. Only that exact shape with one plainly quoted argument is
 * unwrapped; anything else, including an argument with escapes or shell
 * expansions inside double quotes, shows verbatim. Codex's own record keeps
 * the full invocation.
 */
export function codexDisplayCommand(command: string): string {
  const match = /^(?:\S*\/)?bash -lc (.+)$/s.exec(command);
  const arg = match?.[1];
  if (arg === undefined || arg.length < 2) return command;
  const quote = arg[0];
  const inner = arg.slice(1, -1);
  if (quote === "'" && arg.endsWith("'") && !inner.includes("'")) return inner;
  if (quote === '"' && arg.endsWith('"') && !/["$\\`]/.test(inner)) return inner;
  return command;
}

/**
 * The history block for a Codex agent message. Codex marks a message written
 * between steps `commentary`: the same thing as Claude's progress update, so
 * it becomes one and folds as a note.
 */
export function codexAgentMessageBlock(text: string, phase: string | null | undefined): SessionContentBlock {
  return phase === "commentary" && text.trim() !== ""
    ? { type: "thinking", text, progressUpdate: true }
    : { type: "text", text };
}

/** One provider-owned conversion point used by both live streaming and history. */
export function normalizeCodexToolItem(raw: unknown): CodexToolContent | null {
  const collab = collabToolCallSchema.safeParse(raw);
  if (collab.success) return normalizeCollabToolCall(collab.data);
  const parsed = codexToolItemSchema.safeParse(raw);
  if (!parsed.success) {
    if (isRecord(raw) && typeof raw.type === "string" && TOOL_ITEM_TYPES.has(raw.type)) {
      const fields = parsed.error.issues.map((issue) => issue.path.join(".")).filter(Boolean).join(", ");
      console.warn(`[codex-tool-activity] Invalid ${raw.type} item${fields === "" ? "" : ` fields: ${fields}`}`);
    }
    return null;
  }
  const item = parsed.data;
  if (item.type === "commandExecution") {
    const actions = codexCommandActions(item.commandActions);
    return {
      type: "tool_use",
      id: item.id,
      name: "Bash",
      input: { command: codexDisplayCommand(item.command), ...(actions === null ? {} : { actions }) },
    };
  }
  if (item.type === "fileChange") {
    const paths = item.changes.map((change) => change.path);
    return {
      type: "tool_use",
      id: item.id,
      name: "Edit",
      input: {
        ...(paths[0] === undefined ? {} : { file_path: paths[0] }),
        ...(paths.length <= 1 ? {} : { file_paths: paths }),
        status: item.status,
      },
    };
  }
  if (item.type === "webSearch") {
    const query = item.query ?? "";
    return {
      type: "tool_use",
      id: item.id,
      name: "WebSearch",
      input: { ...(query === "" ? {} : { query }), ...(item.action === undefined ? {} : { action: item.action }) },
    };
  }
  if (item.type === "subAgentActivity") {
    return {
      type: "tool_use",
      id: item.id,
      name: "Agent",
      input: {
        description: item.agentPath ?? "Sub-agent activity",
        kind: item.kind,
        ...(item.agentThreadId === undefined ? {} : { thread_id: item.agentThreadId }),
      },
    };
  }
  const tool = item.tool ?? (item.type === "mcpToolCall" ? "MCP" : "Tool");
  return {
    type: "tool_use",
    id: item.id,
    name: item.type === "mcpToolCall" && item.server !== undefined
      ? `${item.server}.${tool}`
      : tool,
    input: record(item.arguments),
  };
}

function normalizeCollabToolCall(item: z.infer<typeof collabToolCallSchema>): CodexToolContent {
  return {
    type: "tool_use",
    id: item.id,
    name: "Agent",
    input: {
      action: item.tool,
      status: item.status,
      ...(item.receiver_thread_ids === undefined ? {} : { thread_ids: item.receiver_thread_ids }),
      ...(item.prompt === undefined || item.prompt === null ? {} : { prompt: item.prompt }),
      ...(item.agents_states === undefined ? {} : { agents: item.agents_states }),
    },
  };
}

/**
 * The `id` of an SDK item, or null when the item arrived without one. Every
 * item type in the SDK's declared vocabulary carries a string `id`, and both
 * the tool-content shape below and the chat frame's `uuid` are keyed by it, so
 * an item that reaches us without one is reported and dropped rather than
 * flowing on as `undefined` (which reads as a duplicate frame downstream) or
 * throwing where it is read.
 */
export function codexSdkItemId(item: CodexSdkItem): string | null {
  const id = declaredPresent(item.id);
  if (id === null) {
    console.warn(`[codex-tool-activity] codex SDK emitted a ${item.type} item with no id; dropping it`);
  }
  return id;
}

/** Convert the official SDK item vocabulary used by live batch and chat runs. */
export function normalizeCodexSdkToolItem(item: CodexSdkItem): CodexToolContent | null {
  // The CLI emits this official exec-stream item, but the SDK's ThreadItem
  // union does not include it yet. Parse at the provider boundary so the
  // temporary upstream type lag cannot make collaboration invisible here.
  const collab = collabToolCallSchema.safeParse(item);
  if (collab.success) return normalizeCollabToolCall(collab.data);
  const id = codexSdkItemId(item);
  if (id === null) return null;
  switch (item.type) {
    case "command_execution":
      return { type: "tool_use", id, name: "Bash", input: { command: codexDisplayCommand(item.command) } };
    case "file_change": {
      const paths = (declaredPresent(item.changes) ?? []).map((change) => change.path);
      return {
        type: "tool_use",
        id,
        name: "Edit",
        input: {
          ...(paths[0] === undefined ? {} : { file_path: paths[0] }),
          ...(paths.length <= 1 ? {} : { file_paths: paths }),
          status: item.status,
        },
      };
    }
    case "web_search":
      return { type: "tool_use", id, name: "WebSearch", input: { query: item.query } };
    case "mcp_tool_call":
      return {
        type: "tool_use",
        id,
        name: `${item.server}.${item.tool}`,
        input: record(item.arguments),
      };
    case "todo_list":
      return { type: "tool_use", id, name: "TodoWrite", input: { items: item.items } };
    case "agent_message":
    case "reasoning":
    case "error":
      return null;
    default:
      // The SDK's ThreadItem union lags the binary: 2026-08-26 a codex turn on
      // a real box died with "Cannot read properties of undefined (reading
      // 'id')" because an item type this switch had never seen fell out of it
      // as `undefined`, and the caller's `=== null` guard let it through. One
      // unrenderable activity item is not a failed turn — skip it, and say
      // which type once so the next case gets added.
      warnUnknownItemType(item);
      return null;
  }
}

const warnedItemTypes = new Set<string>();

function warnUnknownItemType(item: unknown): void {
  const type = isRecord(item) && typeof item["type"] === "string" ? item["type"] : "unknown";
  if (warnedItemTypes.has(type)) return;
  warnedItemTypes.add(type);
  console.warn(`[codex-tool-activity] unknown Codex item type "${type}" — not rendered as activity`);
}

export function codexSdkToolChatMessage(item: CodexSdkItem, sessionId: string): ChatMessageAssistant | null {
  const tool = normalizeCodexSdkToolItem(item);
  if (tool === null) return null;
  return {
    type: "assistant",
    session_id: sessionId,
    uuid: tool.id,
    message: { role: "assistant", content: [tool] },
  };
}
