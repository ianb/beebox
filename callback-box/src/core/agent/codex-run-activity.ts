/** Validate and normalize observable Codex turn activity. */

import { z } from "zod";
import { fmt } from "../../lib/format.js";

export const itemCompletedSchema = z.looseObject({
  threadId: z.string(),
  turnId: z.string(),
  item: z.discriminatedUnion("type", [
    z.looseObject({
      type: z.literal("agentMessage"),
      text: z.string(),
      phase: z.enum(["commentary", "final_answer"]).nullable(),
    }),
    z.looseObject({
      type: z.literal("commandExecution"),
      command: z.string(),
      aggregatedOutput: z.string().nullable(),
      exitCode: z.number().nullable(),
    }),
    z.looseObject({
      type: z.literal("fileChange"),
      status: z.enum(["inProgress", "completed", "failed", "declined"]),
      changes: z.array(z.looseObject({ path: z.string() })),
    }),
    z.looseObject({ type: z.literal("webSearch"), query: z.string() }),
    z.looseObject({ type: z.literal("mcpToolCall") }),
    z.looseObject({ type: z.literal("dynamicToolCall") }),
  ]),
});

type CompletedItem = z.infer<typeof itemCompletedSchema>["item"];

export type CodexObservedActivity =
  | { type: "command"; command: string }
  | { type: "search"; tool: "WebSearch"; summary: string };

export function renderCodexCommand(item: CompletedItem): string {
  if (item.type !== "commandExecution") return "";
  const output = item.aggregatedOutput ?? "";
  const suffix = item.exitCode === null ? "" : ` [exit ${item.exitCode}]`;
  return `${fmt.dim("$ ")}${fmt.cmd(item.command)}${fmt.dim(suffix)}\n${output}`;
}

export function emitObservedActivity(
  item: CompletedItem,
  emit: ((activity: CodexObservedActivity) => void) | undefined,
): void {
  if (item.type === "commandExecution") {
    emit?.({ type: "command", command: item.command });
  } else if (item.type === "webSearch") {
    emit?.({ type: "search", tool: "WebSearch", summary: item.query });
  }
}
