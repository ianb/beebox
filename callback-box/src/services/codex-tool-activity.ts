/** Normalize Codex app-server activity into callback-box's shared tool-call shape. */

import { z } from "zod";
import type { CodexSdkItem } from "./codex-sdk-session.js";
import type { ChatMessageAssistant, ChatMessageContent } from "../core/chat/message-types.js";
import { isRecord } from "../lib/is-record.js";
import { declaredPresent } from "../lib/declared-present.js";

const changeSchema = z.looseObject({
  path: z.string(),
  kind: z.unknown().optional(),
});

export const codexToolItemSchema = z.discriminatedUnion("type", [
  z.looseObject({
    id: z.string(),
    type: z.literal("commandExecution"),
    command: z.string(),
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

/** One provider-owned conversion point used by both live streaming and history. */
export function normalizeCodexToolItem(raw: unknown): CodexToolContent | null {
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
    return {
      type: "tool_use",
      id: item.id,
      name: "Bash",
      input: { command: item.command },
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
  const id = codexSdkItemId(item);
  if (id === null) return null;
  switch (item.type) {
    case "command_execution":
      return { type: "tool_use", id, name: "Bash", input: { command: item.command } };
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
  }
}

/** Build the provider-neutral assistant frame consumed by live ChatSession. */
export function codexToolChatMessage(raw: unknown, sessionId: string): ChatMessageAssistant | null {
  const tool = normalizeCodexToolItem(raw);
  if (tool === null) return null;
  return {
    type: "assistant",
    session_id: sessionId,
    uuid: tool.id,
    message: { role: "assistant", content: [tool] },
  };
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
